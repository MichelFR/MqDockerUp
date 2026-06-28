import DockerService from "./DockerService";
import ConfigService from "./ConfigService";
import DatabaseService from "./DatabaseService";
import logger from "./LoggerService"
import {ContainerInspectInfo, ImageInspectInfo} from "dockerode";
import IgnoreService from "./IgnoreService";
import TopicService from "./TopicService";

const config = ConfigService.getConfig();
const packageJson = require("../../package");

const suggestedArea = config.mqtt?.suggestedArea ?? "Docker";

interface PublishOptions {
  retain?: boolean;
  qos?: 0 | 1 | 2;
}

/** A Home Assistant sensor entity fed from the per-container state topic. */
interface SensorDefinition {
  key: string;
  name: string;
  valueName: string;
  icon: string;
  deviceClass?: string;
}

/** A Home Assistant button entity that sends a command for the container. */
interface ButtonDefinition {
  key: string;
  name: string;
  command: string;
  payloadOn: string;
  icon: string;
}

const SENSORS: SensorDefinition[] = [
  { key: "docker_id", name: "Container ID", valueName: "dockerId", icon: "mdi:key-variant" },
  { key: "docker_name", name: "Container Name", valueName: "dockerName", icon: "mdi:label" },
  { key: "docker_status", name: "Container Status", valueName: "dockerStatus", icon: "mdi:checkbox-marked-circle" },
  { key: "docker_uptime", name: "Container Uptime", valueName: "dockerUptime", icon: "mdi:timer-sand", deviceClass: "timestamp" },
  { key: "docker_created", name: "Container Created", valueName: "dockerCreated", icon: "mdi:calendar-clock", deviceClass: "timestamp" },
  { key: "docker_restart_count", name: "Container Restart Count", valueName: "dockerRestartCount", icon: "mdi:restart" },
  { key: "docker_restart_policy", name: "Container Restart Policy", valueName: "dockerRestartPolicy", icon: "mdi:restart" },
  { key: "docker_health", name: "Container Health", valueName: "dockerHealth", icon: "mdi:heart-pulse" },
  { key: "docker_ports", name: "Exposed Ports", valueName: "dockerPorts", icon: "mdi:lan-connect" },
  { key: "docker_image", name: "Docker Image", valueName: "dockerImage", icon: "mdi:image" },
  { key: "docker_tag", name: "Docker Tag", valueName: "dockerTag", icon: "mdi:tag" },
  { key: "docker_registry", name: "Docker Registry", valueName: "dockerRegistry", icon: "mdi:database" },
  { key: "docker_created_by", name: "Created By", valueName: "dockerCreatedBy", icon: "mdi:information" },
];

const BUTTONS: ButtonDefinition[] = [
  { key: "docker_manual_restart", name: "Manual Restart", command: "restart", payloadOn: "restart", icon: "mdi:restart" },
  { key: "docker_manual_start", name: "Start", command: "start", payloadOn: "start", icon: "mdi:play" },
  { key: "docker_manual_stop", name: "Stop", command: "stop", payloadOn: "stop", icon: "mdi:stop" },
  { key: "docker_manual_pause", name: "Pause", command: "pause", payloadOn: "pause", icon: "mdi:pause" },
  { key: "docker_manual_unpause", name: "Unpause", command: "unpause", payloadOn: "unpause", icon: "mdi:play-pause" },
];

const MANUAL_UPDATE_BUTTON: ButtonDefinition = {
  key: "docker_manual_update", name: "Manual Update", command: "manualUpdate", payloadOn: "update", icon: "mdi:arrow-up-bold-circle",
};

export default class HomeassistantService {

  /**
   * Last payload published to each retained topic. Retained messages survive
   * on the broker, so republishing an identical one is pure noise for the
   * broker and for Home Assistant — we skip those.
   */
  private static lastRetainedPayloads = new Map<string, string>();

  /**
   * Forgets what has been published so far. Must be called on every MQTT
   * (re)connect, since the broker may have restarted and lost its retained
   * messages.
   */
  public static resetPublishCache() {
    this.lastRetainedPayloads.clear();
  }

  /**
   * Published availability message to the MQTT broker to indicate if the service is online or offline
   * @param client The MQTT client
   * @param online Indicates if the service is online or offline
   */
  public static async publishAvailability(client: any, online: boolean) {
    const payload = online ? "online" : "offline";
    const topic = `${config.mqtt.topic}/availability`;

    this.publishMessage(client, topic, payload, {retain: true});
  }

