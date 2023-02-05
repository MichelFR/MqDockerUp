import yaml from "yaml";
import fs from "fs";

export class ConfigService {
  public static getConfig(): any {
    try {
      return yaml.parse(fs.readFileSync("config.yaml", "utf8"));
    } catch (e) {
      console.log(e);
    }
  }
}

export default ConfigService;
