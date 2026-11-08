import * as mqtt from "mqtt";
import ConfigService from "./services/ConfigService";
import DockerService from "./services/DockerService";
import HomeassistantService from "./services/HomeassistantService";
import DatabaseService from "./services/DatabaseService";
import MigrationService from "./services/MigrationService";
import TimeService from "./services/TimeService";
import logger from "./services/LoggerService"
import SelfUpdateService from "./services/SelfUpdateService";
const _ = require('lodash');

require('source-map-support').install();

const config = ConfigService.getConfig();
const baseTopic: string = config.mqtt.topic;
const availabilityTopic = `${baseTopic}/availability`;
const isContainerCheckOnChangesEnabled = ConfigService.autoParseEnvVariable(config.main.containerCheckOnChanges) !== false;

// Forget the predecessor before any Docker event can clear its discovery.
const predecessorId = process.env[SelfUpdateService.predecessorVariable];
const discoveryHandoff = predecessorId && /^[a-f0-9]{64}$/.test(predecessorId)
  ? DatabaseService.deleteContainer(predecessorId) : Promise.resolve();
discoveryHandoff.catch(error => logger.error("Self-update discovery handoff failed:", error));

const client = mqtt.connect(config.mqtt.connectionUri, {
  username: config.mqtt.username,
  password: config.mqtt.password,
  protocolVersion: ConfigService.autoParseEnvVariable(config.mqtt.protocolVersion),
  // mqtt.js expects milliseconds; the config value is documented in seconds.
  connectTimeout: Number(ConfigService.autoParseEnvVariable(config.mqtt.connectTimeout) ?? 60) * 1000,
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

let isConnected = false;

export const mqttClient = client;

/** Reads all containers known to the database. */
const getStoredContainers = (): Promise<any[]> =>
  new Promise((resolve) => {
    DatabaseService.getContainers((err: any, rows: any[]) => {
      if (err) {
        logger.error(err);
        resolve([]);
        return;
      }
      resolve(rows);
    });
  });

/** Removes containers from Home Assistant that are in the database but no longer exist in Docker. */
const removeVanishedContainers = async (existingContainerIds: string[]): Promise<void> => {
  logger.info("Checking for removed containers...");
  for (const stored of await getStoredContainers()) {
    if (!existingContainerIds.includes(stored.id)) {
      await HomeassistantService.removeContainer(client, stored.id);
      logger.info(`Removed missing container ${stored.name} from Home Assistant and database.`);
    }
  }
};

/** Full sweep: reconcile every container with Home Assistant. Runs at startup and on the interval. */
const checkAndPublishContainerMessages = async (): Promise<void> => {
  logger.info("Checking for containers...");
  const containers = await DockerService.listContainers();

  await removeVanishedContainers(containers.map((container) => container.Id));
  await HomeassistantService.publishAvailability(client, true);
  await HomeassistantService.publishConfigMessages(client, containers);
  await HomeassistantService.publishContainerMessages(client, containers);

  logger.info("Finished checking for containers");
  logger.info(`Next check in ${TimeService.formatDuration(TimeService.parseDuration(config.main.containerCheckInterval))}`);
};

const checkAndPublishImageUpdateMessages = async (): Promise<void> => {
  logger.info("Checking for image updates...");
  await HomeassistantService.publishImageUpdateMessages(client);

  logger.info("Finished checking for image updates");
  logger.info(`Next check in ${TimeService.formatDuration(TimeService.parseDuration(config.main.updateCheckInterval))}`);
};

/**
 * Targeted refresh of a single container after a Docker event or a command:
 * republish it if it still exists, otherwise remove it from Home Assistant.
 * @param containerId The affected container
 * @param renamed Whether the container was renamed, which moves its topics
 */
const refreshContainer = async (containerId: string, renamed = false): Promise<void> => {
  try {
    await discoveryHandoff;
    if (containerId === predecessorId) return;
    if (renamed) {
      // Topics are keyed by container name; clear the ones under the old name.
      await HomeassistantService.removeContainer(client, containerId);
    }

    const container = await DockerService.getMonitoredContainer(containerId);
    if (container) {
      await HomeassistantService.publishContainer(client, container);
    } else if (await HomeassistantService.removeContainer(client, containerId)) {
      logger.info(`Removed missing container ${containerId.substring(0, 12)} from Home Assistant and database.`);
    }
  } catch (error) {
    logger.error(`Failed to refresh container ${containerId.substring(0, 12)}:`, error);
  }
};

// The connect handler runs again on every reconnect; the intervals must
// only be created once or the sweeps multiply.
let intervalsStarted = false;

const startContainerCheckingInterval = () => {
  logger.verbose(`Setting up startContainerCheckingInterval with value ${config.main.containerCheckInterval}`);
  setInterval(checkAndPublishContainerMessages, TimeService.parseDuration(config.main.containerCheckInterval));
};

const startImageCheckingInterval = () => {
  logger.verbose(`Setting up startImageCheckingInterval with value ${config.main.updateCheckInterval}`);
  setInterval(checkAndPublishImageUpdateMessages, TimeService.parseDuration(config.main.updateCheckInterval));
};

/**
 * Commands Home Assistant can send on `<baseTopic>/<command>` with a
 * `{ containerId }` payload. Updates publish the new container themselves;
 * every other command is followed by a targeted refresh of the container.
 */
const commands: Record<string, { run: (containerId: string) => Promise<unknown>; done: string; refresh: boolean }> = {
  update: { run: (id) => DockerService.updateContainer(id), done: "Updated container", refresh: false },
  manualUpdate: { run: (id) => DockerService.updateContainer(id), done: "Updated container", refresh: false },
  restart: { run: (id) => DockerService.restartContainer(id), done: "Restarted container", refresh: true },
  start: { run: (id) => DockerService.startContainer(id), done: "Started container", refresh: true },
  stop: { run: (id) => DockerService.stopContainer(id), done: "Stopped container", refresh: true },
  pause: { run: (id) => DockerService.pauseContainer(id), done: "Paused container", refresh: true },
  unpause: { run: (id) => DockerService.unpauseContainer(id), done: "Unpaused container", refresh: true },
};

// Connected to MQTT broker
client.on('connect', async function () {
  logger.info('MQTT client successfully connected');
  isConnected = true;

  // The broker may have restarted and lost its retained messages, so
  // everything has to be published again.
  HomeassistantService.resetPublishCache();

  await discoveryHandoff;

  await HomeassistantService.publishAvailability(client, true);

  // One-off cleanup of legacy (image-based) discovery topics before publishing
  // the current container-based ones, so upgrading instances don't keep
  // orphaned Home Assistant entities.
  MigrationService.runStartupMigrations(client);

  if (config?.ignore?.containers == "*") {
    logger.warn('Skipping setup of container checking cause all containers is ignored `ignore.containers="*"`.')
  } else {
    await checkAndPublishContainerMessages();
    if (!intervalsStarted) startContainerCheckingInterval();
  }

  // A successful self-replacement completes even when its registry cannot
  // provide version metadata. Do not leave HA's progress active until a lookup.
  if (predecessorId && /^[a-f0-9]{64}$/.test(predecessorId)) {
    const selfId = SelfUpdateService.getContainerId();
    if (selfId) {
      const self = await DockerService.docker.getContainer(selfId).inspect();
      await HomeassistantService.publishUpdateProgressMessage(self, client, 100, false);
    }
  }

  client.subscribe(Object.keys(commands).map((command) => `${baseTopic}/${command}`), (error, granted) => {
    if (error || granted?.some(subscription => subscription.qos === 128)) {
      logger.error("Failed to subscribe to container commands:", error);
      return;
    }
    if (client.connected) SelfUpdateService.markReady();
  });

  // Registry checks can take much longer than local discovery. Command
  // subscriptions must be ready before they can block the self-update handoff.
  if (config?.ignore?.updates == "*") {
    logger.warn('Skipping setup of image update checking cause all containers update is ignored `ignore.updates="*"`.')
  } else {
    await checkAndPublishImageUpdateMessages();
    if (!intervalsStarted) startImageCheckingInterval();
  }
  intervalsStarted = true;
});

client.on('close', () => {
  isConnected = false;
  SelfUpdateService.clearReady();
});

// Connection errors (e.g. "connack timeout") are recoverable: mqtt.js reconnects
// on its own every `reconnectPeriod` ms, so only log them instead of exiting.
client.on('error', function (err) {
  logger.error(`MQTT client connection error: ${err.message}. Retrying in ${(client.options.reconnectPeriod ?? 5000) / 1000}s...`);
});

client.on("message", async (topic: string, message: any) => {
  const commandName = topic.startsWith(`${baseTopic}/`) ? topic.substring(baseTopic.length + 1) : "";
  const command = commands[commandName];
  if (!command) {
    return;
  }

  let data: any;
  try {
    data = JSON.parse(message);
  } catch (error) {
    logger.warn(`Failed to parse message: ${message}. Error: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  if (!data?.containerId) {
    return;
  }

  logger.info(`Got ${commandName} message for ${data.containerId}`);
  await command.run(data.containerId);
  logger.info(command.done);

  if (command.refresh) {
    await refreshContainer(data.containerId);
  }
});

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

// Containers touched by Docker events since the last flush. Events are
// batched for 2 seconds and then only the affected containers are refreshed,
// instead of republishing the whole fleet on every event.
const pendingContainerIds = new Set<string>();
const renamedContainerIds = new Set<string>();

const flushPendingContainerRefreshes = _.debounce(async () => {
  const containerIds = [...pendingContainerIds];
  pendingContainerIds.clear();

  for (const containerId of containerIds) {
    const renamed = renamedContainerIds.delete(containerId);
    await refreshContainer(containerId, renamed);
  }
}, 2000);

if (isContainerCheckOnChangesEnabled) {
  Object.entries(eventMap).forEach(([eventName, logName]) => {
    DockerService.events.on(eventName, ({ containerName, containerId }: { containerName: string; containerId: string }) => {
      logger.info(`Container ${logName}: ${containerName} (${containerId})`);
      if (eventName === 'rename') {
        renamedContainerIds.add(containerId);
      }
      pendingContainerIds.add(containerId);
      flushPendingContainerRefreshes();
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
    SelfUpdateService.clearReady();
    logger.info("Shutting down MqDockerUp...");

    if (isConnected) {
      await HomeassistantService.publishAvailability(client, false);
    }

    const updatingContainers = DockerService.updatingContainers.filter(id => id !== SelfUpdateService.handoffContainerId);

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

process.on("SIGINT", () => exitHandler(0));
process.on("SIGTERM", () => exitHandler(0));
process.on("uncaughtException", (error) => exitHandler(1, error));
process.on("unhandledRejection", (error) => exitHandler(1, error));
