import yaml from "yaml";
import fs from "fs";

export default class ConfigService {
  public static getConfig(): any {
    try {
      // Define the default values
      const defaults = {
        main: {
          interval: "15m",
        },
        mqtt: {
          ha_discovery: true,
          connectionUri: "mqtt://localhost:1883",
          topic: "mqdockerup",
          clientId: "mqdockerup",
          username: "ha",
          password: "12345678",
          connectTimeout: 60,
          protocolVersion: 5,
          qos: 2,
          retain: false,
        },
      };

      // Parse the config file
      const config = yaml.parse(fs.readFileSync("config.yaml", "utf8"));

      // Override the config values with the environment variables
      for (const key of Object.keys(config)) {
        if (process.env[key]) {
          config[key] = process.env[key];
        }
      }

      // Merge the config values with the default values
      return { ...defaults, ...config };
    } catch (e) {
      console.log(e);
    }
  }
}
