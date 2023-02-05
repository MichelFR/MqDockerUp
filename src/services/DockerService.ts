import Docker from "dockerode";
import { ContainerInspectInfo } from "dockerode";

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

  public static async getImageInfo(imageId: string): Promise<Docker.ImageInspectInfo> {
    return await DockerService.docker.getImage(imageId).inspect();
  }

  public static async updateContainer(containerId: string, targetImageId: string) {
    const container = DockerService.docker.getContainer(containerId);
    const updatedContainer = await container.update({ Image: targetImageId });
    return updatedContainer;
  }
}
