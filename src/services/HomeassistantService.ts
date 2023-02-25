import axios from "axios";
import DockerService from "./DockerService";
import ConfigService from "./ConfigService";

const config = ConfigService.getConfig();
const packageJson = require("../../../package.json");

export default class HomeassistantService {
  public static async publishAvailability(client: any, online: boolean) {
    const payload = online ? "online" : "offline";
    const topic = `${config.mqtt.topic}/availability`;

    this.publishMessage(client, topic, payload, true);
  }

  /**
   * Publishes the messages to the MQTT broker
   * @param client The MQTT client
   */
  public static async publishConfigMessages(client: any) {
    const containers = await DockerService.listContainers();

    for (const container of containers) {
      const image = container.Config.Image.split(":")[0];
      const formatedImage = image.replace(/\//g, "_");
      const tag = container.Config.Image.split(":")[1];
      const containerName = `Container: ${container.Name.substring(1)}`;

      let topic, payload;

      // Container Id
      topic = `homeassistant/sensor/${formatedImage}_${tag}/docker_id/config`;
      payload = this.createPayload("Container ID", image, tag, "dockerId", containerName, "mdi:key-variant");
      this.publishMessage(client, topic, payload, true);

      // Container Name
      topic = `homeassistant/sensor/${formatedImage}_${tag}/docker_name/config`;
      payload = this.createPayload("Container Name", image, tag, "dockerName", containerName, "mdi:label");
      this.publishMessage(client, topic, payload, true);

      // Container Status
      topic = `homeassistant/sensor/${formatedImage}_${tag}/docker_status/config`;
      payload = this.createPayload("Container Status", image, tag, "dockerStatus", containerName, "mdi:checkbox-marked-circle");
      this.publishMessage(client, topic, payload, true);

      // Container Uptime
      topic = `homeassistant/sensor/${formatedImage}_${tag}/docker_uptime/config`;
      payload = this.createPayload("Container Uptime", image, tag, "dockerUptime", containerName, "time", "mdi:timer-sand");
      this.publishMessage(client, topic, payload, true);

      // Container Ports
      topic = `homeassistant/sensor/${formatedImage}_${tag}/docker_ports/config`;
      payload = this.createPayload("Exposed Ports", image, tag, "dockerPorts", containerName, "mdi:lan-connect");
      this.publishMessage(client, topic, payload, true);

      // Docker Image
      topic = `homeassistant/sensor/${formatedImage}_${tag}/docker_image/config`;
      payload = this.createPayload("Docker Image", image, tag, "dockerImage", containerName, "mdi:image");
      this.publishMessage(client, topic, payload, true);

      // Docker Tag
      topic = `homeassistant/sensor/${formatedImage}_${tag}/docker_tag/config`;
      payload = this.createPayload("Docker Tag", image, tag, "dockerTag", containerName, "mdi:tag");
      this.publishMessage(client, topic, payload, true);

      // Docker Registry
      topic = `homeassistant/sensor/${formatedImage}_${tag}/docker_registry/config`;
      payload = this.createPayload("Docker Registry", image, tag, "dockerRegistry", containerName, "mdi:database");
      this.publishMessage(client, topic, payload, true);

      // Docker Update
      topic = `homeassistant/update/${formatedImage}_${tag}/docker_update/config`;
      payload = this.createUpdatePayload("Update: " + formatedImage, image, tag, "dockerUpdate", containerName, container.Id);
      this.publishMessage(client, topic, payload, true);
    }
  }

  public static async publishMessages(client: any) {
    const containers = await DockerService.listContainers();

    for (const container of containers) {
      // Publish Device message (for HA)
      this.publishDeviceMessage(container, client);

      // Publish update message (for HA)
      this.publishUpdateMessage(container, client);
    }
  }

  public static async publishMessage(client: any, topic: string, payload: object | string, retain: boolean) {
    if (typeof payload != "string") {
      payload = JSON.stringify(payload);
    }

    client.publish(topic, payload, { retain: retain });
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
    const formatedImage = image.replace(/\//g, "_");

    return {
      object_id: name,
      name: name,
      unique_id: `${image + tag + name}`,
      state_topic: `${config.mqtt.topic}/${formatedImage}`,
      device_class: deviceClass,
      value_template: `{{ value_json.${valueName} }}`,
      availability: [
        {
          topic: `${config.mqtt.topic}/availability`,
        },
      ],
      device: {
        manufacturer: "MqDockerUp",
        model: `${image}:${tag}`,
        name: deviceName,
        sw_version: packageJson.version,
        sa: "docker",
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
    const formatedImage = image.replace(/\//g, "_");

    return {
      name: name,
      unique_id: `${image + tag + name}`,
      state_topic: `${config.mqtt.topic}/${formatedImage}/update`,
      device_class: "firmware",
      availability: [
        {
          topic: `${config.mqtt.topic}/availability`,
        },
      ],
      device: {
        manufacturer: "MqDockerUp",
        model: `${image}:${tag}`,
        name: deviceName,
        sw_version: packageJson.version,
        sa: "docker",
        identifiers: [`${image}_${tag}`],
      },
      icon: "mdi:arrow-up-bold-circle",
      payload_install: JSON.stringify({ containerId: containerId }),
      command_topic: `${config.mqtt.topic}/update`,
    };
  }

  /**
   * Publish update messages to MQTT
   * @param container
   * @param client
   */
  public static async publishUpdateMessage(container: any, client: any) {
    const image = container.Config.Image.split(":")[0];
    const formatedImage = image.replace(/\//g, "_");
    const tag = container.Config.Image.split(":")[1];
    const imageInfo = await DockerService.getImageInfo(image + ":" + tag);
    const currentDigest = imageInfo?.RepoDigests[0]?.split(":")[1];
    let newDigest = null;
    let response = null;
    let images = null;

    let registryInformation = await DockerService.getImageRegistry(image, tag);
    response = registryInformation.response;
    if (currentDigest) {
      images = response.data.results[0]?.images;
      if (images && images.length > 0) {
        newDigest = response.data.results[0]?.digest?.split(":")[1];
      }
    }

    if (currentDigest && newDigest) {
      if (currentDigest !== newDigest) {
        console.debug(`🚨 New version available for image ${image}:${tag}`);
      } else {
        console.debug(`🟢 Image ${image}:${tag} is up-to-date`);
      }
    } else {
      if (!imageInfo?.RepoDigests) {
        console.debug(`❌ Failed to find current digest for image ${image}:${tag}`);
      }
      if (!newDigest) {
        console.debug(`❌ Failed to find new digest for image ${image}:${tag}`);
      }
    }

    // Update entity payload
    const updateTopic = `${config.mqtt.topic}/${formatedImage}/update`;
    const updatePayload = JSON.stringify({
      installed_version: `${tag}: ${currentDigest?.substring(0, 12)}`,
      latest_version: newDigest ? `${tag}: ${newDigest?.substring(0, 12)}` : null,
      release_notes: null,
      release_url: null,
      entity_picture: null,
      title: formatedImage,
    });

    this.publishMessage(client, updateTopic, updatePayload, true);
  }

  /**
   * Publish device messages to MQTT
   * @param container
   * @param client
   */
  public static async publishDeviceMessage(container: any, client: any) {
    const image = container.Config.Image.split(":")[0];
    const formatedImage = image.replace(/\//g, "_");
    const tag = container.Config.Image.split(":")[1];
    const containerName = container.Name.substring(1);
    const dockerPorts = container.Config.ExposedPorts ? Object.keys(container.Config.ExposedPorts).join(", ") : null;

    let registry = null;

    let registryInformation = await DockerService.getImageRegistry(image, tag);
    registry = registryInformation.registry;

    const topic = `${config.mqtt.topic}/${formatedImage}`;
    const payload = JSON.stringify({
      dockerImage: image,
      dockerTag: tag,
      dockerName: containerName,
      dockerId: container.Id.substring(0, 12),
      dockerStatus: container.State.Status,
      dockerUptime: container.State.StartedAt,
      dockerPorts: dockerPorts,
      dockerRegistry: registry,
    });
    this.publishMessage(client, topic, payload, true);
  }
}
