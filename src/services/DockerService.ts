import Docker from "dockerode";
import { ContainerInspectInfo } from "dockerode";
import axios from "axios";

export default class DockerService {
  private static docker = new Docker();

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
      } else {
        const registry = this.getPrivateRegistry(imageName);
        return { registry: registry || "No registry (self-built?)", response };
      }
    } catch (error: any) {
      if (error.response && error.response.status === 404) {
        const registry = this.getPrivateRegistry(imageName);
        return {
          registry: registry || "No registry (self-built?)",
          response: error.response,
        };
      } else {
        console.error(error);
        return { registry: "", response: null };
      }
    }
  }

  public static getPrivateRegistry(imageName: string): string | null {
    const parts = imageName.split("/");
    if (parts.length >= 2) {
      return parts[0];
    }
    return null;
  }

  public static async getImageInfo(
    imageId: string
  ): Promise<Docker.ImageInspectInfo> {
    return await DockerService.docker.getImage(imageId).inspect();
  }

  public static async updateContainer(containerId: string) {
    // TODO: Catch the case if its trying to update MqDockerUp itself

    // Get the old container and its information
    const container = DockerService.docker.getContainer(containerId);
    const info = await container.inspect();

    // Stop and remove the old container
    await container.stop();
    await container.remove();

    // Pull the latest image for the new container
    const imageName = info.Config.Image;
    await DockerService.docker.pull(imageName);

    // Create the configuration for the new container
    const containerConfig: any = {
      ...info,
      ...info.Config,
      ...info.HostConfig,
      ...info.NetworkSettings,
      name: info.Name,
      Image: imageName,
    };

    // Map the volumes from the old container to the new container
    const mounts = info.Mounts;
    const binds = mounts.map((mount) => `${mount.Source}:${mount.Destination}`);
    containerConfig.HostConfig.Binds = binds;

    // Create and start the new container
    const newContainer = await DockerService.docker.createContainer(
      containerConfig
    );
    await newContainer.start();

    // Return the new container
    return newContainer;
  }

  public static async stopContainer(containerId: string) {
    const container = DockerService.docker.getContainer(containerId);
    await container.stop();
  }

  public static async startContainer(containerId: string) {
    const container = DockerService.docker.getContainer(containerId);
    await container.start();
  }
}
