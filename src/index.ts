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

// Check for new/old containers and publish updates
const checkAndPublishUpdates = async (): Promise<void> => {
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

  logger.info("Checking for image updates...");
  await HomeassistantService.publishAvailability(client, true);
  await HomeassistantService.publishMessages(client);

  logger.info("Finished checking for image updates");
  logger.info(`Next check in ${TimeService.formatDuration(TimeService.parseDuration(config.main.interval))}`);
};


// Check for new/old containers and publish updates
const checkAndPublishStats = async (): Promise<void> => {
  await HomeassistantService.publishStats(client);
};

let intervalId: NodeJS.Timeout;
let intervalId2: NodeJS.Timeout;

const startInterval = async () => {
  intervalId = setInterval(checkAndPublishUpdates, TimeService.parseDuration(config.main.interval));
  intervalId2 = setInterval(checkAndPublishStats, TimeService.parseDuration(config.main.statsInterval));
};

// Connected to MQTT broker
client.on('connect', async function () {
  logger.info('MQTT client successfully connected');

  await HomeassistantService.publishAvailability(client, true);
  await checkAndPublishUpdates();
  startInterval();

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
      await checkAndPublishUpdates();
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

    await checkAndPublishUpdates();
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
      await checkAndPublishUpdates();
    }
  }
});

// Docker event handlers
// TODO: Do this in a more elegant way
const containerEventHandler = _.debounce((eventName: string, data: {containerName: string, containerId: string}) => {
  console.log(`Container ${eventName}: ${data.containerName} (${data.containerId})`);
}, 300);

DockerService.events.on('create', (data) => {
  containerEventHandler('created', data);
  checkAndPublishUpdates();
});

DockerService.events.on('start', (data) => {
  containerEventHandler('started', data);
  checkAndPublishUpdates();
});

DockerService.events.on('die', (data) => {
  containerEventHandler('died', data);
  checkAndPublishUpdates();
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
