import DatabaseService from "./DatabaseService";
import logger from "./LoggerService";

const LEGACY_TOPIC_CLEANUP_KEY = "legacyContainerTopicCleanup";

/**
 * Runs one-off data/MQTT migrations on startup.
 */
export default class MigrationService {

  /**
   * Runs all pending startup migrations. Safe to call on every startup; each
   * migration guards itself so it only runs once.
   * @param client The connected MQTT client.
   */
  public static runStartupMigrations(client: any): void {
    try {
      this.clearLegacyDiscoveryTopics(client);
    } catch (err: any) {
      logger.error(`Startup migration failed: ${err?.message || err}`);
    }
  }

  /**
   * One-time cleanup for instances upgrading from versions that keyed MQTT
   * discovery topics off the image instead of the container name. Every
   * previously-published (retained) discovery topic — persisted in the database
   * when it was first published — is cleared with an empty payload so Home
   * Assistant removes the old entity and the broker drops the retained message.
   * The stored containers/topics are then dropped so the current scheme
   * re-registers them keyed off the container name. Guarded by a meta flag so it
   * only runs once.
   * @param client The connected MQTT client.
   */
  private static clearLegacyDiscoveryTopics(client: any): void {
    if (DatabaseService.getMeta(LEGACY_TOPIC_CLEANUP_KEY)) {
      return;
    }

    const topics = DatabaseService.getAllTopics();
    for (const { topic } of topics) {
      // An empty, retained payload is what removes the entity and clears the
      // retained discovery message. (publishMessage would turn "" into "{}",
      // which would not remove anything, so publish directly here.)
      client.publish(topic, "", { retain: true, qos: 0 });
    }

    // Drop the stored containers/topics so the current scheme re-registers them
    // (and stores the new topic names for future removals).
    DatabaseService.getContainers((err: any, rows: any) => {
      if (err || !rows) {
        return;
      }
      for (const container of rows) {
        DatabaseService.deleteContainer(container.id);
      }
    });

    DatabaseService.setMeta(LEGACY_TOPIC_CLEANUP_KEY, "done");

    if (topics.length > 0) {
      logger.info(`Migration: cleared ${topics.length} legacy discovery topic(s); entities will be republished under the container-name scheme.`);
    }
  }
}
