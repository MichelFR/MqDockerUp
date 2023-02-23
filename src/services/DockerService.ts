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
      const response = await axios.get(`https://registry.hub.docker.com/v2/repositories/${imageName}/tags?name=${tag}`);
      if (response.status === 200) {
        return { registry: 'Docker Hub', response };
      }
    } catch (error) {}
  
    const registryList = [
      { name: 'eu.gcr.io', displayName: 'Google Cloud Registry (EU)', checkEndsWith: true },
      { name: 'asia.gcr.io', displayName: 'Google Cloud Registry (Asia)', checkEndsWith: true },
      { name: 'us.gcr.io', displayName: 'Google Cloud Registry (US)', checkEndsWith: true },
      { name: 'docker.pkg.airfocus.io', displayName: 'Airfocus Container Registry' },
      { name: 'quay.io', displayName: 'Quay.io' },
      { name: 'gcr.io', displayName: 'Google Container Registry' },
      { name: 'registry.access.redhat.com', displayName: 'Red Hat Registry' },
      { name: 'ghcr.io', displayName: 'GitHub Container Registry' },
      { name: 'docker.io', displayName: 'Docker Hub' },
      { name: 'amazonaws.com', displayName: 'Amazon Elastic Container Registry', checkEndsWith: true },
      { name: 'mcr.microsoft.com', displayName: 'Microsoft Container Registry' },
      { name: 'docker.pkg.github.com', displayName: 'GitHub Packages Container Registry' },
      { name: 'harbor.domain.com', displayName: 'VMware Harbor Registry' },
      { name: 'docker.elastic.co', displayName: 'Elastic Container Registry' },
      { name: 'registry.gitlab.com', displayName: 'GitLab Container Registry' },
      { name: 'k8s.gcr.io', displayName: 'Google Kubernetes Engine Registry' },
      { name: 'docker.pkg.digitalocean.com', displayName: 'DigitalOcean Container Registry' },
    ];
  
    for (const registry of registryList) {
      if (registry.checkEndsWith && imageName.endsWith(`/${registry.name}`)) {
        return { registry: registry.displayName, response: null };
      } else if (!registry.checkEndsWith && imageName.startsWith(`${registry.name}/`)) {
        return { registry: registry.displayName, response: null };
      }
    }
  
    return { registry: 'No registry (self-built?)', response: null };
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
