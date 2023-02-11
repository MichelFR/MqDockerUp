import mqtt from "mqtt";
import DockerService from "./DockerService";
import ConfigService from "./ConfigService";

const config = ConfigService.getConfig();

export default class HomeassistantService {
  static createEntities(client: mqtt.MqttClient): void {
    DockerService.listContainers().then((containers) => {
      for (const container of containers) {
        const image = container.Config.Image;
        const imageInfo = DockerService.getImageInfo(image);
        const currentTags = imageInfo.RepoTags.map((tag) => tag.split(":")[1]);

        for (const currentTag of currentTags) {
          const entity = {
            name: `${container.Names[0].substring(1)}-${currentTag}`,
            unique_id: `${container.Id}-${currentTag}`,
            state_topic: `${config.mqtt.topic}/${container.Id}/${currentTag}/state`,
            command_topic: `${config.mqtt.topic}/${container.Id}/${currentTag}/update`,
            availability_topic: `${config.mqtt.topic}/availability`,
            payload_available: "online",
            payload_not_available: "offline",
            icon: "mdi:docker",
          };

          client.publish(
            `homeassistant/sensor/${container.Id}/${currentTag}/config`,
            JSON.stringify(entity),
            { retain: true }
          );
        }
      }
    });
  }

  static createUpdate(
    container: Docker.ContainerInspectInfo,
    currentTag: string,
    previousDigest: string,
    newDigest: string,
    client: mqtt.MqttClient
  ): void {
    const update = {
      state: "available",
      attributes: {
        friendly_name: `${container.Names[0].substring(1)}-${currentTag}`,
        current_version: previousDigest,
        new_version: newDigest,
        update_available: true,
        update_requested: false,
      },
    };

    client.publish(
      `${config.mqtt.topic}/${container.Id}/${currentTag}/state`,
      JSON.stringify(update),
      { retain: true }
    );
  }

  static handleUpdate(
    container: Docker.ContainerInspectInfo,
    currentTag: string,
    newDigest: string,
    client: mqtt.MqttClient
  ): void {
    const update = {
      state: "updating",
      attributes: {
        friendly_name: `${container.Names[0].substring(1)}-${currentTag}`,
        current_version: container.RepoDigests.find((d) => d.endsWith(`:${currentTag}`)),
        new_version: newDigest,
        update_available: false,
        update_requested: true,
      },
    };

    client.publish(
      `${config.mqtt.topic}/${container.Id}/${currentTag}/state`,
      JSON.stringify(update),
      { retain: true }
    );

    DockerService.updateContainer(container, currentTag, newDigest).then(() => {
      const updated = {
        state: "updated",
        attributes: {
          friendly_name: `${container.Names[0].substring(1)}-${currentTag}`,
          current_version: newDigest,
          new_version: newDigest,
          update_available: false,
          update_requested: false,
        },
      };

      client.publish(
        `${config.mqtt.topic}/${container.Id}/${currentTag}/state`,
        JSON.stringify(updated),
        { retain: true }
      );
    });
  }
}
