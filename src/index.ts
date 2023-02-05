import axios, { AxiosResponse } from "axios";
import mqtt from "mqtt";
import ConfigService from "./services/ConfigService";
import DockerService from "./services/DockerService";
import TimeService from "./services/TimeService";

const config = ConfigService.getConfig();
const client = mqtt.connect(config.mqtt.connectionUri, {
  username: config.mqtt.username,
  password: config.mqtt.password,
  protocolVersion: config.mqtt.protocolVersion,
  connectTimeout: config.mqtt.connectTimeout,
  clientId: config.mqtt.clientId,
});
const cache = new Map();

interface Result {
  name: string;
}

interface RepositoryTagsResponse {
  results: Result[];
}

const checkAndPublishUpdates = async (): Promise<void> => {
  const containers = await DockerService.listContainers();
  for (const container of containers) {
    const image = container.Config.Image;
    const imageInfo = await DockerService.getImageInfo(image);
    const currentVersion = imageInfo.RepoTags;

    let newVersion = cache.get(image);
    if (!newVersion) {
      const response: AxiosResponse<RepositoryTagsResponse> = await axios.get(
        `https://registry.hub.docker.com/v2/repositories/${image}/tags/list`,
        {
          headers: {
            Authorization: `Bearer ${config.dockerhub.token}`,
          },
        }
      );
      const tags = response.data.results.map((r) => r.name);
      newVersion = tags[0];
      cache.set(image, newVersion);
    }

    if (newVersion !== currentVersion[0]) {
      client.publish(
        `${config.mqtt.topic}/${image}`,
        `${currentVersion} -> ${newVersion}`,
        {
          qos: config.mqtt.qos,
          retain: config.mqtt.config,
        }
      );
    }
  }
};

let intervalId: NodeJS.Timeout;

const startInterval = () => {
  intervalId = setInterval(
    checkAndPublishUpdates,
    TimeService.parseDuration(config.main.interval)
  );
};

client.on("connect", () => {
  if (config.mqtt.ha_discovery) {
    // TODO: Add homeassistant discovery
    // https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery
  }

  startInterval();
});

process.on("SIGINT", () => {
  clearInterval(intervalId);
  console.log(`MqDockerUp stopped at ${new Date().toLocaleString()}`);
  process.exit();
});
