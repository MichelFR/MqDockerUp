import ConfigService from "./ConfigService";
import DockerService from "./DockerService";

const config = ConfigService.getConfig();

export default class HomeassistantService {
  // Create MQTT Homeassistant entity for the container
  static createEntity(container: any, mqttClient: any): void {
    if (config.mqtt.ha_discovery) {
      const containerId = container.Id;
      const containerName = container.Name;
      const containerState = container.State;
      const containerStatus = container.Status;
      const containerImage = container.Config.Image;
      const containerPorts = container.NetworkSettings.Ports;
      const containerNetworks = container.NetworkSettings.Networks;

      // Define the entity configuration
      const entityConfig = {
        name: containerName,
        unique_id: containerId,
        device_class: "problem",
        state_topic: `${config.mqtt.topic}/${containerId}/state`,
        json_attributes_topic: `${config.mqtt.topic}/${containerId}/attributes`,
        availability_topic: `${config.mqtt.topic}/${containerId}/availability`,
        payload_available: "online",
        payload_not_available: "offline",
      };

      // Publish the entity configuration to the discovery topic
      mqttClient.publish(
        `homeassistant/binary_sensor/${containerId}/config`,
        JSON.stringify(entityConfig),
        {
          qos: config.mqtt.qos,
          retain: config.mqtt.retain,
        }
      );

      // Publish the entity state to the state topic
      mqttClient.publish(
        `${config.mqtt.topic}/${containerId}/state`,
        containerState === "running" ? "OFF" : "ON",
        {
          qos: config.mqtt.qos,
          retain: config.mqtt.retain,
        }
      );

      // Publish the entity attributes to the attributes topic
      mqttClient.publish(
        `${config.mqtt.topic}/${containerId}/attributes`,
        JSON.stringify({
          status: containerStatus,
          image: containerImage,
          ports: containerPorts,
          networks: containerNetworks,
        }),
        {
          qos: config.mqtt.qos,
          retain: config.mqtt.retain,
        }
      );

      // Publish the entity availability to the availability topic
      mqttClient.publish(
        `${config.mqtt.topic}/${containerId}/availability`,
        "online",
        {
          qos: config.mqtt.qos,
          retain: config.mqtt.retain,
        }
      );
    }
  }

  // Create MQTT Homeassistant entity for the update
  static createUpdate(container: any, currentTag: string, previousDigest: string, newDigest: string, mqttClient: any): void {
    if (config.mqtt.ha_discovery) {
      const containerId = container.Id;
      const containerName = container.Name;
      const containerImage = container.Config.Image;

      const updateId = `${containerId}_update`;
      const updateName = `${containerName} Update`;

      // Define the update entity configuration
      const updateConfig = {
        name: updateName,
        unique_id: updateId,
        device_class: "update",
        state_topic: `${config.mqtt.topic}/${updateId}/state`,
        json_attributes_topic: `${config.mqtt.topic}/${updateId}/attributes`,
        availability_topic: `${config.mqtt.topic}/${updateId}/availability`,
        payload_available: "online",
        payload_not_available: "offline",
      };

      // Publish the update entity configuration to the discovery topic
      mqttClient.publish(
        `homeassistant/binary_sensor/${updateId}/config`,
        JSON.stringify(updateConfig),
        {
          qos: config.mqtt.qos,
          retain: config.mqtt.retain,
        }
      );

      // Publish the update entity state to the state topic
      mqttClient.publish(
        `${config.mqtt.topic}/${updateId}/state`,
        "ON",
        {
          qos: config.mqtt.qos,
          retain: config.mqtt.retain,
        }
      );

      // Publish the update entity attributes to the attributes topic
      mqttClient.publish(
        `${config.mqtt.topic}/${updateId}/attributes`,
        JSON.stringify({
          image: containerImage,
          current_tag: currentTag,
          current_digest: previousDigest,
          new_tag: currentTag,
          new_digest: newDigest,
        }),
        {
          qos: config.mqtt.qos,
          retain: config.mqtt.retain,
        }
      );

      // Publish the update entity availability to the availability topic
      mqttClient.publish(
        `${config.mqtt.topic}/${updateId}/availability`,
        "online",
        {
          qos: config.mqtt.qos,
          retain: config.mqtt.retain,
        }
      );
    }
  }

  // Update MQTT Homeassistant entity for the container
  static updateEntity(container: any, mqttClient: any): void {
    if (config.mqtt.ha_discovery) {
      const containerId = container.Id;
      const containerState = container.State;

      // Publish the entity state to the state topic
      mqttClient.publish(
        `${config.mqtt.topic}/${containerId}/state`,
        containerState === "running" ? "OFF" : "ON",
        {
          qos: config.mqtt.qos,
          retain: config.mqtt.retain,
        }
      );

      // Publish the entity availability to the availability topic
      mqttClient.publish(
        `${config.mqtt.topic}/${containerId}/availability`,
        "online",
        {
          qos: config.mqtt.qos,
          retain: config.mqtt.retain,
        }
      );
    }
  }

  // Update MQTT Homeassistant entity for the update
  static updateUpdate(container: any, currentTag: string, previousDigest: string, newDigest: string, mqttClient: any): void {
    if (config.mqtt.ha_discovery) {
      const containerId = container.Id;
      const containerImage = container.Config.Image;

      const updateId = `${containerId}_update`;

      // Publish the update entity state to the state topic
      mqttClient.publish(
        `${config.mqtt.topic}/${updateId}/state`,
        "ON",
        {
          qos: config.mqtt.qos,
          retain: config.mqtt.retain,
        }
      );

      // Publish the update entity attributes to the attributes topic
      mqttClient.publish(
        `${config.mqtt.topic}/${updateId}/attributes`,
        JSON.stringify({
          image: containerImage,
          current_tag: currentTag,
          current_digest: previousDigest,
          new_tag: currentTag,
          new_digest: newDigest,
        }),
        {
          qos: config.mqtt.qos,
          retain: config.mqtt.retain,
        }
      );

      // Publish the update entity availability to the availability topic
      mqttClient.publish(
        `${config.mqtt.topic}/${updateId}/availability`,
        "online",
        {
          qos: config.mqtt.qos,
          retain: config.mqtt.retain,
        }
      );
    }
  }

  // Delete MQTT Homeassistant entity for the container
  static deleteEntity(container: any, mqttClient: any): void {
    if (config.mqtt.ha_discovery) {
      const containerId = container.Id;

      // Publish an empty message to the discovery topic to delete the entity
      mqttClient.publish(
        `homeassistant/binary_sensor/${containerId}/config`,
        "",
        {
          qos: config.mqtt.qos,
          retain: config.mqtt.retain,
        }
      );
    }
  }

  // Delete MQTT Homeassistant entity for the update
  static deleteUpdate(container: any, mqttClient: any): void {
    if (config.mqtt.ha_discovery) {
      const containerId = container.Id;

      const updateId = `${containerId}_update`;

      // Publish an empty message to the discovery topic to delete the update
      mqttClient.publish(
        `homeassistant/binary_sensor/${updateId}/config`,
        "",
        {
          qos: config.mqtt.qos,
          retain: config.mqtt.retain,
        }
      );
    }
  }
}
