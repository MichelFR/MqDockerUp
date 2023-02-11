import axios, { AxiosResponse } from "axios";
import mqtt from "mqtt";
import ConfigService from "./services/ConfigService";
import DockerService from "./services/DockerService";
import TimeService from "./services/TimeService";

const config = ConfigService.getConfig();
const packageJson = require("../../package.json");
const client = mqtt.connect(config.mqtt.connectionUri, {
  username: config.mqtt.username,
  password: config.mqtt.password,
  protocolVersion: config.mqtt.protocolVersion,
  connectTimeout: config.mqtt.connectTimeout,
  clientId: config.mqtt.clientId,
});

const checkAndPublishUpdates = async (): Promise<void> => {
  console.log("🔍 Checking for updates...");
  const containers = await DockerService.listContainers();
  for (const container of containers) {
    const image = container.Config.Image;
    const imageWithoutTags = container.Config.Image.split(":")[0];
    const imageInfo = await DockerService.getImageInfo(image);
    const currentTags = imageInfo.RepoTags.map(tag => tag.split(":")[1]);

    for (const currentTag of currentTags) {
      const response = await axios.get(
        `https://registry.hub.docker.com/v2/repositories/${imageWithoutTags}/tags?name=${currentTag}`
      );
      if (response.data.results[0].images) {
        const newDigest = response.data.results[0].digest;
        const previousDigest = imageInfo.RepoDigests.find(d => d.endsWith(`:${currentTag}`));

        if (!imageInfo.RepoDigests.find(d => d.endsWith(`@${newDigest}`))) {
          console.debug(`🚨 New version available for image ${image}`);
          if (!config.mqtt.ha_discovery) {
            client.publish(
              `${config.mqtt.topic}/${image}`,
              `Image: ${image}\nTag: ${currentTag}\nPrevious Digest: ${previousDigest}\nNew Digest: ${newDigest}`,
              {
                qos: config.mqtt.qos,
                retain: config.mqtt.retain,
              }
            );
          }
        } else {
          console.debug(`🟢 Image ${image}:${currentTag} is up-to-date`);
        }
      } else {
        console.debug(`🔍 No information found for image: ${image}:${currentTag}`);
      }
    }
  }

  console.debug("🔍 Finished checking for updates");
  console.debug(`🕒 Next check in ${TimeService.formatDuration(TimeService.parseDuration(config.main.interval))}`);
};

let intervalId: NodeJS.Timeout;

const startInterval = () => {
  const intervalDuration = TimeService.parseDuration(config.main.interval);
  intervalId = setInterval(
    checkAndPublishUpdates,
    TimeService.parseDuration(config.main.interval)
  );
  console.debug(`🔁 Checking for updates every ${config.main.interval}`);
};


client.on("connect", async () => {
  console.debug("🚀 Connected to MQTT broker");
  checkAndPublishUpdates();

  if (config.mqtt.ha_discovery) {
    console.debug("🔍 HomeAssistant discovery activated");    
    const containers = await DockerService.listContainers();

    
    client.publish(
      `${config.mqtt.topic}/availability`,
      "online",
      {
        retain: true
      }
    );

    function replaceSlashes(str: string): string {
      return str.replace(/\//g, "_");
    }

    for (const container of containers) {
      const image = container.Config.Image;
      const imageWithoutTags = container.Config.Image.split(":")[0];
      const imageInfo = await DockerService.getImageInfo(image);
      const currentTag = image.split(":")[1];
      const imageWithoutTagsAndSlashes = replaceSlashes(imageWithoutTags);
    
      // Generate a mqtt message creating homeassistant entities
      const payload = {
        "name": `Docker Image`,
        "unique_id": `${image}`,
        "state_topic": `${config.mqtt.topic}/${imageWithoutTagsAndSlashes}`,
        "availability": [
          {
              "topic": `${config.mqtt.topic}/availability`
          }
        ],
        "device": {
          "manufacturer": "MqDockerUp",
          "model": image,
          "name": imageWithoutTags,
          "sw_version": packageJson.version,
          "sa": "docker",
          "identifiers": [
            `${imageWithoutTags}_${currentTag}`
          ]
        },
        "icon": "mdi:docker"
      };

      // Publish the message to the homeassistant discovery topic
      client.publish(
        `homeassistant/sensor/${imageWithoutTagsAndSlashes}_${currentTag}/sensor/config`,
        JSON.stringify(payload),
        {retain: true}
      );
     
      client.publish(
        `${config.mqtt.topic}/${imageWithoutTagsAndSlashes}`,
        imageWithoutTags,
        {retain: true}
      );
    }

  } else {
    console.debug("🔍 HomeAssistant discovery not activated");
  }

  startInterval();
});

client.on("error", (error) => {
  console.error("💥 Could not connect to MQTT server.");
  clearInterval(intervalId);
  console.debug(`🛑 MqDockerUp stopped due to an error, at ${new Date().toLocaleString()}`);
  process.exit(0);
});

process.on("SIGINT", async () => {
  clearInterval(intervalId);
  await client.publish(
    `${config.mqtt.topic}/availability`,
    "offline",
    {
      retain: true
    }
  );

  console.debug(`🛑 MqDockerUp stopped at ${new Date().toLocaleString()}`);
  process.exit(0);
});