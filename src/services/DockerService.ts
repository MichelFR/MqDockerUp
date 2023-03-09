import Docker from "dockerode";
import { ContainerInspectInfo } from "dockerode";
import axios from "axios";
import logger from "./LoggerService"
import HomeassistantService from "./HomeassistantService";


/**
 * Represents a Docker service for managing Docker containers and images.
 */
export default class DockerService {
  private static docker = new Docker();

  /**
   * Returns a list of inspect information for all containers.
   *
   * @returns A promise that resolves to an array of `ContainerInspectInfo`.
   */
  public static async listContainers(): Promise<ContainerInspectInfo[]> {
    const containers = await DockerService.docker.listContainers();

    return Promise.all(
      containers.map(async (container) => {
        const containerInfo = await DockerService.docker
          .getContainer(container.Id)
          .inspect();
        return containerInfo;
      })
    );
  }

  /**
   * Gets the Docker image registry and response information for the specified image name and tag.
   *
   * @param imageName - The name of the Docker image.
   * @param tag - The tag of the Docker image.
   * @returns A promise that resolves to an object with `registry` and `response` properties.
   */
  public static async getImageRegistry(
    imageName: string,
    tag: string
  ): Promise<{ registry: any; response: any }> {
    try {
      const response = await axios.get(
        `https://registry.hub.docker.com/v2/repositories/${imageName}/tags?name=${tag}`
      );
      if (response.status === 200) {
        return { registry: "Docker Hub", response };
      }
    } catch (error) { }

    const registryList = [
      {
        name: "eu.gcr.io",
        displayName: "Google Cloud Registry (EU)",
        checkEndsWith: true,
      },
      {
        name: "asia.gcr.io",
        displayName: "Google Cloud Registry (Asia)",
        checkEndsWith: true,
      },
      {
        name: "us.gcr.io",
        displayName: "Google Cloud Registry (US)",
        checkEndsWith: true,
      },
      {
        name: "docker.pkg.airfocus.io",
        displayName: "Airfocus Container Registry",
      },
      { name: "quay.io", displayName: "Quay.io" },
      { name: "lscr.io", displayName: "linuxserver.io (lscr.io)" },
      { name: "gcr.io", displayName: "Google Container Registry" },
      { name: "registry.access.redhat.com", displayName: "Red Hat Registry" },
      { name: "ghcr.io", displayName: "GitHub Container Registry" },
      { name: "docker.io", displayName: "Docker Hub" },
      {
        name: "amazonaws.com",
        displayName: "Amazon Elastic Container Registry",
        checkEndsWith: true,
      },
      {
        name: "mcr.microsoft.com",
        displayName: "Microsoft Container Registry",
      },
      {
        name: "docker.pkg.github.com",
        displayName: "GitHub Packages Container Registry",
      },
      { name: "harbor.domain.com", displayName: "VMware Harbor Registry" },
      { name: "docker.elastic.co", displayName: "Elastic Container Registry" },
      { name: "registry.gitlab.com", displayName: "GitLab Container Registry" },
      { name: "k8s.gcr.io", displayName: "Google Kubernetes Engine Registry" },
      {
        name: "docker.pkg.digitalocean.com",
        displayName: "DigitalOcean Container Registry",
      },
    ];

    for (const registry of registryList) {
      if (registry.checkEndsWith && imageName.endsWith(`${registry.name}`)) {
        return { registry: registry.displayName, response: null };
      } else if (
        !registry.checkEndsWith &&
        imageName.startsWith(`${registry.name}`)
      ) {
        return { registry: registry.displayName, response: null };
      }
    }

    return { registry: "No registry (self-built?)", response: null };
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
  public static async getImageInfo(
    imageId: string
  ): Promise<Docker.ImageInspectInfo> {
    return await DockerService.docker.getImage(imageId).inspect();
  }

  /**
   * Updates a Docker container with the latest image.
   *
   * @param containerId - The ID of the Docker container to update.
   * @returns A promise that resolves to the new Docker container.
   */
  public static async updateContainer(containerId: string, client: any) {
    const container = DockerService.docker.getContainer(containerId);
    const info = await container.inspect();
    const image = info.Config.Image;
    const imageName = image.split(":")[0];;

    // Catch the case if its trying to update MqDockerUp itself
    if (imageName.toLowerCase() === "mqdockerup") {
      console.error(
        "You cannot update MqDockerUp from within MqDockerUp. Please update MqDockerUp manually."
      );
      return;
    }

    let totalProgress = 0;
    let totalSize = 0;
    let lastProgressEvent = { progressDetail: { current: 0, total: 0 } };

    await DockerService.docker.pull(
      image,
      async (err: any, stream: any) => {
        // handle error
        if (err) {
          logger.error("Pulling Error: " + err);
          return;
        }
        // use modem.followProgress to get progress events
        DockerService.docker.modem.followProgress(
          stream,
          async (err: any, output: any) => {
            // handle error
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

            await container.stop();
            await container.remove();

            const newContainer = await DockerService.docker.createContainer(
              containerConfig
            );
            await newContainer.start();

            return newContainer;
          },
          function (event) {
            logger.info(`Status: ${event.status}`);
            // check if progressDetail exists
            if (event.progressDetail) {
              // get current, total and start values
              const current = event.progressDetail.current || 0;
              const total = event.progressDetail.total || 0;

              // calculate percentage based on the difference between the current and last progress events
              const percentage =
                current > lastProgressEvent.progressDetail.current
                  ? Math.round(((totalProgress + current - lastProgressEvent.progressDetail.current) / totalSize) * 100)
                  : Math.round((totalProgress / totalSize) * 100);

              // update total progress and size
              totalProgress += current - lastProgressEvent.progressDetail.current;
              totalSize += total - lastProgressEvent.progressDetail.total;

              // keep track of the last progress event
              lastProgressEvent = event;

              // print percentage
              logger.info(`Total progress: ${totalProgress}/${totalSize} (${percentage}%)`);

              // Send Progress to MQTT 
              HomeassistantService.publishUpdateMessage(container, client, percentage, totalSize - totalProgress, event.status, false);
            }
          }
        );
      }
    );
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
    const container = await DockerService.docker.createContainer({ ...containerConfig });

    return container;
  }

  /**
    * Checks if a container exists.
    * @param containerImage - The name of the Docker image to check.
    * @returns A promise that resolves to true if the container exists.
    */
  public static async checkIfContainerExists(containerImage: string): Promise<boolean> {
    const containers = await DockerService.docker.listContainers({ all: true });
    const container = containers.find((container) => container.Image === containerImage);
    return container !== undefined;
  }
}
