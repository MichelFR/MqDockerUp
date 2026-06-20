import ConfigService from "./ConfigService";

const config = ConfigService.getConfig();

/**
 * Central place for building the per-container MQTT topics and Home Assistant
 * identifiers. Keeping this in one service avoids duplicating the naming logic
 * across HomeassistantService and guarantees that the discovery `state_topic`
 * and the topic the state is actually published to always match.
 */
export default class TopicService {

  /**
   * The per-container device name (optionally prefixed) used for MQTT topics and
   * Home Assistant entity identities. Basing it on the container name — instead
   * of the image — means multiple containers of the same image, and containers
   * with the same name on different hosts (distinguished via the prefix), no
   * longer overwrite each other.
   * @param container The inspected container.
   * @returns The device name, e.g. "nginx" or "host1_nginx".
   */
  public static getDeviceName(container: any): string {
    const prefix = config?.main?.prefix || "";
    const containerName = container.Name.substring(1);
    return prefix ? `${prefix}_${containerName}` : containerName;
  }

  /**
   * The base MQTT state topic for a device, e.g. "mqdockerup/host1_nginx".
   * @param deviceName The device name from {@link getDeviceName}.
   */
  public static getStateTopic(deviceName: string): string {
    return `${config.mqtt.topic}/${deviceName}`;
  }

  /**
   * The MQTT update topic for a device, e.g. "mqdockerup/host1_nginx/update".
   * @param deviceName The device name from {@link getDeviceName}.
   */
  public static getUpdateTopic(deviceName: string): string {
    return `${this.getStateTopic(deviceName)}/update`;
  }

  /**
   * Slugifies a value into a string safe for use in Home Assistant entity ids.
   * @param value The value to slugify.
   */
  public static slugify(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  }
}
