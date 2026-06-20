import { ContainerInspectInfo, ContainerInfo } from "dockerode";
import ConfigService from "./ConfigService";
import logger from "./LoggerService";

const config = ConfigService.getConfig();

export default class IgnoreService {

  /**
   * Checks if a container should be ignored based on its labels and/or environment variables.
   * A container is ignored if it has the label "mqdockerup.ignore_container" set to "true" and/or its
   * name is included in the list of, comma separated, ignored containers in the configuration file or the environment variable "IGNORE_CONTAINERS" for docker, `*` to apply to all containers.
   *
   * When a monitor (whitelist) is configured via `monitor.containers` / "MONITOR_CONTAINERS" or the
   * label "mqdockerup.monitor_container", only the listed containers are monitored and every other
   * container is ignored. An explicit ignore (label or list) always wins over the whitelist.
   * @param container The container to check.
   * @returns A boolean indicating if the container should be ignored.
   */
  public static ignoreContainer(container: ContainerInfo) {
    // Ignore every container.
    if (config?.ignore?.containers === "*") {
      return true;
    }

    // Explicit ignore by label or env list always wins.
    const ignoreContainerByLabel: boolean = ("Labels" in container) && ("mqdockerup.ignore_container" in container.Labels) && container.Labels["mqdockerup.ignore_container"] === "true";

    const containersCommaList = config?.ignore?.containers;
    const ignoreContainerByEnv: boolean = container.Names.some(name => containersCommaList.includes(name.replace("/", "")));

    if (ignoreContainerByLabel || ignoreContainerByEnv) {
      return true;
    }

    // Whitelist: when active, ignore everything that is not explicitly allowed.
    if (this.isWhitelistActive(config?.monitor?.containers)) {
      const monitorByLabel: boolean = ("Labels" in container) && ("mqdockerup.monitor_container" in container.Labels) && container.Labels["mqdockerup.monitor_container"] === "true";
      const monitorByEnv: boolean = this.matchesList(container.Names, config?.monitor?.containers);

      if (!(monitorByLabel || monitorByEnv)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Checks if a container should be ignored for updates based on its labels and/or environment variables.
   * A container is ignored if it has the label "mqdockerup.ignore_updates" set to "true" and/or its
   * name is included in the list of, comma separated, ignored containers in the configuration file or the environment variable "IGNORE_UPDATES" for docker, `*` to apply to all containers.
   * Additionally, MqDockerUp containers are automatically ignored to prevent self-updates.
   *
   * When a monitor (whitelist) is configured via `monitor.updates` / "MONITOR_UPDATES" or the label
   * "mqdockerup.monitor_updates", only the listed containers are checked for updates and every other
   * container is ignored. An explicit ignore (label, list or the MqDockerUp self-ignore) always wins.
   *
   * @param container The container to check.
   * @returns A boolean indicating if the container should be ignored for updates.
   */
  public static ignoreUpdates(container: ContainerInspectInfo) {
    // Ignore updates for every container.
    if (config?.ignore?.updates === "*") {
      return true;
    }

    // Always ignore MqDockerUp containers to prevent self-updates.
    if (this.ignoreMQDockerUpContainers(container)) {
      return true;
    }

    // Explicit ignore by label or env list always wins.
    const ignoreUpdatesByLabel: boolean = ("Labels" in container.Config) && ("mqdockerup.ignore_updates" in container.Config.Labels) && container.Config.Labels["mqdockerup.ignore_updates"] === "true";

    const containersCommaList = config?.ignore?.updates;
    const ignoreUpdatesByEnv = containersCommaList.includes(container.Name.replace("/", ""));

    if (ignoreUpdatesByLabel || ignoreUpdatesByEnv) {
      return true;
    }

    // Whitelist: when active, ignore updates for everything that is not explicitly allowed.
    if (this.isWhitelistActive(config?.monitor?.updates)) {
      const monitorByLabel: boolean = ("Labels" in container.Config) && ("mqdockerup.monitor_updates" in container.Config.Labels) && container.Config.Labels["mqdockerup.monitor_updates"] === "true";
      const monitorByEnv: boolean = this.matchesList([container.Name], config?.monitor?.updates);

      if (!(monitorByLabel || monitorByEnv)) {
        return true;
      }
    }

    return false;
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

  /**
   * Determines whether a monitor (whitelist) value actually restricts containers.
   * An empty value or `*` means "monitor all" and therefore disables the whitelist.
   * @param list The comma separated whitelist value.
   * @returns A boolean indicating if the whitelist is active.
   */
  private static isWhitelistActive(list: string | undefined): boolean {
    if (typeof list !== "string") {
      return false;
    }
    const trimmed = list.trim();
    return trimmed !== "" && trimmed !== "*";
  }

  /**
   * Performs an exact match of any of the given container names against a comma separated list.
   * Entries are split on commas, trimmed of whitespace, and matched against names with their
   * leading "/" stripped.
   * @param names The container names to check (with or without a leading "/").
   * @param commaList The comma separated list to match against.
   * @returns A boolean indicating if any name is contained in the list.
   */
  private static matchesList(names: string[], commaList: string | undefined): boolean {
    if (typeof commaList !== "string") {
      return false;
    }
    const entries = commaList.split(",").map(entry => entry.trim()).filter(Boolean);
    if (entries.length === 0) {
      return false;
    }
    return names.some(name => entries.includes(name.replace(/^\//, "")));
  }

}
