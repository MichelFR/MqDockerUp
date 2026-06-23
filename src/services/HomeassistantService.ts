import DockerService from "./DockerService";
import ConfigService from "./ConfigService";
import DatabaseService from "./DatabaseService";
import logger from "./LoggerService"
import {ContainerInspectInfo} from "dockerode";
import IgnoreService from "./IgnoreService";
import MqttCommandService, {ContainerCommand} from "./MqttCommandService";

const config = ConfigService.getConfig();
const packageJson = require("../../package");

const haLegacy = ConfigService.autoParseEnvVariable(config.mqtt?.haLegacy)
const suggestedArea = config.mqtt?.suggestedArea ?? "Docker";

type DiscoveryDevice = {
  manufacturer: string;
  model: string;
  name: string;
  sw_version: string;
  sa: string;
  identifiers: string[];
};

type ContainerIdentity = {
  image: string;
  tag: string;
  imageReference: string;
  digest?: string;
  containerName: string;
  topicName: string;
};

type SensorDiscovery = {
  key: string;
  name: string;
  valueName: string;
  deviceClass?: string | null;
  icon: string;
};

type ButtonDiscovery = {
  key: string;
  name: string;
  command: ContainerCommand;
  icon: string;
  payloadPress?: string;
};

const sensorDiscoveries: SensorDiscovery[] = [
  {key: "docker_id", name: "Container ID", valueName: "dockerId", deviceClass: null, icon: "mdi:key-variant"},
  {key: "docker_name", name: "Container Name", valueName: "dockerName", deviceClass: null, icon: "mdi:label"},
  {key: "docker_status", name: "Container Status", valueName: "dockerStatus", deviceClass: null, icon: "mdi:checkbox-marked-circle"},
  {key: "docker_uptime", name: "Container Uptime", valueName: "dockerUptime", deviceClass: "timestamp", icon: "mdi:timer-sand"},
  {key: "docker_created", name: "Container Created", valueName: "dockerCreated", deviceClass: "timestamp", icon: "mdi:calendar-clock"},
  {key: "docker_restart_count", name: "Container Restart Count", valueName: "dockerRestartCount", deviceClass: null, icon: "mdi:restart"},
  {key: "docker_restart_policy", name: "Container Restart Policy", valueName: "dockerRestartPolicy", deviceClass: null, icon: "mdi:restart"},
  {key: "docker_health", name: "Container Health", valueName: "dockerHealth", deviceClass: null, icon: "mdi:heart-pulse"},
  {key: "docker_ports", name: "Exposed Ports", valueName: "dockerPorts", deviceClass: null, icon: "mdi:lan-connect"},
  {key: "docker_image", name: "Docker Image", valueName: "dockerImage", deviceClass: null, icon: "mdi:image"},
  {key: "docker_tag", name: "Docker Tag", valueName: "dockerTag", deviceClass: null, icon: "mdi:tag"},
  {key: "docker_registry", name: "Docker Registry", valueName: "dockerRegistry", deviceClass: null, icon: "mdi:database"},
  {key: "docker_created_by", name: "Created By", valueName: "dockerCreatedBy", deviceClass: null, icon: "mdi:information"},
];

const buttonDiscoveries: ButtonDiscovery[] = [
  {key: "manual_restart", name: "Manual Restart", command: "restart", icon: "mdi:restart"},
  {key: "manual_start", name: "Start", command: "start", icon: "mdi:play"},
  {key: "manual_stop", name: "Stop", command: "stop", icon: "mdi:stop"},
  {key: "manual_pause", name: "Pause", command: "pause", icon: "mdi:pause"},
  {key: "manual_unpause", name: "Unpause", command: "unpause", icon: "mdi:play-pause"},
];

