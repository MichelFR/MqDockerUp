import mqtt from "mqtt";
import ConfigService from "./services/ConfigService";
import DockerService from "./services/DockerService";
import HomeassistantService from "./services/HomeassistantService";
import TimeService from "./services/TimeService";
import logger from "./services/LoggerService"

const config = ConfigService.getConfig();
const client = mqtt.connect(config.mqtt.connectionUri, {
  username: config.mqtt.username,
  password: config.mqtt.password,
  protocolVersion: config.mqtt.protocolVersion,
  connectTimeout: config.mqtt.connectTimeout,
  clientId: config.mqtt.clientId,
});

client.subscribe(`${config.mqtt.topic}/update`);

const checkAndPublishUpdates = async (): Promise<void> => {
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
  checkAndPublishUpdates();

  HomeassistantService.publishAvailability(client, true);
  HomeassistantService.publishConfigMessages(client);

  startInterval();
});

client.on("message", async (topic: string, message: any) => {
  const data = JSON.parse(message);
  const containerId = data?.containerId;
  const image = data?.image;

  if ((topic = "mqdockerup/update" && containerId)) {
    logger.info(`Got update message for ${image}`);
    await DockerService.updateContainer(containerId, client);

    logger.info("Updated container ");

    await checkAndPublishUpdates();
  }
});

const exitHandler = async (exitCode: number, error?: any) => {
  HomeassistantService.publishAvailability(client, false);

  const now = new Date().toLocaleString();
  let message = exitCode === 0 ? `MqDockerUp gracefully stopped` : `MqDockerUp stopped due to an error`;
  
  
  if (error) {
    logger.error(message);
    logger.error(typeof error);
    logger.error(error);
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