  /**
   * Publishes the Home Assistant discovery configs for all (or the given) containers.
   * @param client The MQTT client
   * @param containers Already-inspected containers; fetched when omitted.
   */
  public static async publishConfigMessages(client: any, containers?: ContainerInspectInfo[]) {
    containers ??= await DockerService.listContainers();

    for (const container of containers) {
      await this.publishContainerDiscovery(client, container);
    }
  }

  /**
   * Publishes the Home Assistant discovery configs (sensors, buttons, update
   * entity) for a single container and records the container and its topics
   * in the database on first sight so they can be cleaned up later.
   * @param client The MQTT client
   * @param container The inspected container
   */
  public static async publishContainerDiscovery(client: any, container: ContainerInspectInfo) {
    const { image, tag } = this.splitImage(container);
    const containerName = container.Name.substring(1);
    const deviceName = TopicService.getDeviceName(container);
    const discoveryPrefix = config?.mqtt?.discoveryPrefix;

    const isNewContainer = !(await DatabaseService.containerExists(container.Id));
    if (isNewContainer) {
      logger.info(`Adding container ${containerName} to database`);
      await DatabaseService.addContainer(container.Id, containerName, image, tag);
    }

    const publishDiscovery = async (topic: string, payload: object) => {
      this.publishMessage(client, topic, payload, {retain: true});
      if (isNewContainer) {
        await DatabaseService.addTopic(topic, container.Id);
      }
    };

    for (const sensor of SENSORS) {
      await publishDiscovery(
        `${discoveryPrefix}/sensor/${deviceName}/${sensor.key}/config`,
        this.createPayload(sensor.name, image, tag, sensor.valueName, deviceName, sensor.deviceClass ?? null, sensor.icon)
      );
    }

    for (const button of BUTTONS) {
      await publishDiscovery(
        `${discoveryPrefix}/button/${deviceName}/${button.key}/config`,
        this.createButtonPayload(button, image, tag, deviceName, container.Id)
      );
    }

    if (!IgnoreService.ignoreUpdates(container)) {
      await publishDiscovery(
        `${discoveryPrefix}/button/${deviceName}/${MANUAL_UPDATE_BUTTON.key}/config`,
        this.createButtonPayload(MANUAL_UPDATE_BUTTON, image, tag, deviceName, container.Id)
      );
      await publishDiscovery(
        `${discoveryPrefix}/update/${deviceName}/docker_update/config`,
        this.createUpdatePayload("Update", image, tag, "dockerUpdate", deviceName, container.Id)
      );
    }
  }

  /**
   * Publishes the state message for all (or the given) containers.
   * @param client The MQTT client
   * @param containers Already-inspected containers; fetched when omitted.
   */
  public static async publishContainerMessages(client: any, containers?: ContainerInspectInfo[]) {
    containers ??= await DockerService.listContainers();

    for (const container of containers) {
      await this.publishContainerMessage(container, client);
    }
  }

  /**
   * Publishes update messages to the MQTT broker
   * @param client The MQTT client
   * @param containers Already-inspected containers; fetched when omitted.
   */
  public static async publishImageUpdateMessages(client: any, containers?: ContainerInspectInfo[]) {
    containers ??= await DockerService.listContainers();

    for (const container of containers) {
      if (IgnoreService.ignoreUpdates(container)) {
        continue;
      }

      try {
        await this.publishImageUpdateMessage(container, client);
      } catch (error: any) {
        logger.warn(
          `Skipping update check for container ${container.Name?.substring(1) || container.Id}: ${error.message || error}`
        );
      }
    }
  }

  /**
   * Publishes discovery and state for a single container — used when a Docker
   * event tells us exactly which container changed, so the rest of the fleet
   * is left alone.
   * @param client The MQTT client
   * @param container The inspected container
   */
  public static async publishContainer(client: any, container: ContainerInspectInfo) {
    await this.publishContainerDiscovery(client, container);
    await this.publishContainerMessage(container, client);
  }

  /**
   * Removes a container that no longer exists from Home Assistant by clearing
   * every retained discovery topic recorded for it, then forgets it in the
   * database. Does nothing if the container is unknown.
   * @param client The MQTT client
   * @param containerId The ID of the vanished container
   * @returns true if the container was known and has been removed
   */
  public static async removeContainer(client: any, containerId: string): Promise<boolean> {
    if (!(await DatabaseService.containerExists(containerId))) {
      return false;
    }

    const topics = await new Promise<any[]>((resolve) => {
      DatabaseService.getTopics(containerId, (err: any, rows: any[]) => {
        if (err) {
          logger.error("Error getting topics for cleanup: " + err);
          resolve([]);
          return;
        }
        resolve(rows);
      });
    });

    for (const { topic } of topics) {
      this.publishMessage(client, topic, "", { retain: true, qos: 0 });
    }

    await DatabaseService.deleteContainer(containerId);
    return true;
  }