export default class HomeassistantService {
  private static readonly safeNameRegex = /[\/.:;,+*?@^$%#!&"'`|<>{}\[\]()-\s\u0000-\u001F\u007F]/g;

  private static formatSafeName(value: string, replacement: string = "_"): string {
    return value.replace(this.safeNameRegex, replacement);
  }

  private static getContainerName(container: ContainerInspectInfo): string {
    return container.Name.startsWith("/") ? container.Name.substring(1) : container.Name;
  }

  private static getContainerIdentity(container: ContainerInspectInfo): ContainerIdentity {
    const prefix = config?.main.prefix || "";
    const imageReference = container.Config?.Image || "unknown";
    const {image, tag, digest} = DockerService.splitImageReference(imageReference);
    const containerName = this.getContainerName(container);
    const formattedContainerName = this.formatSafeName(containerName);
    const topicName = prefix ? `${prefix}_${formattedContainerName}` : formattedContainerName;

    return {
      image,
      tag,
      imageReference,
      ...(digest ? { digest } : {}),
      containerName,
      topicName,
    };
  }

  private static createDevice(imageReference: string, topicName: string): DiscoveryDevice {
    return {
      manufacturer: "MqDockerUp",
      model: imageReference,
      name: topicName,
      sw_version: packageJson.version,
      sa: suggestedArea,
      identifiers: [topicName],
    };
  }

  private static getDiscoveryTopic(component: string, topicName: string, key: string): string {
    return `${config?.mqtt?.discoveryPrefix}/${component}/${topicName}/${key}/config`;
  }

  private static publishDiscoveryMessage(client: any, topic: string, payload: object, containerId: string): string {
    this.publishMessage(client, topic, payload, {retain: true});
    DatabaseService.addTopic(topic, containerId);
    return topic;
  }

  private static removeStaleDiscoveryTopics(client: any, containerId: string, currentTopics: string[]) {
    const currentTopicSet = new Set(currentTopics);
    const storedTopics = DatabaseService.getTopicsForContainer(containerId);

    for (const {topic} of storedTopics) {
      if (currentTopicSet.has(topic)) {
        continue;
      }

      this.publishMessage(client, topic, "", {retain: true});
      DatabaseService.deleteTopic(topic, containerId);
    }
  }

  private static createButtonPayload(
    name: string,
    imageReference: string,
    topicName: string,
    command: ContainerCommand,
    containerId: string,
    icon: string,
    payloadPress: string = command,
    uniqueSuffix: string = command
  ): object {
    return {
      name,
      unique_id: `${topicName}_${uniqueSuffix}`,
      command_topic: MqttCommandService.getCommandTopic(config.mqtt.topic, topicName, command),
      command_template: JSON.stringify({containerId, topicName}),
      availability: {
        topic: `${config.mqtt.topic}/availability`,
      },
      payload_press: payloadPress,
      device: this.createDevice(imageReference, topicName),
      icon,
    };
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
   * Publishes the messages to the MQTT broker
   * @param client The MQTT client
   */
  public static async publishConfigMessages(client: any) {
    const containers = await DockerService.listContainers();

    for (const container of containers) {
      const identity = this.getContainerIdentity(container);

      if (!await DatabaseService.containerExists(container.Id)) {
        logger.info(`Adding container ${identity.containerName} to database`);
        await DatabaseService.addContainer(container.Id, identity.containerName, identity.image, identity.tag);
      }

      const currentTopics: string[] = [];

      for (const discovery of sensorDiscoveries) {
        const topic = this.getDiscoveryTopic("sensor", identity.topicName, discovery.key);
        const payload = this.createPayload(
          discovery.name,
          identity.imageReference,
          discovery.valueName,
          identity.topicName,
          discovery.deviceClass,
          discovery.icon
        );
        currentTopics.push(this.publishDiscoveryMessage(client, topic, payload, container.Id));
      }

      for (const button of buttonDiscoveries) {
        const topic = this.getDiscoveryTopic("button", identity.topicName, `docker_${button.key}`);
        const payload = this.createButtonPayload(
          button.name,
          identity.imageReference,
          identity.topicName,
          button.command,
          container.Id,
          button.icon,
          button.payloadPress ?? button.command,
          button.key
        );
        currentTopics.push(this.publishDiscoveryMessage(client, topic, payload, container.Id));
      }

      if (!IgnoreService.ignoreUpdates(container)) {
        const manualUpdateTopic = this.getDiscoveryTopic("button", identity.topicName, "docker_manual_update");
        const manualUpdatePayload = this.createButtonPayload(
          "Manual Update",
          identity.imageReference,
          identity.topicName,
          "manualUpdate",
          container.Id,
          "mdi:arrow-up-bold-circle",
          "update",
          "manual_update"
        );
        currentTopics.push(this.publishDiscoveryMessage(client, manualUpdateTopic, manualUpdatePayload, container.Id));

        const updateTopic = this.getDiscoveryTopic("update", identity.topicName, "docker_update");
        const updatePayload = this.createUpdatePayload("Update", identity.image, identity.imageReference, "dockerUpdate", identity.topicName, container.Id);
        currentTopics.push(this.publishDiscoveryMessage(client, updateTopic, updatePayload, container.Id));
      }

      this.removeStaleDiscoveryTopics(client, container.Id, currentTopics);
    }
  }


  /**
   * Publishes the device message to the MQTT broker
   * @param client The MQTT client
   */
  public static async publishContainerMessages(client: any) {
    const containers: ContainerInspectInfo[] = await DockerService.listContainers();

    for (const container of containers) {
      // Publish Device message (for HA)
      await this.publishContainerMessage(container, client);
    }
  }

  /**
   * Publishes update messages to the MQTT broker
   * @param client The MQTT client
   */
  public static async publishImageUpdateMessages(client: any) {
    const containers: ContainerInspectInfo[] = await DockerService.listContainers();

    for (const container of containers) {
      // Publish update message (for HA)
      // await this.publishImageUpdateMessage(container, client);

      if (!IgnoreService.ignoreUpdates(container)) {
        await this.publishImageUpdateMessage(container, client);
      }
    }
  }

  /**
   * Publishes the device message to the MQTT broker
   * @param client The MQTT client
   * @param topic The topic to publish the message to
   * @param payload The payload to publish
   * @param configObject The config object
   */
  public static async publishMessage(client: any, topic: string, payload: object | string, configObject: object) {
    if (typeof payload != "string") {
      payload = JSON.stringify(payload);
    }

    client.publish(topic, payload, configObject);
  }

  public static createPayload(
    name: string,
    imageReference: string,
    valueName: string,
    topicName: string,
    deviceClass?: string | null,
    icon: string = "mdi:docker"
  ): object {
    const formatedName = name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const defaultEntityId = `sensor.${topicName}_${formatedName}`;

    return {
      default_entity_id: defaultEntityId,
      name: `${name}`,
      unique_id: `${topicName} ${name}`,
      state_topic: `${config.mqtt.topic}/${topicName}`,
      device_class: deviceClass,
      value_template: `{{ value_json.${valueName} }}`,
      availability:
        {
          topic: `${config.mqtt.topic}/availability`,
        },

      payload_available: "online",
      payload_not_available: "offline",
      device: {
        ...this.createDevice(imageReference, topicName),
      },
      icon: icon,
    };
  }

  public static createUpdatePayload(
    name: string,
    image: string,
    imageReference: string,
    valueName: string,
    topicName: string,
    containerId: any
  ): object {
    const formatedName = name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const defaultEntityId = `update.${topicName}_${formatedName}`;

    return {
      default_entity_id: defaultEntityId,
      name: `${name}`,
      unique_id: `${topicName} ${name}`,
      state_topic: `${config.mqtt.topic}/${topicName}/update`,
      device_class: "firmware",
      availability: [
        {
          topic: `${config.mqtt.topic}/availability`,
        },
      ],
      payload_available: "online",
      payload_not_available: "offline",
      device: {
        ...this.createDevice(imageReference, topicName),
      },
      icon: "mdi:arrow-up-bold-circle",
      entity_picture: "https://github.com/MichelFR/MqDockerUp/raw/main/assets/logo_200x200.png",
      payload_install: JSON.stringify({containerId: containerId, image: image, topicName}),
      command_topic: MqttCommandService.getCommandTopic(config.mqtt.topic, topicName, "update"),
    };
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

    const identity = this.getContainerIdentity(container);

    // Update entity payload
    const updateTopic = `${config.mqtt.topic}/${identity.topicName}/update`;
    let updatePayload: any;

    updatePayload = {
      update_percentage: null,
      in_progress: false,
    }

    if (update_percentage && in_progress) {
      updatePayload.update_percentage = update_percentage;
      updatePayload.in_progress = in_progress;
    }

    this.publishMessage(client, updateTopic, updatePayload, {retain: false});
  }

  public static async publishAbortUpdateMessage(container: any, client: any) {
    try {
      if (typeof container === "string") {
        container = await DockerService.docker
          .getContainer(container)
          .inspect();
      }
    } catch (error: any) {
      logger.warn(
        `Could not inspect container ${container}: ${error.message || error}`
      );
      return;
    }

    if (!container) {
      logger.error(`ABORT: Failed to find container ${container}`);
      return;
    }

    const identity = this.getContainerIdentity(container);

    // Update entity payload
    const updateTopic = `${config.mqtt.topic}/${identity.topicName}/update`;
    let updatePayload: any;

    updatePayload = {
      update_percentage: null,
      in_progress: false,
    }

    await this.publishMessage(client, updateTopic, updatePayload, {retain: false});
  }

  /**
   * Publish update messages to MQTT
   * @param container
   * @param client
   */
  public static async publishImageUpdateMessage(container: any, client: any, update_percentage: number | null = null, remaining: number | null = null, state: string | null = null, log: boolean = true) {
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

    const identity = this.getContainerIdentity(container);
    const imageInfo = await DockerService.getImageInfo(identity.imageReference);
    const repoDigests = imageInfo?.RepoDigests || [];
    let currentDigest: string | null = null, newDigest: string | null = null;

    if (identity.digest) {
      currentDigest = identity.digest.split(":").pop() || identity.digest;
      newDigest = currentDigest;
    } else {
      newDigest = await DockerService.getImageNewDigest(identity.image, identity.tag);
    }

    if (!newDigest) {
      logger.warn(`Failed to find new digest for image ${identity.image}:${identity.tag}`);
    } else {
      if (identity.digest) {
        logger.info(`Image ${identity.imageReference} is pinned by digest`);
      } else if (repoDigests.length > 0) {
        if (repoDigests.some(d => d.endsWith(newDigest))) {
          currentDigest = newDigest;
          logger.info(`Image ${identity.image}:${identity.tag} is up-to-date`);
        } else {
          currentDigest = repoDigests[0].split(":")[1];
          logger.info(`New version available for image ${identity.image}:${identity.tag}`);
        }
      } else {
        currentDigest = "";
        logger.info(`No existing digests found for image ${identity.image}:${identity.tag}`);
      }

      // Update entity payload
      const updateTopic = `${config.mqtt.topic}/${identity.topicName}/update`;
      const sourceRepo = await DockerService.getSourceRepo(identity.image, identity.tag);

      if (sourceRepo) {
        logger.info(`Found source repository: ${sourceRepo}`);
      } else {
        logger.warn(`Could not find source repository for ${identity.image}`);
      }

      let updatePayload: any;
      if (haLegacy) {
        updatePayload = {
          installed_version: `${identity.tag}: ${currentDigest?.substring(0, 12)}`,
          latest_version: newDigest ? `${identity.tag}: ${newDigest?.substring(0, 12)}` : null,
          release_notes: null,
          release_url: null,
          entity_picture: null,
          title: identity.imageReference,
          progress: 0,
          update: {
            state: currentDigest && newDigest && currentDigest !== newDigest ? "available" : "idle",
            installed_version: `${identity.tag}: ${currentDigest?.substring(0, 12)}`,
            latest_version: newDigest ? `${identity.tag}: ${newDigest?.substring(0, 12)}` : null,
            last_check: new Date().toISOString(),
            progress: 0,
            remaining: 0,
          },
        };

        if (update_percentage !== null && remaining !== null) {
          updatePayload.update.progress = update_percentage;
          updatePayload.progress = update_percentage;
          updatePayload.update.remaining = remaining;

          if (state) {
            updatePayload.update.state = state;
          }
        }
      } else {
        updatePayload = {
          installed_version: `${identity.tag}: ${currentDigest?.substring(0, 12)}`,
          latest_version: newDigest ? `${identity.tag}: ${newDigest?.substring(0, 12)}` : null,
          release_summary: "",
          release_url: `${sourceRepo ? sourceRepo : "https://github.com/MichelFR/MqDockerUp"}/releases`,
          entity_picture: "https://raw.githubusercontent.com/MichelFR/MqDockerUp/refs/heads/main/assets/logo_200x200.png",
          title: identity.imageReference,
          update_percentage: update_percentage,
          in_progress: update_percentage !== null && remaining !== null,
        };
      }

      this.publishMessage(client, updateTopic, updatePayload, {retain: true});
      if (log) logger.info(`Published update message for ${identity.imageReference}`);
    }
  }

  /**
   * Publish container info to MQTT
   * @param container
   * @param client
   */
  public static async publishContainerMessage(container: ContainerInspectInfo, client: any) {
    const identity = this.getContainerIdentity(container);

    let dockerPorts = "";
    if (container.HostConfig?.PortBindings) {
      for (const [containerPort, hostPorts] of Object.entries(container.HostConfig.PortBindings)) {
        if (hostPorts && Array.isArray(hostPorts) && hostPorts.length > 0) {
          const hostPort = (hostPorts[0] as { HostPort: string }).HostPort;
          dockerPorts += `${containerPort} : ${hostPort}, `;
        }
      }
      if (dockerPorts.endsWith(", ")) {
        dockerPorts = dockerPorts.slice(0, -2);
      }
    }

    const dockerUptime = container.State.StartedAt == "0001-01-01T00:00:00Z" ? "" : container.State.StartedAt
    const createdBy = DockerService.getCreatedBy(container);

    const topic = `${config.mqtt.topic}/${identity.topicName}`;
    const payload = {
      dockerImage: identity.image,
      dockerTag: identity.tag,
      dockerId: container.Id.substring(0, 12),
      dockerName: identity.containerName,
      dockerStatus: container.State.Status,
      dockerHealth: container.State.Health?.Status || "unknown",
      dockerRestartCount: container.RestartCount,
      dockerRestartPolicy: container.HostConfig?.RestartPolicy?.Name || "unknown",
      dockerPorts: dockerPorts,
      dockerUptime: dockerUptime,
      dockerCreated: container.Created,
      dockerRegistry: await DockerService.getImageRegistryName(identity.image),
      dockerCreatedBy: createdBy,
    };

    this.publishMessage(client, topic, payload, {retain: true});
    logger.info(`Published container message for ${identity.containerName}`);
  }

}
