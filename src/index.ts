import mqtt from "mqtt";
import ConfigService from "./services/ConfigService";
import DockerService from "./services/DockerService";
import HomeassistantService from "./services/HomeassistantService";
import TimeService from "./services/TimeService";
import logger from "./services/LoggerService"
require('source-map-support').install();

const config = ConfigService.getConfig();
const client = mqtt.connect(config.mqtt.connectionUri, {
  username: config.mqtt.username,
  password: config.mqtt.password,
  protocolVersion: config.mqtt.protocolVersion,
  connectTimeout: config.mqtt.connectTimeout,
  clientId: config.mqtt.clientId,
});

const checkAndPublishUpdates = async (): Promise<void> => {
  logger.info("Checking for new/old containers...");
  await HomeassistantService.publishConfigMessages(client);

  logger.info("Checking for image updates...");

  await HomeassistantService.publishAvailability(client, true);
  await HomeassistantService.publishMessages(client);

  logger.info("Finished checking for image updates");
  logger.info(`Next check in ${TimeService.formatDuration(TimeService.parseDuration(config.main.interval))}`);
};

let intervalId: NodeJS.Timeout;

const startInterval = async () => {
  intervalId = setInterval(checkAndPublishUpdates, TimeService.parseDuration(config.main.interval));
};

client.on("connect", async () => {
  logger.info("Connected to MQTT broker");
  await HomeassistantService.publishAvailability(client, true);
  await checkAndPublishUpdates();
  startInterval();

  client.subscribe(`${config.mqtt.topic}/update`);
  client.subscribe('homeassistant/+/+/+/config', { qos: 0 });
});

client.on("message", async (topic: string, message: any) => {
  const data = JSON.parse(message);

  // Missing Docker Container-Handler, removes the /config message from MQTT when the container is missing
  // This removes the entity from Home Assistant if the container is not existing anymore
  if (data?.device?.manufacturer === "MqDockerUp" && topic?.endsWith("/config")) {
    const image = data?.device?.model;
    await DockerService.checkIfContainerExists(image).then((containerExists) => {
      if (!containerExists && topic) {
        HomeassistantService.publishMessage(client, topic, "", {retain: true, qos: 0});
        logger.info(`Removed missing container ${image} from Home Assistant`);
      }
    });
  }

  // Update-Handler for the /update message from MQTT
  // This is triggered by the Home Assistant button in the UI to update a container
  if ((topic = "mqdockerup/update" && data?.containerId)) {
    const image = data?.image;
    logger.info(`Got update message for ${image}`);
    await DockerService.updateContainer(data?.containerId, client);
    logger.info("Updated container");

    checkAndPublishUpdates();
  }
});

const exitHandler = (exitCode: number, error?: any) => {
  HomeassistantService.publishAvailability(client, false);

  const now = new Date().toLocaleString();
  let message = exitCode === 0 ? `MqDockerUp gracefully stopped` : `MqDockerUp stopped due to an error`;


  if (error) {
    logger.error(message);
    logger.error(typeof error);
    logger.error(error.stack);
  } else {
    logger.info(message);
  }

  process.exit(exitCode);
};

client.on("error", (error) => exitHandler(1, error));
process.on("SIGINT", () => exitHandler(0));
process.on("SIGTERM", () => exitHandler(0));
process.on("uncaughtException", (error) => exitHandler(1, error));
process.on("unhandledRejection", (error) => exitHandler(1, error));
