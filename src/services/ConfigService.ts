import yaml from "yaml";
import fs from "fs";

export default class ConfigService {
  public static getConfig(): any {
    try {
      // Define the default values
      const defaults = {
        main: {
          interval: "1m",
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

      // Parse the environment variables
      const env = {
        main: {
          interval: process.env.MAIN_INTERVAL,
        },
        mqtt: {
          ha_discovery: process.env.MQTT_HA_DISCOVERY,
          connectionUri: process.env.MQTT_CONNECTIONURI,
          topic: process.env.MQTT_TOPIC,
          clientId: process.env.MQTT_CLIENTID,
          username: process.env.MQTT_USERNAME,
          password: process.env.MQTT_PASSWORD,
          connectTimeout: process.env.MQTT_CONNECTTIMEOUT,
          protocolVersion: process.env.MQTT_PROTOCOLVERSION,
          qos: process.env.MQTT_QOS,
          retain: process.env.MQTT_RETAIN,
        },
      };

      // Merge the env, config, and default values
      return { ...defaults, ...config, ...env };
    } catch (e) {
      console.log(e);
    }
  }
}
