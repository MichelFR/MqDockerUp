import * as mqtt from "mqtt";
import ConfigService from "./services/ConfigService";
import DockerService from "./services/DockerService";
import HomeassistantService from "./services/HomeassistantService";
import DatabaseService from "./services/DatabaseService";
import TimeService from "./services/TimeService";
import logger from "./services/LoggerService"
const _ = require('lodash');

require('source-map-support').install();

const config = ConfigService.getConfig();
const client = mqtt.connect(config.mqtt.connectionUri, {
  username: config.mqtt.username,
  password: config.mqtt.password,
  protocolVersion: config.mqtt.protocolVersion,
  connectTimeout: config.mqtt.connectTimeout,
  clientId: config.mqtt.clientId,
});
logger.level = ConfigService?.getConfig()?.logs?.level;

// Check for new/old containers and publish updates
const checkAndPublishContainerMessages = async (): Promise<void> => {
  logger.info("Checking for removed containers...");
  const containers = await DockerService.listContainers();
  const runningContainerIds = containers.map(container => container.Id);

  // Get all container IDs in the database
  DatabaseService.getContainers((err: any, rows: any) => {
    if (err) {
      logger.error(err);
      return;
    }

    // Iterate over each container in the database
    rows.forEach((container: any) => {

      // If the container is not in the running containers list, then it has stopped
      if (!runningContainerIds.includes(container.id)) {
        // Get the topics associated with this container
        DatabaseService.getTopics(container.id, (err: any, topics: any) => {
          if (err) {
            logger.error(err);
            return;
          }

          // Iterate over each topic and publish an empty message
          topics.forEach((topic: any) => {
            HomeassistantService.publishMessage(client, topic.topic, "", { retain: true, qos: 0 });
          });

          // Remove the container and its associated topics from the database
          logger.info(`Removed missing container ${container.name} from Home Assistant and database.`);
          DatabaseService.deleteContainer(container.id);
        });
      }
    });
  });

  logger.info("Checking for containers...");
  await HomeassistantService.publishConfigMessages(client);
  await HomeassistantService.publishAvailability(client, true);
  await HomeassistantService.publishContainerMessages(client);

  logger.info("Finished checking for containers");
  logger.info(`Next check in ${TimeService.formatDuration(TimeService.parseDuration(config.main.containerCheckInterval))}`);
};

const checkAndPublishImageUpdateMessages = async (): Promise<void> => {
  logger.info("Checking for image updates...");
  await HomeassistantService.publishImageUpdateMessages(client);

  logger.info("Finished checking for image updates");
  logger.info(`Next check in ${TimeService.formatDuration(TimeService.parseDuration(config.main.updateCheckInterval))}`);
};

let containerCheckingIntervalId: NodeJS.Timeout;

const startContainerCheckingInterval = async () => {
  logger.verbose(`Setting up startContainerCheckingInterval with value ${config.main.containerCheckInterval}`);
  containerCheckingIntervalId = setInterval(checkAndPublishContainerMessages, TimeService.parseDuration(config.main.containerCheckInterval));
};

let imageCheckingInterval: NodeJS.Timeout;

const startImageCheckingInterval = async () => {
  logger.verbose(`Setting up startImageCheckingInterval with value ${config.main.updateCheckInterval}`);
  imageCheckingInterval = setInterval(checkAndPublishImageUpdateMessages, TimeService.parseDuration(config.main.updateCheckInterval));
};

// Connected to MQTT broker
client.on('connect', async function () {
  logger.info('MQTT client successfully connected');

  if (config?.ignore?.containers == "*") {
    logger.warn('Skipping setup of container checking cause all containers is ignored `ignore.containers="*"`.')
  } else {
    await checkAndPublishContainerMessages();
    startContainerCheckingInterval();
  }

  if (config?.ignore?.updates == "*") {
    logger.warn('Skipping setup of image update checking cause all containers update is ignored `ignore.updates="*"`.')
  } else {
    await checkAndPublishImageUpdateMessages();
    startImageCheckingInterval();
  }

  client.subscribe(`${config.mqtt.topic}/update`);
  client.subscribe(`${config.mqtt.topic}/restart`);
  client.subscribe(`${config.mqtt.topic}/manualUpdate`);
});

client.on('error', function (err) {
  logger.error('MQTT client connection error: ', err);
});

// Update-Handler for the /update message from MQTT
client.on("message", async (topic: string, message: any) => {
  if (topic == `${config.mqtt.topic}/update`) {
    let data;
    try {
      data = JSON.parse(message);
    } catch (error) {
      if (error instanceof Error) {
        logger.warn(`Failed to parse message: ${message}. Error: ${error.message}`);
      } else {
        logger.warn(`Failed to parse message: ${message}. Error: ${String(error)}`);
      }
      return;
    }

    // Update-Handler for the /update message from MQTT
    // This is triggered by the Home Assistant button in the UI to update a container
    if (data?.containerId) {
      const image = data?.image;
      logger.info(`Got update message for ${image}`);
      await DockerService.updateContainer(data?.containerId);
      logger.info("Updated container");
      await checkAndPublishContainerMessages();
    }
  } else if (topic == `${config.mqtt.topic}/restart`) {
    let data;
    try {
      data = JSON.parse(message);
    } catch (error) {
      if (error instanceof Error) {
        logger.warn(`Failed to parse message: ${message}. Error: ${error.message}`);
      } else {
        logger.warn(`Failed to parse message: ${message}. Error: ${String(error)}`);
      }
      return;
    }

    if (data?.containerId) {
      logger.info(`Got restart message for ${data?.containerId}`);
      await DockerService.restartContainer(data?.containerId);
      logger.info("Restarted container");
    }

    await checkAndPublishContainerMessages();
  } else if (topic == `${config.mqtt.topic}/manualUpdate`) {
    let data;
    try {
      data = JSON.parse(message);
    } catch (error) {
      if (error instanceof Error) {
        logger.warn(`Failed to parse message: ${message}. Error: ${error.message}`);
      } else {
        logger.warn(`Failed to parse message: ${message}. Error: ${String(error)}`);
      }
      return;
    }

    if (data?.containerId) {
      logger.info(`Got manual update message for ${data?.containerId}`);
      await DockerService.updateContainer(data?.containerId);
      logger.info("Updated container");
      await checkAndPublishContainerMessages();
    }
  }
});

// Docker event handlers
// TODO: Do this in a more elegant way
const containerEventHandler = _.debounce((eventName: string, data: { containerName: string, containerId: string }) => {
  logger.info(`Container ${eventName}: ${data.containerName} (${data.containerId})`);
}, 300);

DockerService.events.on('create', (data) => {
  containerEventHandler('created', data);
  checkAndPublishContainerMessages();
});

DockerService.events.on('start', (data) => {
  containerEventHandler('started', data);
  checkAndPublishContainerMessages();
});

DockerService.events.on('die', (data) => {
  containerEventHandler('died', data);
  checkAndPublishContainerMessages();
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
