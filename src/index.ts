import * as mqtt from "mqtt";
import { ContainerInspectInfo } from "dockerode";
import ConfigService from "./services/ConfigService";
import DockerService, { DockerContainerEventData } from "./services/DockerService";
import HomeassistantService from "./services/HomeassistantService";
import DatabaseService from "./services/DatabaseService";
import TimeService from "./services/TimeService";
import logger from "./services/LoggerService";
import IgnoreService from "./services/IgnoreService";
import {
  buildPublishedEntityInventoryForContainer,
} from "./services/HomeassistantEntityInventoryService";
import type {
  DatabaseContainerRow,
  HomeassistantEntityInventoryItem,
} from "./services/HomeassistantEntityInventoryService";
import {
  getEventDrivenUpdatePlan,
  SUPPORTED_CONTAINER_EVENT_ACTIONS,
} from "./services/ContainerEventService";
import type { SupportedContainerEventAction } from "./services/ContainerEventService";

require("source-map-support").install();

const config = ConfigService.getConfig();
const availabilityTopic = `${config.mqtt.topic}/availability`;
const isContainerCheckOnChangesEnabled =
  ConfigService.autoParseEnvVariable(config.main.containerCheckOnChanges) !== false;

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
    retain: true,
  },
});

logger.level = ConfigService?.getConfig()?.logs?.level;

// Track connection state
let isConnected = false;

export const mqttClient = client;

const publishedEntityInventoryByContainerId = new Map<
  string,
  HomeassistantEntityInventoryItem[]
>();
let dockerEventListenerStarted = false;

const getDatabaseContainers = async (): Promise<DatabaseContainerRow[]> =>
  new Promise((resolve, reject) => {
    DatabaseService.getContainers((err: any, rows: DatabaseContainerRow[]) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(rows || []);
    });
  });

const getDatabaseContainer = async (
  containerId: string
): Promise<DatabaseContainerRow | null> =>
  new Promise((resolve, reject) => {
    DatabaseService.getContainer(
      containerId,
      (err: any, row: DatabaseContainerRow | null) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(row || null);
      }
    );
  });

const getContainerTopics = async (
  containerId: string
): Promise<Array<{ topic: string }>> =>
  new Promise((resolve, reject) => {
    DatabaseService.getTopics(containerId, (err: any, rows: Array<{ topic: string }>) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(rows || []);
    });
  });

const rebuildPublishedEntityInventory = async (): Promise<void> => {
  const nextInventory = new Map<string, HomeassistantEntityInventoryItem[]>();
  const dbContainers = await getDatabaseContainers();

  for (const dbContainer of dbContainers) {
    const topicRows = await getContainerTopics(dbContainer.id);
    nextInventory.set(
      dbContainer.id,
      buildPublishedEntityInventoryForContainer(dbContainer, topicRows)
    );
  }

  publishedEntityInventoryByContainerId.clear();
  for (const [containerId, entities] of nextInventory.entries()) {
    publishedEntityInventoryByContainerId.set(containerId, entities);
  }
};

const clearRetainedTopic = async (topic: string): Promise<void> => {
  await HomeassistantService.publishMessage(client, topic, "", {
    retain: true,
    qos: 0,
  });
};

