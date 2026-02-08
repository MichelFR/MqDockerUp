import ConfigService from "./ConfigService";

export type HomeassistantEntityComponent = "sensor" | "button" | "update";

export interface HomeassistantEntityInventoryItem {
  component: HomeassistantEntityComponent;
  entityKey: string;
  discoveryTopic: string;
  stateTopic: string | null;
}

export interface DatabaseContainerRow {
  id: string;
  name: string;
  image: string;
  tag: string;
}

const config = ConfigService.getConfig();
const invalidTopicCharactersRegex =
  /[\/.:;,+*?@^$%#!&"'`|<>{}\[\]()-\s\u0000-\u001F\u007F]/g;

export const sanitizeImageForTopic = (image: string): string =>
  image.replace(invalidTopicCharactersRegex, "_");

export const getContainerSensorStateTopic = (image: string): string =>
  `${config.mqtt.topic}/${sanitizeImageForTopic(image)}`;

export const getContainerUpdateStateTopic = (image: string): string =>
  `${config.mqtt.topic}/${sanitizeImageForTopic(image)}/update`;

export const buildPublishedEntityInventoryForContainer = (
  container: DatabaseContainerRow,
  topicRows: Array<{ topic: string }>
): HomeassistantEntityInventoryItem[] => {
  const sensorStateTopic = getContainerSensorStateTopic(container.image);
  const updateStateTopic = getContainerUpdateStateTopic(container.image);

  return topicRows.map((topicRow) => {
    const topicParts = topicRow.topic.split("/");
    const entityKey = topicParts[topicParts.length - 2] || "unknown";

    if (topicRow.topic.includes("/sensor/")) {
      return {
        component: "sensor" as const,
        entityKey,
        discoveryTopic: topicRow.topic,
        stateTopic: sensorStateTopic,
      };
    }

    if (topicRow.topic.includes("/update/")) {
      return {
        component: "update" as const,
        entityKey,
        discoveryTopic: topicRow.topic,
        stateTopic: updateStateTopic,
      };
    }

    return {
      component: "button" as const,
      entityKey,
      discoveryTopic: topicRow.topic,
      stateTopic: null,
    };
  });
};

