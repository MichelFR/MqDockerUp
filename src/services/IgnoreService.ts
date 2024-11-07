import {ContainerInspectInfo, ContainerInfo} from "dockerode";
import ConfigService from "./ConfigService";


export default class IgnoreService{

  /**
   * Checks if a container should be ignored based on its labels and/or environment variables.
   * A container is ignored if it has the label "mqdockerup.ignore_container" set to "true" and/or its
   * name is included in the list of, comma separated, ignored containers in the configuration file or the env varaible "IGNORE_CONTAINERS" for docker.
   * @param container The container to check.
   * @returns A boolean indicating if the container should be ignored.
   */
  public static ignoreContainer(container: ContainerInfo){
      const ignoreContainerByLabel: boolean = ("Labels" in container) && ("mqdockerup.ignore_container" in container.Labels) && container.Labels["mqdockerup.ignore_container"] === "true";

      const contianersCommaList = ConfigService.getConfig()?.ignore?.containers;
      const ignoreContainerByEnv: boolean = container.Names.some(name => contianersCommaList.includes(name.replace("/", "")));

      return ignoreContainerByLabel || ignoreContainerByEnv;
  }

  /**
   * Checks if a container should be ignored for updates based on its labels and/or environment variables.
   * A container is ignored if it has the label "mqdockerup.ignore_update" set to "true" and/or its
   * name is included in the list of, comma separated, ignored containers in the configuration file or the env varaible "IGNORE_UPDATES" for docker.
   *
   * @param container The container to check.
   * @returns A boolean indicating if the container should be ignored for updates.
   */
  public static ignoreUpdates(container: ContainerInspectInfo) {
    const ignoreUpdatesByLabel: boolean = ("Labels" in container.Config) && ("mqdockerup.ignore_updates" in container.Config.Labels) && container.Config.Labels["mqdockerup.ignore_updates"] === "true";

    const contianersCommaList = ConfigService.getConfig()?.ignore?.updates;
    const ignoreUpdatesByEnv = contianersCommaList.includes(container.Name.replace("/",""));

    return ignoreUpdatesByLabel || ignoreUpdatesByEnv
  }





}