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
const availabilityTopic = `${config.mqtt.topic}/availability`;

const client = mqtt.connect(config.mqtt.connectionUri, {
  username: config.mqtt.username,
  password: config.mqtt.password,
  protocolVersion: ConfigService.autoParseEnvVariable(config.mqtt.protocolVersion),
  connectTimeout: ConfigService.autoParseEnvVariable(config.mqtt.connectTimeout),
  clientId: config.mqtt.clientId,
  reconnectPeriod: 5000,
  rejectUnauthorized: false,
  will: {
    topic: availabilityTopic,
    payload: "offline",
    qos: 1,
    retain: true
  }
});

logger.level = ConfigService?.getConfig()?.logs?.level;

// Track connection state
let isConnected = false;
let reconnectCount = 0;
const MAX_RECONNECT_DELAY = ConfigService.autoParseEnvVariable(config.mqtt.maxReconnectDelay) * 1000 || 300000;

export const mqttClient = client;

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

  // Publish availability as online
  await HomeassistantService.publishAvailability(client, true);

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
  client.subscribe(`${config.mqtt.topic}/start`);
  client.subscribe(`${config.mqtt.topic}/stop`);
  client.subscribe(`${config.mqtt.topic}/pause`);
  client.subscribe(`${config.mqtt.topic}/unpause`);
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
      await checkAndPublishImageUpdateMessages();
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
  } else if (topic == `${config.mqtt.topic}/start`) {
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
      logger.info(`Got start message for ${data?.containerId}`);
      await DockerService.startContainer(data?.containerId);
      logger.info("Started container");
    }

    await checkAndPublishContainerMessages();
  } else if (topic == `${config.mqtt.topic}/stop`) {
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
      logger.info(`Got stop message for ${data?.containerId}`);
      await DockerService.stopContainer(data?.containerId);
      logger.info("Stopped container");
    }

    await checkAndPublishContainerMessages();
  } else if (topic == `${config.mqtt.topic}/pause`) {
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
      logger.info(`Got pause message for ${data?.containerId}`);
      await DockerService.pauseContainer(data?.containerId);
      logger.info("Paused container");
    }

    await checkAndPublishContainerMessages();
  } else if (topic == `${config.mqtt.topic}/unpause`) {
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
      logger.info(`Got unpause message for ${data?.containerId}`);
      await DockerService.unpauseContainer(data?.containerId);
      logger.info("Unpaused container");
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
const containerEventHandler = _.debounce((eventName: string, data: { containerName: string, containerId: string }) => {
  logger.info(`Container ${eventName}: ${data.containerName} (${data.containerId})`);
}, 300);

// Debounced container check to avoid multiple rapid checks
const debouncedContainerCheck = _.debounce(() => {
  checkAndPublishContainerMessages();
}, 2000); // Wait 2 seconds after last event before checking

// Map Docker event action to a more human readable log string
const eventMap: Record<string, string> = {
  create: 'created',
  start: 'started',
  die: 'died',
  health_status: 'health_status',
  stop: 'stopped',
  destroy: 'destroyed',
  rename: 'renamed',
  update: 'updated',
  pause: 'paused',
  unpause: 'unpaused',
  restart: 'restarted',
};

// Register listeners for Docker events
Object.entries(eventMap).forEach(([eventName, logName]) => {
  DockerService.events.on(eventName, (data) => {
    containerEventHandler(logName, data);
    // Use debounced check to batch multiple events that happen close together
    debouncedContainerCheck();
  });
});


let isExiting = false;
const exitHandler = async (exitCode: number, error?: any) => {
  if (isExiting) {
    return;
  }
  isExiting = true;

  try {
    logger.info("Shutting down MqDockerUp...");
    
    if (isConnected) {
      await HomeassistantService.publishAvailability(client, false);
    }
    
    const updatingContainers = DockerService.updatingContainers;

    if (updatingContainers.length > 0) {
      logger.warn(
        `Stopping MqDockerUp while updating containers: ${updatingContainers.join(", ")}`
      );
      for (const containerId of updatingContainers) {
        await HomeassistantService.publishAbortUpdateMessage(containerId, client);
      }
    }

    logger.info("Closing MQTT connection...");
    await new Promise<void>((resolve) => {
      client.end(false, {}, () => {
        logger.info("MQTT connection closed successfully");
        resolve();
      });
      
      setTimeout(() => {
        logger.warn("MQTT connection close timed out");
        resolve();
      }, 2000);
    });

    let message = exitCode === 0 ? `MqDockerUp gracefully stopped` : `MqDockerUp stopped due to an error`;

    if (error) {
      logger.error(message);
      logger.error(typeof error);
      logger.error(error.stack);
    } else {
      logger.info(message);
    }
  } catch (e) {
    logger.error("Error during exit handling:", e);
  } finally {
    process.exit(exitCode);
  }
};

client.on("error", (error) => exitHandler(1, error));
process.on("SIGINT", () => exitHandler(0));
process.on("SIGTERM", () => exitHandler(0));
process.on("uncaughtException", (error) => exitHandler(1, error));
process.on("unhandledRejection", (error) => exitHandler(1, error));