const cleanupContainerFromHomeAssistantAndDatabase = async (
  containerId: string,
  containerName?: string
): Promise<void> => {
  const discoveryTopics = await getContainerTopics(containerId);

  if (discoveryTopics.length === 0) {
    await DatabaseService.deleteContainer(containerId);
    publishedEntityInventoryByContainerId.delete(containerId);
    return;
  }

  for (const topic of discoveryTopics) {
    await clearRetainedTopic(topic.topic);
  }

  let inventoryForRemovedContainer =
    publishedEntityInventoryByContainerId.get(containerId);

  if (!inventoryForRemovedContainer) {
    const dbContainer = await getDatabaseContainer(containerId);
    if (dbContainer) {
      inventoryForRemovedContainer = buildPublishedEntityInventoryForContainer(
        dbContainer,
        discoveryTopics
      );
    }
  }

  if (inventoryForRemovedContainer) {
    const stateTopicsToCleanup = [
      ...new Set(
        inventoryForRemovedContainer
          .map((entity) => entity.stateTopic)
          .filter((topic): topic is string => !!topic)
      ),
    ];

    for (const stateTopic of stateTopicsToCleanup) {
      const isSharedByOtherContainer = Array.from(
        publishedEntityInventoryByContainerId.entries()
      ).some(
        ([otherContainerId, entities]) =>
          otherContainerId !== containerId &&
          entities.some((entity) => entity.stateTopic === stateTopic)
      );

      if (!isSharedByOtherContainer) {
        await clearRetainedTopic(stateTopic);
      }
    }
  }

  await DatabaseService.deleteContainer(containerId);
  publishedEntityInventoryByContainerId.delete(containerId);

  if (containerName) {
    logger.info(
      `Removed missing container ${containerName} from Home Assistant and database.`
    );
  }
};

