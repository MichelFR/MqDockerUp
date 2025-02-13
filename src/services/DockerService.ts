import Docker from "dockerode";
import {ContainerInspectInfo} from "dockerode";
import {EventEmitter} from 'events';
import {ImageRegistryAdapterFactory} from "../registry-factory/ImageRegistryAdapterFactory";
import logger from "./LoggerService";
import IgnoreService from "./IgnoreService";
import HomeassistantService from "./HomeassistantService";
import {mqttClient} from "../index";

/**
 * Represents a Docker service for managing Docker containers and images.
 */
export default class DockerService {
  public static docker = new Docker();
  public static events = new EventEmitter();
  public static updatingContainers: string[] = [];

  // Start listening to Docker events
  public static listenToDockerEvents() {
    DockerService.docker.getEvents({}, (err: any, data: any) => {
      if (err) {
        logger.error('Error while listening to docker events:', err);
        return;
      }

      data.on('data', (chunk: any) => {
        const event = JSON.parse(chunk.toString());

        // Listen for create, update, and delete events on containers
        if (event.Type === 'container') {
          const containerName = event.Actor.Attributes.name;
          const containerId = event.Actor.ID;

          // Emit event when create, update or die action is detected
          switch (event.Action) {
            case 'create':
            case 'start':
            case 'die':
              logger.debug(`${event.Action}: ${containerName}`);
              DockerService.events.emit(event.Action, {containerName, containerId});
              break;
            default:
              logger.debug(`${event.Action}: ${containerName}`);
              break;
          }
        }
      });

      data.on('error', (error: any) => {
        logger.error('Error while listening to docker events:', err);
      });
    });
  }


  /**
   * Returns a list of inspect information for all containers.
   *
   * @returns A promise that resolves to an array of `ContainerInspectInfo`.
   */
  public static async listContainers(): Promise<ContainerInspectInfo[]> {
    const containers = await DockerService.docker.listContainers({all: true});

    return Promise.all(
      containers.filter((container) => {
        return !(IgnoreService.ignoreContainer(container))
      }).map(async (container) => {
        const containerInfo = await DockerService.docker.getContainer(container.Id).inspect();
        return containerInfo;
      })
    );
  }


  /**
   * Gets the Docker image registry for the specified image name.
   *
   * @param imageName - The name of the Docker image.
   * @param tag - The tag of the Docker image.
   * @returns A promise that resolves to an object with the registry name
   */
  public static async getImageRegistryName(imageName: string): Promise<string> {
    return ImageRegistryAdapterFactory.getRegistryName(imageName);
  }

  /**
   * Gets the new docker image digest for the specified image name.
   * @param imageName - The name of the Docker image.
   * @param tag - The tag of the Docker image.
   * @param oldDigest - The old digest of the Docker image.
   * @returns A promise that resolves to a string containing the new digest.
   */
  public static async getImageNewDigest(imageName: string, tag: string, oldDigest: string): Promise<string | null> {
    try {
      let adapter = ImageRegistryAdapterFactory.getAdapter(imageName, tag);
      adapter['oldDigest'] = oldDigest;
      let response = await adapter.checkForNewDigest();

      if (response.isDifferent) {
        return response.newDigest;
      } else {
        return oldDigest;
      }

    } catch (error: any) {
      logger.error(imageName, tag, oldDigest);
      logger.error(error);
      return null;
    }
  }


  /**
   * Gets the private registry for the specified image name.
   *
   * @param imageName - The name of the Docker image.
   * @returns The private registry or `null` if it is not found.
   */
  public static getPrivateRegistry(imageName: string): string | null {
    const parts = imageName.split("/");
    if (parts.length >= 2) {
      return parts[0];
    }
    return null;
  }

  /**
   * Gets the inspect information for the specified Docker image.
   *
   * @param imageId - The ID of the Docker image.
   * @returns A promise that resolves to an `ImageInspectInfo` object.
   */
  public static async getImageInfo(imageId: string): Promise<Docker.ImageInspectInfo> {
    return await DockerService.docker.getImage(imageId).inspect();
  }