  /**
   * Publishes a message to the MQTT broker. Identical retained messages are
   * skipped (see {@link lastRetainedPayloads}); an empty retained payload
   * clears the topic on the broker and removes the entity in Home Assistant.
   * @param client The MQTT client
   * @param topic The topic to publish the message to
   * @param payload The payload to publish
   * @param options MQTT publish options
   */
  public static async publishMessage(client: any, topic: string, payload: object | string, options: PublishOptions = {}) {
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);

    if (options.retain) {
      if (body === "") {
        this.lastRetainedPayloads.delete(topic);
      } else if (this.lastRetainedPayloads.get(topic) === body) {
        return;
      } else {
        this.lastRetainedPayloads.set(topic, body);
      }
    }

    client.publish(topic, body, options);
  }

  public static createPayload(
    name: string,
    image: string,
    tag: string,
    valueName: string,
    deviceName: string,
    deviceClass?: string | null,
    icon: string = "mdi:docker"
  ): object {
    const defaultEntityId = `sensor.${TopicService.slugify(deviceName)}_${TopicService.slugify(name)}`;

    return {
      default_entity_id: defaultEntityId,
      name: `${name}`,
      unique_id: `${deviceName} ${name}`,
      state_topic: TopicService.getStateTopic(deviceName),
      device_class: deviceClass,
      value_template: `{{ value_json.${valueName} }}`,
      availability: {
        topic: `${config.mqtt.topic}/availability`,
      },
      payload_available: "Online",
      payload_not_available: "Offline",
      device: this.createDevice(deviceName, image, tag),
      icon: icon,
    };
  }

  public static createButtonPayload(
    button: ButtonDefinition,
    image: string,
    tag: string,
    deviceName: string,
    containerId: string
  ): object {
    return {
      name: button.name,
      unique_id: `${deviceName}_${button.key.replace(/^docker_/, "")}`,
      command_topic: `${config.mqtt.topic}/${button.command}`,
      command_template: JSON.stringify({containerId}),
      availability: {
        topic: `${config.mqtt.topic}/availability`,
      },
      payload_on: button.payloadOn,
      device: this.createDevice(deviceName, image, tag),
      icon: button.icon,
    };
  }

  public static createUpdatePayload(
    name: string,
    image: string,
    tag: string,
    valueName: string,
    deviceName: string,
    containerId: any
  ): object {
    const defaultEntityId = `update.${TopicService.slugify(deviceName)}_${TopicService.slugify(name)}`;

    return {
      default_entity_id: defaultEntityId,
      name: `${name}`,
      unique_id: `${deviceName} ${name}`,
      state_topic: TopicService.getUpdateTopic(deviceName),
      device_class: "firmware",
      availability: [
        {
          topic: `${config.mqtt.topic}/availability`,
        },
      ],
      payload_available: "Online",
      payload_not_available: "Offline",
      device: this.createDevice(deviceName, image, tag),
      icon: "mdi:arrow-up-bold-circle",
      entity_picture: "https://github.com/MichelFR/MqDockerUp/raw/main/assets/logo_200x200.png",
      payload_install: JSON.stringify({containerId: containerId, image: image}),
      command_topic: `${config.mqtt.topic}/update`,
    };
  }

  /** The Home Assistant device block shared by every entity of a container. */
  private static createDevice(deviceName: string, image: string, tag: string): object {
    return {
      manufacturer: "MqDockerUp",
      model: `${image}:${tag}`,
      name: deviceName,
      sw_version: packageJson.version,
      sa: suggestedArea,
      identifiers: [`${deviceName}`],
    };
  }

  /** Splits a container's image reference into repository and tag. */
  private static splitImage(container: ContainerInspectInfo): { image: string; tag: string } {
    const [image, tag] = container.Config.Image.split(":");
    return { image, tag: tag || "latest" };
  }

  /**
   * Publish update messages to MQTT
   * @param container
   * @param client
   * @param update_percentage
   * @param in_progress
   */
  public static async publishUpdateProgressMessage(container: any, client: any, update_percentage: number | null = null, in_progress: boolean = false) {
    if (typeof container === "string") {
      try {
        container = await DockerService.docker
          .getContainer(container)
          .inspect();
      } catch (error: any) {
        logger.warn(
          `Could not inspect container ${container}: ${error.message || error}`
        );
        return;
      }
    }

    const deviceName = TopicService.getDeviceName(container);
    const updateTopic = TopicService.getUpdateTopic(deviceName);
    const updatePayload = update_percentage && in_progress
      ? { update_percentage, in_progress }
      : { update_percentage: null, in_progress: false };

    this.publishMessage(client, updateTopic, updatePayload, {retain: false});
  }

  public static async publishAbortUpdateMessage(container: any, client: any) {
    await this.publishUpdateProgressMessage(container, client, null, false);
  }

  /**
   * Checks the registry for a newer image and publishes the update entity state.
   * @param container
   * @param client
   */
  public static async publishImageUpdateMessage(container: any, client: any) {
    if (typeof container === "string") {
      try {
        container = await DockerService.docker
          .getContainer(container)
          .inspect();
      } catch (error: any) {
        logger.warn(
          `Could not inspect container ${container}: ${error.message || error}`
        );
        return;
      }
    }

    const { image, tag } = this.splitImage(container);

    let imageInfo: ImageInspectInfo | null = null;
    try {
      imageInfo = await DockerService.getImageInfo(image + ":" + tag);
    } catch (error: any) {
      // Image no longer exists locally (e.g. pruned while the container is
      // stopped) — skip this container instead of crashing the whole app.
      logger.warn(
        `Could not inspect image ${image}:${tag} for container ${container.Name?.substring(1) || container.Id}: ${error.message || error}`
      );
      return;
    }

    const newDigest = await DockerService.getImageNewDigest(image, tag);
    if (!newDigest) {
      logger.warn(`Failed to find new digest for image ${image}:${tag}`);
      return;
    }

    const repoDigests = imageInfo?.RepoDigests || [];
    let currentDigest: string;
    if (repoDigests.length === 0) {
      currentDigest = "";
      logger.info(`No existing digests found for image ${image}:${tag}`);
    } else if (repoDigests.some(d => d.endsWith(newDigest))) {
      currentDigest = newDigest;
      logger.info(`Image ${image}:${tag} is up-to-date`);
    } else {
      currentDigest = repoDigests[0].split(":")[1];
      logger.info(`New version available for image ${image}:${tag}`);
    }

    const deviceName = TopicService.getDeviceName(container);
    const updateTopic = TopicService.getUpdateTopic(deviceName);
    const sourceRepo = await DockerService.getSourceRepo(image, tag);
    const versionLabel = imageInfo?.Config?.Labels?.["org.opencontainers.image.version"];

    if (sourceRepo) {
      logger.debug(`Found source repository: ${sourceRepo}`);
    } else {
      logger.debug(`Could not find source repository for ${image}`);
    }

    const installedVersion = versionLabel || `${tag}: ${currentDigest.substring(0, 12)}`;
    let latestVersion = installedVersion;
    if (currentDigest !== newDigest) {
      const newVersion = await DockerService.getImageVersionLabel(image, tag);
      latestVersion = newVersion || `${tag}: ${newDigest.substring(0, 12)}`;
    }

    const updatePayload = {
      installed_version: installedVersion,
      latest_version: latestVersion,
      release_summary: "",
      release_url: `${sourceRepo ? sourceRepo : "https://github.com/MichelFR/MqDockerUp"}/releases`,
      entity_picture: "https://raw.githubusercontent.com/MichelFR/MqDockerUp/refs/heads/main/assets/logo_200x200.png",
      title: `${image}:${tag}`,
      in_progress: false,
      update_percentage: null,
    };

    this.publishMessage(client, updateTopic, updatePayload, {retain: true});
  }

  /**
   * Publish device messages to MQTT
   * @param container
   * @param client
   */
  public static async publishContainerMessage(container: ContainerInspectInfo, client: any) {
    const { image, tag } = this.splitImage(container);
    const containerName = container.Name.substring(1);

    const dockerPorts = Object.entries(container.HostConfig.PortBindings ?? {})
      .filter(([, bindings]) => Array.isArray(bindings) && bindings.length > 0)
      .map(([containerPort, bindings]) => `${containerPort} : ${(bindings as { HostPort: string }[])[0].HostPort}`)
      .join(", ");

    const registry = await DockerService.getImageRegistryName(image);
    const createdBy = DockerService.getCreatedBy(container);

    const deviceName = TopicService.getDeviceName(container);
    const topic = TopicService.getStateTopic(deviceName);
    const payload = {
      dockerImage: image,
      dockerTag: tag,
      dockerName: containerName,
      dockerId: container.Id.substring(0, 12),
      dockerStatus: container.State.Status,
      dockerUptime: container.State.StartedAt,
      dockerCreated: container.Created,
      dockerRestartCount: container.RestartCount,
      dockerRestartPolicy: container?.HostConfig?.RestartPolicy?.Name || "unknown",
      dockerHealth: container.State.Health?.Status || "unknown",
      dockerPorts: dockerPorts,
      dockerRegistry: registry,
      dockerCreatedBy: createdBy,
    };
    this.publishMessage(client, topic, payload, {retain: true});
  }
}
