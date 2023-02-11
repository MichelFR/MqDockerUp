import yaml from "yaml";
import fs from "fs";

export default class ConfigService {
  public static getConfig(): any {
    try {
      const config = yaml.parse(fs.readFileSync("config.yaml", "utf8"));
      for (const key of Object.keys(config)) {
        if (process.env[key]) {
          config[key] = process.env[key];
        }
      }
      return config;
    } catch (e) {
      console.log(e);
    }
  }
}
