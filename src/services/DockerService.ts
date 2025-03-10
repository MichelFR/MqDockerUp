import Docker from "dockerode";
import {ContainerInspectInfo} from "dockerode";
import {EventEmitter} from 'events';
import {ImageRegistryAdapterFactory} from "../registry-factory/ImageRegistryAdapterFactory";
import logger from "./LoggerService";
import IgnoreService from "./IgnoreService";
import HomeassistantService from "./HomeassistantService";
import axios, { AxiosInstance } from 'axios';
import {mqttClient} from "../index";

/**
 * Represents a Docker service for managing Docker containers and images.
 */
export default class DockerService {
  public static docker = new Docker();
  public static events = new EventEmitter();
  public static updatingContainers: string[] = [];
  public static SourceUrlCache = new Map<string, string>();

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
   * Gets the source repository for the specified Docker image.
   * @param imageName - The name of the Docker image.
   * @returns A promise that resolves to the source repository URL.
   * @throws An error if the source repository could not be found.
   */
  public static async getSourceRepo(imageName: string): Promise<string | null> {
    // Check cache first
    if (DockerService.SourceUrlCache.has(imageName)) {
      return DockerService.SourceUrlCache.get(imageName) ?? null;
    }

    // Try method 1: Check Docker labels
    const labels = await DockerService.getImageInfo(imageName).then(
      (info) => info.Config.Labels
    ).catch((error) => {
      logger.error("Error getting image info:", error
      );
    });

    if (labels && labels["org.opencontainers.image.source"]) {
      const url = labels["org.opencontainers.image.source"];
      DockerService.SourceUrlCache.set(imageName, url);
      return url;
    }

    // Try method 2: Check Docker Hub API
    const dockerHubUrl = `https://hub.docker.com/v2/repositories/${imageName}`;
    const response = await axios.get(dockerHubUrl).catch((error) => {
      if (error.response.status === 404) {
        logger.info(`Repository not found: ${imageName}`);
      } else {
        logger.error("Error accessing Docker Hub API:", error);
      }
    });

    if (response && response.status === 200) {
      const data = response.data;
      const fullDescription = data.full_description || "";
      if (!fullDescription.toLowerCase().includes("[github]")) {
        return null;
      }

      const url = this.parseGithubUrl(fullDescription);

      // Cache URL
      if (url !== null) {
        DockerService.SourceUrlCache.set(imageName, url);
        return url;
      }
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
   * Checks if a container is part of a Docker Compose project
   * @param containerId The ID of the container to check
   * @returns Object containing project name and service name if container is part of a compose project, null otherwise
   */
  private static async getComposeInfo(containerId: string): Promise<{ projectName: string; serviceName: string } | null> {
    try {
      const container = DockerService.docker.getContainer(containerId);
      const info = await container.inspect();
      
      // Docker Compose adds these labels to identify containers
      const labels = info.Config.Labels || {};
      const projectName = labels['com.docker.compose.project'];
      const serviceName = labels['com.docker.compose.service'];
      
      if (projectName && serviceName) {
        return { projectName, serviceName };
      }
      return null;
    } catch (error) {
      logger.error(`Error getting compose info for container ${containerId}:`, error);
      return null;
    }
  }

  /**
   * Updates all containers in a Docker Compose project
   * @param projectName The name of the Docker Compose project
   */
  public static async updateComposeProject(projectName: string): Promise<void> {
    try {
      logger.info(`Updating Docker Compose project: ${projectName}`);
      
      // List all containers in the project
      const containers = await DockerService.listContainers();
      const projectContainers = containers.filter(container => {
        const containerInfo = container as any;
        return containerInfo.Labels && containerInfo.Labels['com.docker.compose.project'] === projectName;
      });

      if (projectContainers.length === 0) {
        logger.warn(`No containers found for project ${projectName}`);
        return;
      }

      // Get the directory containing the compose file
      const firstContainer = projectContainers[0] as any;
      const composeDir = firstContainer.Labels['com.docker.compose.project.working_dir'];
      if (!composeDir) {
        throw new Error('Could not determine Docker Compose working directory');
      }

      // Pull new images for all services
      for (const container of projectContainers) {
        const containerInfo = container as any;
        const image = containerInfo.Config.Image;
        logger.info(`Pulling image for service ${containerInfo.Labels['com.docker.compose.service']}: ${image}`);
        await DockerService.docker.pull(image);
      }

      // Run docker-compose up -d to update the containers
      const { exec } = require('child_process');
      await new Promise((resolve, reject) => {
        exec('docker-compose up -d', { cwd: composeDir }, (error: any, stdout: any, stderr: any) => {
          if (error) {
            logger.error(`Error updating compose project: ${error.message}`);
            reject(error);
            return;
          }
          if (stderr) {
            logger.warn(`Compose update warning: ${stderr}`);
          }
          logger.info(`Compose update output: ${stdout}`);
          resolve(null);
        });
      });

      logger.info(`Successfully updated Docker Compose project: ${projectName}`);
    } catch (error) {
      logger.error(`Error updating Docker Compose project ${projectName}:`, error);
      throw error;
    }
  }

  public static async updateContainer(containerId: string) {
    try {
      logger.info(`Checking container update type: ${containerId}`);

      // Check if container is part of a compose project
      const composeInfo = await DockerService.getComposeInfo(containerId);
      if (composeInfo) {
        logger.info(`Container ${containerId} is part of Docker Compose project ${composeInfo.projectName}`);
        await DockerService.updateComposeProject(composeInfo.projectName);
        return;
      }

      // If not a compose container, proceed with regular container update
      logger.info(`Updating individual container: ${containerId}`);

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

  /**
   * Parses a GitHub URL from a full description.
   * @param fullDescription - The full description to parse.
   * @returns The GitHub URL or `null` if it could not be parsed.
   */
  private static parseGithubUrl(fullDescription: string): string | null {
    const startIndex = fullDescription.indexOf("[github");
    const endIndex = fullDescription.indexOf("]", startIndex);
    if (startIndex !== -1 && endIndex !== -1) {
      return fullDescription.slice(startIndex, endIndex).replace("[github]", "");
    }
    return null;
  }
}

// Start listening to Docker events
DockerService.listenToDockerEvents();
