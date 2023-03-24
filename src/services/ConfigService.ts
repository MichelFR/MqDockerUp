import yaml from "yaml";
import fs from "fs";

/**
 * ConfigService class that provides access to the application configuration settings.
 */
export default class ConfigService {
  /**
   * Gets the configuration settings.
   * @returns {any} The merged configuration settings.
   */
  public static getConfig(): any {
    try {
      // Define the default values
      const defaults = {
        main: {
          interval: "5m",
        },
        mqtt: {
          connectionUri: "mqtt://localhost:1883",
          topic: "mqdockerup",
          clientId: "mqdockerup",
          username: "ha",
          password: "12345678",
          connectTimeout: 60,
          protocolVersion: 5,
        },
      };

      const config = yaml.parse(fs.readFileSync("config.yaml", "utf8"));

      // Override the main values with the environment variables
      for (const key of Object.keys(defaults.main)) {
        config.main[key] = process.env[`MAIN_${key.toUpperCase()}`] ?? config.main[key];
      }

      // Override the mqtt values with the environment variables
      for (const key of Object.keys(defaults.mqtt)) {
        config.mqtt[key] = process.env[`MQTT_${key.toUpperCase()}`] ?? config.mqtt[key];
      }

      // Merge the config values with the default values
      return Object.assign(defaults, config);
    } catch (e) {
      console.log(e);
    }
  }
}
