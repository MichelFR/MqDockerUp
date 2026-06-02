import * as mqtt from "mqtt";
import ConfigService from "./services/ConfigService";
import DockerService from "./services/DockerService";
import HomeassistantService from "./services/HomeassistantService";
import DatabaseService from "./services/DatabaseService";
import MigrationService from "./services/MigrationService";
import TimeService from "./services/TimeService";
import MqttCommandService, {ContainerCommand, ContainerCommandPayload} from "./services/MqttCommandService";
import logger from "./services/LoggerService"
const _ = require('lodash');

require('source-map-support').install();

const config = ConfigService.getConfig();
const availabilityTopic = `${config.mqtt.topic}/availability`;
const isContainerCheckOnChangesEnabled = ConfigService.autoParseEnvVariable(config.main.containerCheckOnChanges) !== false;

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

  // One-off cleanup of legacy (image-based) discovery topics before publishing
  // the current container-based ones, so upgrading instances don't keep
  // orphaned Home Assistant entities.
  MigrationService.runStartupMigrations(client);

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

  client.subscribe(MqttCommandService.getCommandSubscription(config.mqtt.topic));
  for (const legacyCommandTopic of MqttCommandService.getLegacyCommandSubscriptions(config.mqtt.topic)) {
    client.subscribe(legacyCommandTopic);
  }
});

client.on('error', function (err) {
  logger.error('MQTT client connection error: ', err);
});

type CommandHandler = (payload: ContainerCommandPayload) => Promise<void>;

const refreshContainersAfterCommand = async (): Promise<void> => {
  await checkAndPublishContainerMessages();
};

const commandHandlers: Record<ContainerCommand, CommandHandler> = {
  update: async (payload) => {
    logger.info(`Got update message for ${payload.image || payload.containerId}`);
    await DockerService.updateContainer(payload.containerId);
    logger.info("Updated container");
    await refreshContainersAfterCommand();
    await checkAndPublishImageUpdateMessages();
  },
  restart: async (payload) => {
    logger.info(`Got restart message for ${payload.containerId}`);
    await DockerService.restartContainer(payload.containerId);
    logger.info("Restarted container");
    await refreshContainersAfterCommand();
  },
  start: async (payload) => {
    logger.info(`Got start message for ${payload.containerId}`);
    await DockerService.startContainer(payload.containerId);
    logger.info("Started container");
    await refreshContainersAfterCommand();
  },
  stop: async (payload) => {
    logger.info(`Got stop message for ${payload.containerId}`);
    await DockerService.stopContainer(payload.containerId);
    logger.info("Stopped container");
    await refreshContainersAfterCommand();
  },
  pause: async (payload) => {
    logger.info(`Got pause message for ${payload.containerId}`);
    await DockerService.pauseContainer(payload.containerId);
    logger.info("Paused container");
    await refreshContainersAfterCommand();
  },
  unpause: async (payload) => {
    logger.info(`Got unpause message for ${payload.containerId}`);
    await DockerService.unpauseContainer(payload.containerId);
    logger.info("Unpaused container");
    await refreshContainersAfterCommand();
  },
  manualUpdate: async (payload) => {
    logger.info(`Got manual update message for ${payload.containerId}`);
    await DockerService.updateContainer(payload.containerId);
    logger.info("Updated container");
    await refreshContainersAfterCommand();
  },
};

client.on("message", async (topic: string, message: Buffer) => {
  const commandMessage = MqttCommandService.parseCommandMessage(config.mqtt.topic, topic, message);

  if (!commandMessage) {
    if (MqttCommandService.isCommandTopic(config.mqtt.topic, topic)) {
      logger.warn(`Ignored invalid MQTT command message on ${topic}`);
    }
    return;
  }

  try {
    await commandHandlers[commandMessage.command](commandMessage.payload);
  } catch (error) {
    logger.error(`Failed to execute command ${commandMessage.command}:`, error);
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

if (isContainerCheckOnChangesEnabled) {
  // Register listeners for Docker events
  Object.entries(eventMap).forEach(([eventName, logName]) => {
    DockerService.events.on(eventName, (data) => {
      containerEventHandler(logName, data);
      // Use debounced check to batch multiple events that happen close together
      debouncedContainerCheck();
    });
  });

  DockerService.listenToDockerEvents();
} else {
  logger.info(
    "Container change checks are disabled (`main.containerCheckOnChanges=false`). This is recommended when monitoring many containers to reduce MQTT message traffic."
  );
}


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
