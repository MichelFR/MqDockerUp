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
    const currentTags = imageInfo.RepoTags.map(tag => tag.split(":")[1]);

    for (const currentTag of currentTags) {
      const response = await axios.get(
        `https://registry.hub.docker.com/v2/repositories/library/${image}/tags?name=${currentTag}`
      );
      if (response.data.results[0].images) {
        const newDigest = response.data.results[0].digest;
        const previousDigest = imageInfo.RepoDigests.find(d => d.endsWith(`:${currentTag}`));

        if (!imageInfo.RepoDigests.find(d => d.endsWith(`@${newDigest}`))) {
          console.debug(`New version available`);
          client.publish(
            `${config.mqtt.topic}/${image}`,
            `Image: ${image}\nTag: ${currentTag}\nPrevious Digest: ${previousDigest}\nNew Digest: ${newDigest}`,
            {
              qos: config.mqtt.qos,
              retain: config.mqtt.retain,
            }
          );
        } else {
          console.debug(`Image ${image}:${currentTag} is up-to-date`);
        }
      } else {
        console.debug(`No information found for image: ${image}:${currentTag}`);
      }
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
  checkAndPublishUpdates();

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
