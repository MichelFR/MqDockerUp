import yaml from "yaml";
import fs from "fs";
import logger from "./LoggerService";

/**
 * ConfigService class that provides access to the application configuration settings.
 */
export default class ConfigService {


  /**
   * Attempts to automatically parse the given value as a boolean or number.
   * If the value cannot be parsed as either, the original value is returned.
   * @param value The value to parse.
   * @returns The parsed value, or the original value if parsing failed.
   */
  public static autoParseEnvVariable(value: string | any): boolean | number | string | undefined | any {
    if (value === undefined) return undefined;

    if (typeof value === "string") {
      // Attempt to convert to boolean
      if (value.toLowerCase() === 'true') return true;
      if (value.toLowerCase() === 'false') return false;
  
      // Attempt to convert to number
      const numberValue = Number(value);
      if (!isNaN(numberValue)) return numberValue;
    }

    // If none of the above work, return the original string
    return value;
  }


  /**
   * Gets the configuration settings.
   * @returns {any} The merged configuration settings.
   */
  public static getConfig(): any {
    try {
      // Define the default values
      const defaults = {
        main: {
          interval: "", // Deprecated in next version in favor of containerCheckInterval
          imageUpdateInterval: "",
          containerCheckInterval: "5m",
          updateCheckInterval: "",
          prefix: "",
        },
        mqtt: {
          connectionUri: "mqtt://localhost:1883",
          topic: "mqdockerup",
          discoveryPrefix: "homeassistant",
          suggestedArea: "Docker",
          clientId: "mqdockerup",
          username: "ha",
          password: "",
          haLegacy: false,
          connectTimeout: 60,
          protocolVersion: 5,
          maxReconnectDelay: 300, // Maximum reconnect delay in seconds
        },
        accessTokens: {
          dockerhub: "",
          github: "",
        },
        ignore: {
          containers: "",
          updates: ""
        },
        logs: {
          level: "info"
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

      for (const key of Object.keys(defaults.logs)) {
        const envKey = process.env[`LOGS_${key.toUpperCase()}`];
        if (envKey !== undefined) {
          config.logs[key] = envKey;
        }
      }

      // #region "Deprecation Messages"

      if (config.main["interval"] !== undefined) {
        logger.warn("The property `main.interval` is deprecated, please use `main.containerCheckInterval` instead.");
        if (config.main["containerCheckInterval"] === undefined) {
          config.main["containerCheckInterval"] = config.main["interval"];
        }

      }

      if (config.main["imageUpdateInterval"] !== undefined) {
        logger.warn("The property `main.imageUpdateInterval` is deprecated, please use `main.updateCheckInterval` instead.");
        if (config.main["updateCheckInterval"] === undefined) {
          config.main["updateCheckInterval"] = config.main["imageUpdateInterval"];
        }

      }

      // #endregion "Deprecation"

      // Sync intervals if updateCheckInterval is empty
      if (config.main["updateCheckInterval"] === undefined || config.main["updateCheckInterval"] == "") {
        config.main["updateCheckInterval"] = config.main["containerCheckInterval"];
      }

      // Merge the config values with the default values
      return Object.assign(defaults, config);
    } catch (e) {
      logger.error(e);
    }
  }
}