const inspectContainerWithRetry = async (
  containerId: string,
  retries: number = 3,
  retryDelayMs: number = 300
): Promise<ContainerInspectInfo | null> => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await DockerService.docker.getContainer(containerId).inspect();
    } catch (error: any) {
      if (error?.statusCode !== 404) {
        logger.error(`Failed to inspect container ${containerId}:`, error);
        return null;
      }

      if (attempt < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  return null;
};

// Check for new/old containers and publish updates
const checkAndPublishContainerMessages = async (): Promise<void> => {
  logger.info("Checking for removed containers...");
  const containers = await DockerService.listContainers();
  const runningContainerIds = new Set(containers.map((container) => container.Id));

  await rebuildPublishedEntityInventory();

  const dbContainers = await getDatabaseContainers();
  for (const dbContainer of dbContainers) {
    if (!runningContainerIds.has(dbContainer.id)) {
      await cleanupContainerFromHomeAssistantAndDatabase(dbContainer.id, dbContainer.name);
    }
  }

  logger.info("Checking for containers...");
  await HomeassistantService.publishConfigMessages(client);
  await HomeassistantService.publishAvailability(client, true);
  await HomeassistantService.publishContainerMessages(client);
  await rebuildPublishedEntityInventory();

  logger.info("Finished checking for containers");
  logger.info(
    `Next check in ${TimeService.formatDuration(
      TimeService.parseDuration(config.main.containerCheckInterval)
    )}`
  );
};

const checkAndPublishImageUpdateMessages = async (): Promise<void> => {
  logger.info("Checking for image updates...");
  await HomeassistantService.publishImageUpdateMessages(client);

  logger.info("Finished checking for image updates");
  logger.info(
    `Next check in ${TimeService.formatDuration(
      TimeService.parseDuration(config.main.updateCheckInterval)
    )}`
  );
};

const handleContainerLifecycleEvent = async (
  eventName: SupportedContainerEventAction,
  data: DockerContainerEventData
): Promise<void> => {
  const eventPlan = getEventDrivenUpdatePlan(eventName);

  if (eventPlan.cleanupRemovedContainer) {
    await rebuildPublishedEntityInventory();
    await cleanupContainerFromHomeAssistantAndDatabase(data.containerId, data.containerName);
    return;
  }

  const retries = eventName === "create" ? 5 : 3;
  const container = await inspectContainerWithRetry(data.containerId, retries);

  if (!container) {
    logger.warn(
      `Skipping targeted update for ${eventName} event: container ${data.containerId} no longer exists.`
    );
    return;
  }

  if (eventPlan.publishConfig) {
    await HomeassistantService.publishConfigMessage(client, container);
  }

  if (eventPlan.publishContainerState) {
    await HomeassistantService.publishContainerMessage(container, client);
  }

  if (eventPlan.publishImageUpdateState && !IgnoreService.ignoreUpdates(container)) {
    await HomeassistantService.publishImageUpdateMessage(container, client);
  }

  await rebuildPublishedEntityInventory();
};

const containerEventQueues = new Map<string, Promise<void>>();

const queueContainerLifecycleEvent = (
  eventName: SupportedContainerEventAction,
  data: DockerContainerEventData
) => {
  const previousQueue = containerEventQueues.get(data.containerId) || Promise.resolve();

  const nextQueue = previousQueue
    .catch((error) => {
      logger.error(
        `Previous queued event failed for container ${data.containerId}:`,
        error
      );
    })
    .then(() => handleContainerLifecycleEvent(eventName, data))
    .catch((error) => {
      logger.error(
        `Failed to handle container event ${eventName} for ${data.containerId}:`,
        error
      );
    });

  containerEventQueues.set(data.containerId, nextQueue);

  nextQueue.finally(() => {
    if (containerEventQueues.get(data.containerId) === nextQueue) {
      containerEventQueues.delete(data.containerId);
    }
  });
};

let containerCheckingIntervalId: NodeJS.Timeout;

const startContainerCheckingInterval = async () => {
  logger.verbose(
    `Setting up startContainerCheckingInterval with value ${config.main.containerCheckInterval}`
  );

  if (containerCheckingIntervalId) {
    clearInterval(containerCheckingIntervalId);
  }

  containerCheckingIntervalId = setInterval(
    checkAndPublishContainerMessages,
    TimeService.parseDuration(config.main.containerCheckInterval)
  );
};

let imageCheckingInterval: NodeJS.Timeout;

const startImageCheckingInterval = async () => {
  logger.verbose(
    `Setting up startImageCheckingInterval with value ${config.main.updateCheckInterval}`
  );

  if (imageCheckingInterval) {
    clearInterval(imageCheckingInterval);
  }

  imageCheckingInterval = setInterval(
    checkAndPublishImageUpdateMessages,
    TimeService.parseDuration(config.main.updateCheckInterval)
  );
};

// Connected to MQTT broker
client.on("connect", async function () {
  logger.info("MQTT client successfully connected");
  isConnected = true;

  // Publish availability as online
  await HomeassistantService.publishAvailability(client, true);

  if (config?.ignore?.containers == "*") {
    logger.warn(
      'Skipping setup of container checking cause all containers is ignored `ignore.containers="*"`.'
    );
  } else {
    await checkAndPublishContainerMessages();
    startContainerCheckingInterval();
  }

  if (config?.ignore?.updates == "*") {
    logger.warn(
      'Skipping setup of image update checking cause all containers update is ignored `ignore.updates="*"`.'
    );
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

  if (isContainerCheckOnChangesEnabled && !dockerEventListenerStarted) {
    await rebuildPublishedEntityInventory();
    DockerService.listenToDockerEvents();
    dockerEventListenerStarted = true;
  }
});

client.on("offline", () => {
  isConnected = false;
});

client.on("close", () => {
  isConnected = false;
});

client.on("error", function (err) {
  logger.error("MQTT client connection error: ", err);
});

const parseJsonMessage = (message: any): any | null => {
  try {
    return JSON.parse(message);
  } catch (error) {
    if (error instanceof Error) {
      logger.warn(`Failed to parse message: ${message}. Error: ${error.message}`);
    } else {
      logger.warn(`Failed to parse message: ${message}. Error: ${String(error)}`);
    }
    return null;
  }
};

// Update-Handler for MQTT command topics
client.on("message", async (topic: string, message: any) => {
  if (topic == `${config.mqtt.topic}/update`) {
    const data = parseJsonMessage(message);
    if (!data) {
      return;
    }

    // This is triggered by the Home Assistant update entity in the UI
    if (data?.containerId) {
      const image = data?.image;
      logger.info(`Got update message for ${image}`);
      await DockerService.updateContainer(data?.containerId);
      logger.info("Updated container");

      if (!isContainerCheckOnChangesEnabled) {
        await checkAndPublishContainerMessages();
        await checkAndPublishImageUpdateMessages();
      }
    }
  } else if (topic == `${config.mqtt.topic}/restart`) {
    const data = parseJsonMessage(message);
    if (!data) {
      return;
    }

    if (data?.containerId) {
      logger.info(`Got restart message for ${data?.containerId}`);
      await DockerService.restartContainer(data?.containerId);
      logger.info("Restarted container");
    }

    if (!isContainerCheckOnChangesEnabled) {
      await checkAndPublishContainerMessages();
    }
  } else if (topic == `${config.mqtt.topic}/start`) {
    const data = parseJsonMessage(message);
    if (!data) {
      return;
    }

    if (data?.containerId) {
      logger.info(`Got start message for ${data?.containerId}`);
      await DockerService.startContainer(data?.containerId);
      logger.info("Started container");
    }

    if (!isContainerCheckOnChangesEnabled) {
      await checkAndPublishContainerMessages();
    }
  } else if (topic == `${config.mqtt.topic}/stop`) {
    const data = parseJsonMessage(message);
    if (!data) {
      return;
    }

    if (data?.containerId) {
      logger.info(`Got stop message for ${data?.containerId}`);
      await DockerService.stopContainer(data?.containerId);
      logger.info("Stopped container");
    }

    if (!isContainerCheckOnChangesEnabled) {
      await checkAndPublishContainerMessages();
    }
  } else if (topic == `${config.mqtt.topic}/pause`) {
    const data = parseJsonMessage(message);
    if (!data) {
      return;
    }

    if (data?.containerId) {
      logger.info(`Got pause message for ${data?.containerId}`);
      await DockerService.pauseContainer(data?.containerId);
      logger.info("Paused container");
    }

    if (!isContainerCheckOnChangesEnabled) {
      await checkAndPublishContainerMessages();
    }
  } else if (topic == `${config.mqtt.topic}/unpause`) {
    const data = parseJsonMessage(message);
    if (!data) {
      return;
    }

    if (data?.containerId) {
      logger.info(`Got unpause message for ${data?.containerId}`);
      await DockerService.unpauseContainer(data?.containerId);
      logger.info("Unpaused container");
    }

    if (!isContainerCheckOnChangesEnabled) {
      await checkAndPublishContainerMessages();
    }
  } else if (topic == `${config.mqtt.topic}/manualUpdate`) {
    const data = parseJsonMessage(message);
    if (!data) {
      return;
    }

    if (data?.containerId) {
      logger.info(`Got manual update message for ${data?.containerId}`);
      await DockerService.updateContainer(data?.containerId);
      logger.info("Updated container");

      if (!isContainerCheckOnChangesEnabled) {
        await checkAndPublishContainerMessages();
      }
    }
  }
});

const eventLogMap: Record<SupportedContainerEventAction, string> = {
  create: "created",
  start: "started",
  die: "died",
  health_status: "health status changed",
  stop: "stopped",
  destroy: "destroyed",
  rename: "renamed",
  update: "updated",
  pause: "paused",
  unpause: "unpaused",
  restart: "restarted",
};

if (isContainerCheckOnChangesEnabled) {
  // Register listeners for Docker events with targeted updates.
  SUPPORTED_CONTAINER_EVENT_ACTIONS.forEach((eventName) => {
    DockerService.events.on(eventName, (data: DockerContainerEventData) => {
      logger.info(
        `Container ${eventLogMap[eventName]}: ${data.containerName} (${data.containerId})`
      );
      queueContainerLifecycleEvent(eventName, data);
    });
  });
} else {
  logger.info(
    "Container change checks are disabled (`main.containerCheckOnChanges=false`)."
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

    let message =
      exitCode === 0
        ? `MqDockerUp gracefully stopped`
        : `MqDockerUp stopped due to an error`;

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