  /**
   * Updates a Docker container with the latest image.
   *
   * @param containerId - The ID of the Docker container to update.
   * @returns A promise that resolves to the new Docker container.
   */
  public static async updateContainer(containerId: string) {
    try {
      logger.info(`Updating container: ${containerId}`);

      const container = DockerService.docker.getContainer(containerId);
      const info = await container.inspect();
      const oldImageId = info.Image;
      const image = info.Config.Image;
      const imageName = image.split(":")[0];

      // Prevent updating MqDockerUp from itself
      if (imageName.toLowerCase() === "mqdockerup") {
        logger.error("You cannot update MqDockerUp from within MqDockerUp. Please update MqDockerUp manually.");
        return;
      }

      // Store layer progress here
      const layerProgress: Record<string, { current: number; total: number }> = {};
      let lastPublishTime = 0;

      await DockerService.docker.pull(image, async (err: any, stream: any) => {
        logger.info("Pulling image: " + image);
        if (err) {
          logger.error("Pulling Error: " + err);
          return;
        }

        this.updatingContainers.push(containerId);

        DockerService.docker.modem.followProgress(
          stream,
          async (err: any, output: any) => {
            if (err) {
              logger.error("Stream Error: " + err);
              return;
            }

            logger.info("Image pulled successfully");

            const containerConfig: any = {
              ...info,
              ...info.Config,
              ...info.HostConfig,
              ...info.NetworkSettings,
              name: info.Name,
              Image: image,
            };

            const mounts = info.Mounts;
            const binds = mounts.map(
              (mount) => `${mount.Source}:${mount.Destination}`
            );
            containerConfig.HostConfig.Binds = binds;

            try {
              // Restart the container with the new image
              await container.stop();
              await container.remove();
              const newContainer = await DockerService.docker.createContainer(containerConfig);
              await newContainer.start();

              // Remove old image
              DockerService.docker
                .getImage(oldImageId)
                .remove({ force: true }, (err, data) => {
                  if (err) {
                    logger.error("Error removing old image: " + err);
                  } else {
                    logger.info("Old image removed successfully");
                  }
                });

              // Publish final 100% progress
              await HomeassistantService.publishUpdateProgressMessage(info, mqttClient, 100, false);
              this.updatingContainers = this.updatingContainers.filter((id) => id !== containerId);

              return newContainer;
            } catch (error) {
              logger.error("Error restarting container with new image");
              logger.error(error);
              throw error;
            }
          },
          (event) => {
            logger.debug(`Status: ${event.status}`);

            if (event.progressDetail && event.id) {
              // Update the layer progress
              layerProgress[event.id] = {
                current: event.progressDetail.current || 0,
                total: event.progressDetail.total || 0,
              };

              // Recalculate total progress
              const totalCurrent = Object.values(layerProgress).reduce((acc, layer) => acc + layer.current, 0);
              const totalSize = Object.values(layerProgress).reduce((acc, layer) => acc + layer.total, 0);

              if (totalSize > 0) {
                const percentage = Math.round((totalCurrent / totalSize) * 100);
                logger.debug(`Total progress: ${totalCurrent}/${totalSize} (${percentage}%)`);

                // Publish progress updates with a debounce (e.g., every 1 second)
                const now = Date.now();
                if (now - lastPublishTime >= 1000) {
                  lastPublishTime = now;
                  HomeassistantService.publishUpdateProgressMessage(info, mqttClient, percentage, true);
                }
              }
            }
          }
        );
      });
    } catch (error: any) {
      logger.error("Error updating container");
      logger.error(error);
    }
  }


  /**
   * Stops a Docker container.
   *
   * @param containerId - The ID of the Docker container to stop.
   */
  public static async stopContainer(containerId: string) {
    const container = DockerService.docker.getContainer(containerId);
    await container.stop();
  }

  /**
   * Starts a Docker container.
   *
   * @param containerId - The ID of the Docker container to start.
   */
  public static async startContainer(containerId: string) {
    const container = DockerService.docker.getContainer(containerId);
    await container.start();
  }

  /**
   * Removes a Docker container.
   * @param containerId - The ID of the Docker container to remove.
   */
  public static async removeContainer(containerId: string) {
    const container = DockerService.docker.getContainer(containerId);
    await container.remove();
  }

  /**
   * Pauses a Docker container.
   * @param containerId - The ID of the Docker container to pause.
   * @returns A promise that resolves when the container is paused.
   */
  public static async pauseContainer(containerId: string) {
    const container = DockerService.docker.getContainer(containerId);
    await container.pause();
  }

  /**
   * Unpauses a Docker container.
   * @param containerId - The ID of the Docker container to unpause.
   * @returns A promise that resolves when the container is unpaused.
   */
  public static async unpauseContainer(containerId: string) {
    const container = DockerService.docker.getContainer(containerId);
    await container.unpause();
  }

  /**
   * Restarts a Docker container.
   * @param containerId - The ID of the Docker container to restart.
   * @returns A promise that resolves when the container is restarted.
   */
  public static async restartContainer(containerId: string) {
    const container = DockerService.docker.getContainer(containerId);
    await container.restart();
    await container.wait();
  }

  /**
   * Creates a Docker container.
   * @param imageName - The name of the Docker image to use.
   * @param containerName - The name of the Docker container to create.
   * @param containerConfig - The configuration for the Docker container.
   * @returns A promise that resolves to the new Docker container.
   * @throws An error if the container could not be created.
   */
  public static async createContainer(containerConfig: any): Promise<Docker.Container> {
    const container = await DockerService.docker.createContainer({
      ...containerConfig,
    });

    return container;
  }

  /**
   * Checks if a container exists.
   * @param containerImage - The name of the Docker image to check.
   * @returns A promise that resolves to true if the container exists.
   * TODO: Change to check if container is running by using the container id instead of the image name
   */
  public static async checkIfContainerExists(containerImage: string): Promise<boolean> {
    return DockerService.docker.listContainers({all: true}).then((containers) => {
      const imageWithoutTag = containerImage.replace(/:.*/, "");
      const imageWithAnyTag = new RegExp(`^${imageWithoutTag}(:.*)?$`);

      return containers.some((container) => container.Image.match(imageWithAnyTag));
    });
  }
}

// Start listening to Docker events
DockerService.listenToDockerEvents();
