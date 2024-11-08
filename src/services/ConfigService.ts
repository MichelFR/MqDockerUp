import yaml from "yaml";
import fs from "fs";
import logger from "./LoggerService";

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
          prefix: "",
        },
        mqtt: {
          connectionUri: "mqtt://localhost:1883",
          topic: "mqdockerup",
          discovery_prefix: "homeassistant",
          clientId: "mqdockerup",
          username: "ha",
          password: "",
          ha_legacy: false,
          connectTimeout: 60,
          protocolVersion: 5,
        },
        accessTokens: {
          dockerhub: "",
          github: "",
        },
        ignore:{
          containers: "",
          updates: ""
        }
      };

      const config = yaml.parse(fs.readFileSync("config.yaml", "utf8"));

      // Override the main values with the environment variables
      for (const key of Object.keys(defaults.main)) {
        const envKey = process.env[`MAIN_${key.toUpperCase()}`];
        if (envKey !== undefined) {
          config.main[key] = envKey;
        }
      }

      // Override the mqtt values with the environment variables
      for (const key of Object.keys(defaults.mqtt)) {
        const envKey = process.env[`MQTT_${key.toUpperCase()}`];
        if (envKey !== undefined) {
          config.mqtt[key] = envKey;
        }
      }

      for (const key of Object.keys(defaults.accessTokens)) {
        const envKey = process.env[`ACCESSTOKENS_${key.toUpperCase()}`];
        if (envKey !== undefined) {
          config.accessTokens[key] = envKey;
        }
      }

      for (const key of Object.keys(defaults.ignore)) {
        const envKey = process.env[`IGNORE_${key.toUpperCase()}`];
        if (envKey !== undefined) {
          config.ignore[key] = envKey;
        }
      }

      // Merge the config values with the default values
      return Object.assign(defaults, config);
    } catch (e) {
      logger.error(e);
    }
  }
}
