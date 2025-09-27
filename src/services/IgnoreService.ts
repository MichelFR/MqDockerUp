import { ContainerInspectInfo, ContainerInfo } from "dockerode";
import ConfigService from "./ConfigService";
import logger from "./LoggerService";

const config = ConfigService.getConfig();

export default class IgnoreService {

  /**
   * Checks if a container should be ignored based on its labels and/or environment variables.
   * A container is ignored if it has the label "mqdockerup.ignore_container" set to "true" and/or its
   * name is included in the list of, comma separated, ignored containers in the configuration file or the environment variable "IGNORE_CONTAINERS" for docker, `*` to apply to all containers.
   * @param container The container to check.
   * @returns A boolean indicating if the container should be ignored.
   */
  public static ignoreContainer(container: ContainerInfo) {
    if (config?.ignore?.containers != "*") {
      const ignoreContainerByLabel: boolean = ("Labels" in container) && ("mqdockerup.ignore_container" in container.Labels) && container.Labels["mqdockerup.ignore_container"] === "true";

      const containersCommaList = config?.ignore?.containers;
      const ignoreContainerByEnv: boolean = container.Names.some(name => containersCommaList.includes(name.replace("/", "")));

      return ignoreContainerByLabel || ignoreContainerByEnv;

    } else {
      return true
    }
  }

  /**
   * Checks if a container should be ignored for updates based on its labels and/or environment variables.
   * A container is ignored if it has the label "mqdockerup.ignore_updates" set to "true" and/or its
   * name is included in the list of, comma separated, ignored containers in the configuration file or the environment variable "IGNORE_UPDATES" for docker, `*` to apply to all containers.
   * Additionally, MqDockerUp containers are automatically ignored to prevent self-updates.
   *
   * @param container The container to check.
   * @returns A boolean indicating if the container should be ignored for updates.
   */
  public static ignoreUpdates(container: ContainerInspectInfo) {
    if (config?.ignore?.updates != "*") {
      const ignoreMQDockerUp = this.ignoreMQDockerUpContainers(container);

      const ignoreUpdatesByLabel: boolean = ("Labels" in container.Config) && ("mqdockerup.ignore_updates" in container.Config.Labels) && container.Config.Labels["mqdockerup.ignore_updates"] === "true";

      const containersCommaList = config?.ignore?.updates;
      const ignoreUpdatesByEnv = containersCommaList.includes(container.Name.replace("/", ""));

      return ignoreUpdatesByLabel || ignoreUpdatesByEnv || ignoreMQDockerUp;

    } else {
      return true
    }
  }

  // Always ignore MqDockerUp containers to prevent self-updates
  private static ignoreMQDockerUpContainers(container: ContainerInspectInfo) {
    const fullImageName = container.Config.Image;  
    const lastColon = fullImageName.lastIndexOf(':');  
    const lastSlash = fullImageName.lastIndexOf('/');  
    // If a colon exists and it's after the last slash, it's likely a tag.  
    const imageNameWithoutTag = lastColon > lastSlash ? fullImageName.substring(0, lastColon) : fullImageName;  

    const isMqDockerUp = imageNameWithoutTag.toLowerCase().includes("mqdockerup");  
    if (isMqDockerUp) {  
      logger.debug(`Ignoring MqDockerUp container updates for ${fullImageName}`);  
    }  
    return isMqDockerUp;  
  }

}