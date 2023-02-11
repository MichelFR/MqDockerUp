import { config } from "../config";
import { client } from "../index";
import { DockerService } from "./DockerService";
import { TimeService } from "./TimeService";
import Docker from "dockerode";

export class HomeassistantService {
  public static createEntities(client: any) {
    DockerService.getContainers().then((containers) => {
      containers.forEach((container) => {
        const image = container.Config.Image;
        const imageInfo = DockerService.getImageInfo(image);
        const currentTags = imageInfo.RepoTags.map((tag: string) => tag.split(":")[1]);
        currentTags.forEach((currentTag) => {
          const entity = {
            name: `${container.Name.substring(1)}-${currentTag}`,
            unique_id: `${container.Id}-${currentTag}`,
            device: {
              identifiers: [container.Id],
              name: container.Name.substring(1),
              model: image,
              manufacturer: "Docker",
            },
            availability_topic: `${config.mqtt.topic}/${container.Id}/${currentTag}/availability`,
            payload_available: "online",
            payload_not_available: "offline",
            state_topic: `${config.mqtt.topic}/${container.Id}/${currentTag}/state`,
            json_attributes_topic: `${config.mqtt.topic}/${container.Id}/${currentTag}/attributes`,
            command_topic: `${config.mqtt.topic}/${container.Id}/${currentTag}/update`,
          };
          client.publish(
            `homeassistant/sensor/${container.Id}/${currentTag}/config`,
            JSON.stringify(entity),
            { retain: true }
          );
          client.publish(
            `${config.mqtt.topic}/${container.Id}/${currentTag}/availability`,
            "online",
            { retain: true }
          );
        });
      });
    });
  }

  public static createUpdate(
    container: Docker.ContainerInspectInfo,
    currentTag: string,
    previousDigest: string,
    newDigest: string,
    client: any
  ) {
    const update = {
      name: `${container.Name.substring(1)}-${currentTag}-update`,
      unique_id: `${container.Id}-${currentTag}-update`,
      device: {
        identifiers: [container.Id],
        name: container.Name.substring(1),
        model: container.Config.Image,
        manufacturer: "Docker",
      },
      availability_topic: `${config.mqtt.topic}/${container.Id}/${currentTag}/availability`,
      payload_available: "online",
      payload_not_available: "offline",
      state_topic: `${config.mqtt.topic}/${container.Id}/${currentTag}/update/state`,
      json_attributes_topic: `${config.mqtt.topic}/${container.Id}/${currentTag}/update/attributes`,
      command_topic: `${config.mqtt.topic}/${container.Id}/${currentTag}/update`,
    };
    client.publish(
      `homeassistant/sensor/${container.Id}/${currentTag}-update/config`,
      JSON.stringify(update),
      { retain: true }
    );
    client.publish(
      `${config.mqtt.topic}/${container.Id}/${currentTag}/update/state`,
      "New version available",
      { retain: true }
    );
    client.publish(
      `${config.mqtt.topic}/${container.Id}/${currentTag}/update/attributes`,
      JSON.stringify({
        current_version: previousDigest,
        new_version: newDigest,
        last_checked: new Date().toLocaleString(),
      }),
      { retain: true }
    );
  }

  public static handleUpdate(
    container: Docker.ContainerInspectInfo,
    currentTag: string,
    newDigest: string,
    client: any
  ) {
    console.debug(`🔄 Updating container ${container.Name.substring(1)}:${currentTag}`);
    client.publish(
      `${config.mqtt.topic}/${container.Id}/${currentTag}/update/state`,
      "Updating...",
      { retain: true }
    );
    DockerService.updateContainer(container, currentTag).then(() => {
      console.debug(`✅ Container ${container.Name.substring(1)}:${currentTag} updated`);
      client.publish(
        `${config.mqtt.topic}/${container.Id}/${currentTag}/update/state`,
        "Up-to-date",
        { retain: true }
      );
      client.publish(
        `${config.mqtt.topic}/${container.Id}/${currentTag}/update/attributes`,
        JSON.stringify({
          current_version: newDigest,
          new_version: newDigest,
          last_checked: new Date().toLocaleString(),
        }),
        { retain: true }
      );
      client.publish(
        `${config.mqtt.topic}/${container.Id}/${currentTag}/state`,
        "Up-to-date",
        { retain: true }
      );
      client.publish(
        `${config.mqtt.topic}/${container.Id}/${currentTag}/attributes`,
        JSON.stringify({
          current_version: newDigest,
          last_checked: new Date().toLocaleString(),
        }),
        { retain: true }
      );
    });
  }
}
