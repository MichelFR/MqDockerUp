import DockerService from "./DockerService";
import ConfigService from "./ConfigService";
import logger from "./LoggerService"

const config = ConfigService.getConfig();
const packageJson = require("../../../package.json");

export default class HomeassistantService {
  public static async publishAvailability(client: any, online: boolean) {
    const payload = online ? "online" : "offline";
    const topic = `${config.mqtt.topic}/availability`;

    this.publishMessage(client, topic, payload, { retain: true });
  }

  /**
   * Publishes the messages to the MQTT broker
   * @param client The MQTT client
   */
  public static async publishConfigMessages(client: any) {
    const containers = await DockerService.listContainers();

    for (const container of containers) {
      const image = container.Config.Image.split(":")[0];
      const formatedImage = image.replace(/[\/.:;,+*?@^$%#!&"'`|<>{}\[\]()-\s\u0000-\u001F\u007F]/g, "_");
      const tag = container.Config.Image.split(":")[1] || "latest";
      const containerName = `${container.Name.substring(1)}`;

      let topic, payload;
      const topicName = `${formatedImage}_${tag}`;

      // Container Id
      topic = `homeassistant/sensor/${topicName}/docker_id/config`;
      payload = this.createPayload("Container ID", image, tag, "dockerId", containerName, null, "mdi:key-variant");
      this.publishMessage(client, topic, payload, { retain: true });

      // Container Name
      topic = `homeassistant/sensor/${topicName}/docker_name/config`;
      payload = this.createPayload("Container Name", image, tag, "dockerName", containerName, null, "mdi:label");
      this.publishMessage(client, topic, payload, { retain: true });

      // Container Status
      topic = `homeassistant/sensor/${topicName}/docker_status/config`;
      payload = this.createPayload("Container Status", image, tag, "dockerStatus", containerName, null, "mdi:checkbox-marked-circle");
      this.publishMessage(client, topic, payload, { retain: true });

      // Container Uptime
      topic = `homeassistant/sensor/${topicName}/docker_uptime/config`;
      payload = this.createPayload("Container Uptime", image, tag, "dockerUptime", containerName, "timestamp", "mdi:timer-sand");
      this.publishMessage(client, topic, payload, { retain: true });

      // Container Ports
      topic = `homeassistant/sensor/${topicName}/docker_ports/config`;
      payload = this.createPayload("Exposed Ports", image, tag, "dockerPorts", containerName, null, "mdi:lan-connect");
      this.publishMessage(client, topic, payload, { retain: true });

      // Docker Image
      topic = `homeassistant/sensor/${formatedImage}_${tag}/docker_image/config`;
      payload = this.createPayload("Docker Image", image, tag, "dockerImage", containerName, null, "mdi:image");
      this.publishMessage(client, topic, payload, { retain: true });

      // Docker Tag
      topic = `homeassistant/sensor/${topicName}/docker_tag/config`;
      payload = this.createPayload("Docker Tag", image, tag, "dockerTag", containerName, null, "mdi:tag");
      this.publishMessage(client, topic, payload, { retain: true });

      // Docker Registry
      topic = `homeassistant/sensor/${topicName}/docker_registry/config`;
      payload = this.createPayload("Docker Registry", image, tag, "dockerRegistry", containerName, null, "mdi:database");
      this.publishMessage(client, topic, payload, { retain: true });

      // Docker Update
      topic = `homeassistant/update/${topicName}/docker_update/config`;
      payload = this.createUpdatePayload("Update", image, tag, "dockerUpdate", containerName, container.Id);
      this.publishMessage(client, topic, payload, { retain: true });
    }
  }

  public static async publishMessages(client: any) {
    const containers = await DockerService.listContainers();

    for (const container of containers) {
      // Publish Device message (for HA)
      await this.publishDeviceMessage(container, client);

      // Publish update message (for HA)
      await this.publishUpdateMessage(container, client);
    }
  }

  public static async publishMessage(client: any, topic: string, payload: object | string, configObject: object) {
    if (typeof payload != "string") {
      payload = JSON.stringify(payload);
    }

    if (payload == "") {
      payload = JSON.stringify({})
    }

    client.publish(topic, payload, configObject);
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
    const formatedImage = image.replace(/[\/.:;,+*?@^$%#!&"'`|<>{}\[\]()-\s\u0000-\u001F\u007F]/g, "_");

    return {
      object_id: `${image} ${name}`,
      name: `${deviceName} ${name}`,
      unique_id: `${image} ${name}`,
      state_topic: `${config.mqtt.topic}/${formatedImage}`,
      device_class: deviceClass,
      value_template: `{{ value_json.${valueName} }}`,
      availability:
      {
        topic: `${config.mqtt.topic}/availability`,
      },

      payload_available: "Online",
      payload_not_available: "Offline",
      device: {
        manufacturer: "MqDockerUp",
        model: `${image}:${tag}`,
        name: deviceName,
        sw_version: packageJson.version,
        sa: "Docker",
        identifiers: [`${image}_${tag}`],
      },
      icon: icon,
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
    const formatedImage = image.replace(/[\/.:;,+*?@^$%#!&"'`|<>{}\[\]()-\s\u0000-\u001F\u007F]/g, "_");

    return {
      object_id: `${image} ${name}`,
      name: `${deviceName} ${name}`,
      unique_id: `${image} ${name}`,
      state_topic: `${config.mqtt.topic}/${formatedImage}/update`,
      device_class: "firmware",
      availability: [
        {
          topic: `${config.mqtt.topic}/availability`,
        },
      ],
      payload_available: "Online",
      payload_not_available: "Offline",
      device: {
        manufacturer: "MqDockerUp",
        model: `${image}:${tag}`,
        name: deviceName,
        sw_version: packageJson.version,
        sa: "Docker",
        identifiers: [`${image}_${tag}`],
      },
      icon: "mdi:arrow-up-bold-circle",
      payload_install: JSON.stringify({ containerId: containerId, image: image }),
      command_topic: `${config.mqtt.topic}/update`,
    };
  }

  /**
   * Publish update messages to MQTT
   * @param container
   * @param client
   */
  public static async publishUpdateProgressMessage(container: any, client: any, progress: number | null = null, remaining: number | null = null, state: string | null = null, log: boolean = true) {
    if (typeof container == "string") {
      container = DockerService.docker.getContainer(container).inspect();
    }

    const image = container.Config.Image.split(":")[0];
    const formatedImage = image.replace(/[\/.:;,+*?@^$%#!&"'`|<>{}\[\]()-\s\u0000-\u001F\u007F]/g, "_");
    const tag = container.Config.Image.split(":")[1] || "latest";
    const imageInfo = await DockerService.getImageInfo(image + ":" + tag);
    let newDigest = null;

    // Update entity payload
    const updateTopic = `${config.mqtt.topic}/${formatedImage}/update`;
    let updatePayload = {
      update: {
        state: null || "available",
        progress: null || 0,
        remaining: null || 0,
      }
    };

    if (progress !== null && remaining !== null) {
      updatePayload.update.progress = progress;
      updatePayload.update.remaining = remaining;
    }

    console.log(updatePayload);

    // TODO: Debounce this and make it somehow display in homeassistant.
    // this.publishMessage(client, updateTopic, updatePayload, {retain: false});
  }


  /**
     * Publish update messages to MQTT
     * @param container
     * @param client
     */
  public static async publishUpdateMessage(container: any, client: any, progress: number | null = null, remaining: number | null = null, state: string | null = null, log: boolean = true) {
    if (typeof container == "string") {
      container = DockerService.docker.getContainer(container).inspect();
    }

    const image = container.Config.Image.split(":")[0];
    const formatedImage = image.replace(/[\/.:;,+*?@^$%#!&"'`|<>{}\[\]()-\s\u0000-\u001F\u007F]/g, "_");
    const tag = container.Config.Image.split(":")[1] || "latest";
    const imageInfo = await DockerService.getImageInfo(image + ":" + tag);
    const currentDigest = imageInfo?.RepoDigests[0]?.split(":")[1];
    let newDigest = null;

    newDigest = await DockerService.getImageNewDigest(image, tag, currentDigest);

    if (currentDigest) {
      if (log) {
        if (currentDigest && newDigest) {
          if (currentDigest !== newDigest) {
            logger.info(`New version available for image ${image}:${tag}`);
          } else {
            logger.info(`Image ${image}:${tag} is up-to-date`);
          }
        } else {
          if (!imageInfo?.RepoDigests) {
            logger.warn(`Failed to find current digest for image ${image}:${tag}`);
          }
          if (!newDigest) {
            logger.warn(`Failed to find new digest for image ${image}:${tag}`);
          }
        }
      }

      // Update entity payload
      const updateTopic = `${config.mqtt.topic}/${formatedImage}/update`;
      let updatePayload = {
        installed_version: `${tag}: ${currentDigest?.substring(0, 12)}`,
        latest_version: newDigest ? `${tag}: ${newDigest?.substring(0, 12)}` : null,
        release_notes: null,
        release_url: null,
        entity_picture: null,
        title: `${image}:${tag}`,
        progress: 0,
        update: {
          state: currentDigest && newDigest && currentDigest !== newDigest ? "available" : "idle",
          installed_version: `${tag}: ${currentDigest?.substring(0, 12)}`,
          latest_version: newDigest ? `${tag}: ${newDigest?.substring(0, 12)}` : null,
          last_check: new Date().toISOString(),
          progress: null || 0,
          remaining: null || 0,
        }
      };

      if (progress !== null && remaining !== null) {
        updatePayload.update.progress = progress;
        updatePayload.progress = progress;
        updatePayload.update.remaining = remaining;

        if (state) {
          updatePayload.update.state = state;
        }
      }

      this.publishMessage(client, updateTopic, updatePayload, { retain: true });
    }
  }

  /**
   * Publish device messages to MQTT
   * @param container
   * @param client
   */
  public static async publishDeviceMessage(container: any, client: any) {
    const image = container.Config.Image.split(":")[0];
    const formatedImage = image.replace(/[\/.:;,+*?@^$%#!&"'`|<>{}\[\]()-\s\u0000-\u001F\u007F]/g, "_");
    const tag = container.Config.Image.split(":")[1] || "latest";
    const containerName = container.Name.substring(1);
    const dockerPorts = container.Config.ExposedPorts ? Object.keys(container.Config.ExposedPorts).join(", ") : null;

    let registry = await DockerService.getImageRegistryName(image);

    const topic = `${config.mqtt.topic}/${formatedImage}`;
    const payload = {
      dockerImage: image,
      dockerTag: tag,
      dockerName: containerName,
      dockerId: container.Id.substring(0, 12),
      dockerStatus: container.State.Status,
      dockerUptime: container.State.StartedAt,
      dockerPorts: dockerPorts,
      dockerRegistry: registry,
    };
    this.publishMessage(client, topic, payload, { retain: true });
  }
}

interface Payload {
  name: string;
  image: string;
  tag: string;
  valueName: string;
  deviceName: string;
  deviceClass?: string | null;
  icon?: string;
}
