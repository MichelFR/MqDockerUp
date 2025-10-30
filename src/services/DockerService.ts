import Docker from "dockerode";
import {ContainerInspectInfo} from "dockerode";
import {EventEmitter} from 'events';
import {ImageRegistryAdapterFactory} from "../registry-factory/ImageRegistryAdapterFactory";
import logger from "./LoggerService";
import IgnoreService from "./IgnoreService";
import HomeassistantService from "./HomeassistantService";
import axios, { AxiosInstance } from 'axios';
import {mqttClient} from "../index";

// Add interface for mount types
interface DockerMount {
  Name?: string;
  Type: 'bind' | 'volume' | 'tmpfs';
  Source: string;
  Destination: string;
  Driver?: string;
  Mode: string;
  RW: boolean;
  Propagation: string;
}

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
    const handledActions = new Set([
      'create',
      'start',
      'die',
      'health_status',
      'stop',
      'destroy',
      'rename',
      'update',
      'pause',
      'unpause',
      'restart',
    ]);

    DockerService.docker.getEvents({}, (err: any, data: any) => {
      if (err) {
        logger.error('Error while listening to docker events:', err);
        return;
      }

      data.on('data', (chunk: any) => {
        try {
          const event = JSON.parse(chunk.toString());

          if (event.Type === 'container') {
            const containerName = event.Actor.Attributes.name;
            const containerId = event.Actor.ID;

            if (handledActions.has(event.Action)) {
              logger.debug(`${event.Action}: ${containerName}`);
              DockerService.events.emit(event.Action, { containerName, containerId });
            } else {
              logger.debug(`${event.Action}: ${containerName}`);
            }
          }
        } catch (error) {
          logger.error('Error parsing Docker event JSON:', error, 'Chunk:', chunk.toString());
        }
      });

      data.on('error', (error: any) => {
        logger.error('Error while listening to docker events:', error);
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
   * @returns A promise that resolves to a string containing the new digest.
   */
  public static async getImageNewDigest(imageName: string, tag: string): Promise<string | null> {
    try {
      let adapter = ImageRegistryAdapterFactory.getAdapter(imageName, tag);
      let response = await adapter.checkForNewDigest();

      return response.newDigest;
      
    } catch (error: any) {
      logger.error(imageName, tag);
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
   * Determines how the container was created.
   * Returns "Composer" when compose labels are present otherwise "Docker".
   *
   * @param container - Container inspect info
   */
  public static getCreatedBy(container: ContainerInspectInfo): string {
    const labels = container?.Config?.Labels || {};
    return Object.keys(labels).some((label) => label.startsWith("com.docker.compose"))
      ? "Composer"
      : "Docker";
  }

  /**
   * Gets the source repository for the specified Docker image.
   * @param imageName - The name of the Docker image.
   * @param imageTag - The tag of the Docker image.
   * @returns A promise that resolves to the source repository URL.
   * @throws An error if the source repository could not be found.
   */
  public static async getSourceRepo(imageName: string, imageTag: string): Promise<string | null> {
    // Check cache first
    const cachedUrl = DockerService.SourceUrlCache.get(imageName) ?? DockerService.SourceUrlCache.get(imageName + ":" + imageTag);
    if (cachedUrl) {
      return cachedUrl;
    }

    // Try method 1: Check Docker labels
    const labels = await DockerService.getImageInfo(imageName + ":" + imageTag).then(
      (info) => info.Config.Labels
    ).catch((error) => {
      logger.error("Error getting image info:", error
      );
    });

    if (labels && labels["org.opencontainers.image.source"]) {
      const url = labels["org.opencontainers.image.source"];
      DockerService.SourceUrlCache.set(imageName + ":" + imageTag, url);
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

  public static async updateContainer(containerId: string) {
    try {
      logger.info(`Updating individual container: ${containerId}`);

      const container = DockerService.docker.getContainer(containerId);
      
      let info = null
      try {
        info = await container.inspect();
      } catch (err: any) {
        if (err.statusCode === 404) {
          logger.warn(`Container ${containerId} no longer exists`);
        } else {
          logger.error(`Failed to inspect container ${containerId}:`, err);
          throw err;
        }
      }

      if (info) {
        const oldImageId = info.Image;
        const image = info.Config.Image;
        const imageName = image.split(":")[0];

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
            async (err: any) => {
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
                // info.Name includes a leading slash, which causes the name
                // to be dropped when recreating the container. Strip it so the
                // container keeps its original name after an update.
                name: info.Name.startsWith("/") ? info.Name.substring(1) : info.Name,
                Image: image,
              };

              // The container will start with a new ID
              containerConfig.Id = "";

              const mounts = info.Mounts as DockerMount[];
              // Handle different mount types properly
              const binds: string[] = [];
              const volumes: { [key: string]: {} } = {};

              mounts.forEach((mount) => {
                if (mount.Type === 'bind') {
                  binds.push(`${mount.Source}:${mount.Destination}${mount.Mode ? ':' + mount.Mode : ''}`);
                } else if (mount.Type === 'volume') {
                  // For named volumes, we just need to ensure they're in the volumes configuration
                  const volumeName = mount.Name || mount.Source;
                  volumes[volumeName] = {};
                }
              });

              containerConfig.HostConfig.Binds = binds;
              containerConfig.Volumes = volumes;

              logger.debug(`Container config prepared for update: ${JSON.stringify(containerConfig, null, 2)}`);


              try {
                await container.stop();
                await container.remove();
                const newContainer = await DockerService.docker.createContainer(containerConfig);
                await newContainer.start();

                // Remove old image
                try {
                  DockerService.docker
                    .getImage(oldImageId)
                    .remove({ force: true }, (err, data) => {
                      if (err) {
                        logger.error("Error removing old image: " + err);
                      } else {
                        logger.info("Old image removed successfully");
                      }
                    });
                } catch (e) {
                  logger.error("Error removing old image: " + e);
                }


                // Publish final 100% progress
                await HomeassistantService.publishUpdateProgressMessage(info, mqttClient, 100, false);
                this.updatingContainers = this.updatingContainers.filter((id) => id !== containerId);

                return container;
              } catch (error) {
                logger.error("Error starting container with new image");
                logger.error(error);
                throw error;
              }
            },
            (event) => {
              logger.debug(`Status: ${event.status}`);

              if (event.id) {
                const layer = layerProgress[event.id] || { current: 0, total: 0 };

                if (event.progressDetail && (event.progressDetail.current || event.progressDetail.total)) {
                  layer.current = event.progressDetail.current || layer.current;
                  layer.total = event.progressDetail.total || layer.total;
                }

                if (["Pull complete", "Download complete", "Already exists"].includes(event.status)) {
                  layer.current = layer.total || layer.current;
                }

                layerProgress[event.id] = layer;

                const totalCurrent = Object.values(layerProgress).reduce((acc, l) => acc + l.current, 0);
                const totalSize = Object.values(layerProgress).reduce((acc, l) => acc + l.total, 0);

                if (totalSize > 0) {
                  const percentage = Math.min(100, Math.round((totalCurrent / totalSize) * 100));
                  logger.debug(`Total progress: ${totalCurrent}/${totalSize} (${percentage}%)`);

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
      }
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
