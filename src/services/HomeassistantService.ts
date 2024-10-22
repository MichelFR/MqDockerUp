import DockerService from "../services/DockerService";
import ConfigService from "../services/ConfigService";
import DatabaseService from "../services/DatabaseService";
import logger from "../services/LoggerService"
import {ContainerInspectInfo} from "dockerode";

const config = ConfigService.getConfig();
const packageJson = require("../../package");

export default class HomeassistantService {

  /**
   * Published availability message to the MQTT broker to indicate if the service is online or offline
   * @param client The MQTT client
   * @param online Indicates if the service is online or offline
   */
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
      const prefix = ConfigService.getConfig()?.main.prefix || "";
      const image = container.Config.Image.split(":")[0];
      const formatedImage = image.replace(/[\/.:;,+*?@^$%#!&"'`|<>{}\[\]()-\s\u0000-\u001F\u007F]/g, "_");
      const tag = container.Config.Image.split(":")[1] || "latest";
      const formatedTag = tag.replace(/[\/.:;,+*?@^$%#!&"'`|<>{}\[\]()-\s\u0000-\u001F\u007F]/g, "-");
      const containerName = `${container.Name.substring(1)}`;
      let containerIsInDb = false;

      await DatabaseService.containerExists(container.Id).then((exists) => {
        containerIsInDb = exists;
      })

      if (!containerIsInDb) {
        // Save container info to database
        logger.info(`Adding container ${containerName} to database`);
        await DatabaseService.addContainer(container.Id, containerName, image, tag);
      }

      let topic, payload;

      let topicName: string = '';
      let deviceName = containerName;

      if (!prefix) {
        topicName = `${formatedImage}_${formatedTag}`;
      } else {
        topicName = `${prefix}_${formatedImage}_${formatedTag}`;
      }

      if (!prefix) {
        deviceName = containerName;
      } else {
        deviceName = `${prefix}_${containerName}`;
      }



      // Container Id
      topic = `homeassistant/sensor/${topicName}/docker_id/config`;
      payload = this.createPayload("Container ID", image, tag, "dockerId", deviceName, null, "mdi:key-variant");
      this.publishMessage(client, topic, payload, { retain: true });
      if (!containerIsInDb) await DatabaseService.addTopic(topic, container.Id);

      // Container Name
      topic = `homeassistant/sensor/${topicName}/docker_name/config`;
      payload = this.createPayload("Container Name", image, tag, "dockerName", deviceName, null, "mdi:label");
      this.publishMessage(client, topic, payload, { retain: true });
      if (!containerIsInDb) await DatabaseService.addTopic(topic, container.Id);

      // Container Status
      topic = `homeassistant/sensor/${topicName}/docker_status/config`;
      payload = this.createPayload("Container Status", image, tag, "dockerStatus", deviceName, null, "mdi:checkbox-marked-circle");
      this.publishMessage(client, topic, payload, { retain: true });
      if (!containerIsInDb) await DatabaseService.addTopic(topic, container.Id);

      // Container Uptime
      topic = `homeassistant/sensor/${topicName}/docker_uptime/config`;
      payload = this.createPayload("Container Uptime", image, tag, "dockerUptime", deviceName, "timestamp", "mdi:timer-sand");
      this.publishMessage(client, topic, payload, { retain: true });
      if (!containerIsInDb) await DatabaseService.addTopic(topic, container.Id);

      // Container Created
      topic = `homeassistant/sensor/${topicName}/docker_created/config`;
      payload = this.createPayload("Container Created", image, tag, "dockerCreated", deviceName, "timestamp", "mdi:calendar-clock");
      this.publishMessage(client, topic, payload, { retain: true });
      if (!containerIsInDb) await DatabaseService.addTopic(topic, container.Id);

      // Container Restart Count
      topic = `homeassistant/sensor/${topicName}/docker_restart_count/config`;
      payload = this.createPayload("Container Restart Count", image, tag, "dockerRestartCount", deviceName, null, "mdi:restart");
      this.publishMessage(client, topic, payload, { retain: true });
      if (!containerIsInDb) await DatabaseService.addTopic(topic, container.Id);

      // Container Restart Policy
      topic = `homeassistant/sensor/${topicName}/docker_restart_policy/config`;
      payload = this.createPayload("Container Restart Policy", image, tag, "dockerRestartPolicy", deviceName, null, "mdi:restart");
      this.publishMessage(client, topic, payload, { retain: true });
      if (!containerIsInDb) await DatabaseService.addTopic(topic, container.Id);

      // Container Ports
      topic = `homeassistant/sensor/${topicName}/docker_ports/config`;
      payload = this.createPayload("Exposed Ports", image, tag, "dockerPorts", deviceName, null, "mdi:lan-connect");
      this.publishMessage(client, topic, payload, { retain: true });
      if (!containerIsInDb) await DatabaseService.addTopic(topic, container.Id);

      // Container manual update
      topic = `homeassistant/button/${topicName}/docker_manual_update/config`;
      payload = {
        name: "Manual Update",
        unique_id: `${image}_${tag}_manual_update`,
        command_topic: `${config.mqtt.topic}/manualUpdate`,
        command_template: JSON.stringify({ containerId: container.Id }),
        availability: {
          topic: `${config.mqtt.topic}/availability`,
        },
        payload_on: "update",
        device: {
          manufacturer: "MqDockerUp",
          model: `${image}:${tag}`,
          name: deviceName,
          sw_version: packageJson.version,
          sa: "Docker",
          identifiers: [`${image}_${tag}`],
        },
        icon: "mdi:arrow-up-bold-circle",
      };
      this.publishMessage(client, topic, payload, { retain: true });
      if (!containerIsInDb) await DatabaseService.addTopic(topic, container.Id);

      // Container manual restart
      topic = `homeassistant/button/${topicName}/docker_manual_restart/config`;
      payload = {
        name: "Manual Restart",
        unique_id: `${image}_${tag}_manual_restart`,
        command_topic: `${config.mqtt.topic}/restart`,
        command_template: JSON.stringify({ containerId: container.Id }),
        availability: {
          topic: `${config.mqtt.topic}/availability`,
        },
        payload_on: "restart",
        device: {
          manufacturer: "MqDockerUp",
          model: `${image}:${tag}`,
          name: deviceName,
          sw_version: packageJson.version,
          sa: "Docker",
          identifiers: [`${image}_${tag}`],
        },
        icon: "mdi:restart",
      };
      this.publishMessage(client, topic, payload, { retain: true });
      if (!containerIsInDb) await DatabaseService.addTopic(topic, container.Id);

      // Docker Image
      topic = `homeassistant/sensor/${topicName}/docker_image/config`;
      payload = this.createPayload("Docker Image", image, tag, "dockerImage", deviceName, null, "mdi:image");
      this.publishMessage(client, topic, payload, { retain: true });
      if (!containerIsInDb) await DatabaseService.addTopic(topic, container.Id);

      // Docker Tag
      topic = `homeassistant/sensor/${topicName}/docker_tag/config`;
      payload = this.createPayload("Docker Tag", image, tag, "dockerTag", deviceName, null, "mdi:tag");
      this.publishMessage(client, topic, payload, { retain: true });
      if (!containerIsInDb) await DatabaseService.addTopic(topic, container.Id);

      // Docker Registry
      topic = `homeassistant/sensor/${topicName}/docker_registry/config`;
      payload = this.createPayload("Docker Registry", image, tag, "dockerRegistry", deviceName, null, "mdi:database");
      this.publishMessage(client, topic, payload, { retain: true });
      if (!containerIsInDb) await DatabaseService.addTopic(topic, container.Id);

      // Docker Update
      topic = `homeassistant/update/${topicName}/docker_update/config`;
      payload = this.createUpdatePayload("Update", image, tag, "dockerUpdate", deviceName, container.Id);
      this.publishMessage(client, topic, payload, { retain: true });
      if (!containerIsInDb) await DatabaseService.addTopic(topic, container.Id);
    }
  }

  /**
   * Publishes the device message to the MQTT broker
   * @param client The MQTT client
   */
  public static async publishMessages(client: any) {
    const containers: ContainerInspectInfo[] = await DockerService.listContainers();

    for (const container of containers) {
      // Publish Device message (for HA)
      await this.publishDeviceMessage(container, client);

      // Publish update message (for HA)
      await this.publishUpdateMessage(container, client);
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
    icon: string = "mdi:docker",
    prefix: string = ""
  ): object {
    const formatedImage = image.replace(/[\/.:;,+*?@^$%#!&"'`|<>{}\[\]()-\s\u0000-\u001F\u007F]/g, "_");

    return {
      object_id: prefix ? `${prefix}/${image} ${name}` : `${image} ${name}`,
      name: `${name}`,
      unique_id: prefix ? `${prefix}/${image} ${name}` : `${image} ${name}`,
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
    containerId: any,
    prefix: string = ""
  ): object {
    const formatedImage = image.replace(/[\/.:;,+*?@^$%#!&"'`|<>{}\[\]()-\s\u0000-\u001F\u007F]/g, "_");

    return {
      object_id: prefix ? `${prefix}/${image} ${name}` : `${image} ${name}`,
      name: `${name}`,
      unique_id: prefix ? `${prefix}/${image} ${name}` : `${image} ${name}`,
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
      entity_picture: "https://github.com/MichelFR/MqDockerUp/raw/main/assets/logo_200x200.png",
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
        state: "available",
        progress: 0,
        remaining: 0,
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
          progress: 0,
          remaining: 0,
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
  public static async publishDeviceMessage(container: ContainerInspectInfo, client: any) {
    const image = container.Config.Image.split(":")[0];
    const formatedImage = image.replace(/[\/.:;,+*?@^$%#!&"'`|<>{}\[\]()-\s\u0000-\u001F\u007F]/g, "_");
    const tag = container.Config.Image.split(":")[1] || "latest";
    const containerName = container.Name.substring(1);

    let dockerPorts = "";
    if (container.HostConfig.PortBindings) {
      for (const [key, value] of Object.entries(container.HostConfig.PortBindings)) {
        if (value) {
          dockerPorts += `${key} : ${value[0].HostPort}, `;
        }
      }
      dockerPorts = dockerPorts.slice(0, -2); // Remove last comma
    }

    let registry = await DockerService.getImageRegistryName(image);

    const topic = `${config.mqtt.topic}/${formatedImage}`;
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
      dockerPorts: dockerPorts,
      dockerRegistry: registry,
    };
    this.publishMessage(client, topic, payload, { retain: true });
  }
}