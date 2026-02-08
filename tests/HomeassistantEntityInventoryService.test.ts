import {
  buildPublishedEntityInventoryForContainer,
  getContainerSensorStateTopic,
  getContainerUpdateStateTopic,
  sanitizeImageForTopic,
} from "../src/services/HomeassistantEntityInventoryService";

describe("HomeassistantEntityInventoryService", () => {
  test("sanitizes image names exactly as topic naming requires", () => {
    expect(sanitizeImageForTopic("ghcr.io/example/web-app")).toBe(
      "ghcr_io_example_web_app"
    );
  });

  test("builds inventory with sensor/update state topics and button null state", () => {
    const container = {
      id: "abc123",
      name: "web-app",
      image: "ghcr.io/example/web-app",
      tag: "1.0.0",
    };

    const discoveryTopics = [
      {
        topic: "homeassistant/sensor/ghcr_io_example_web_app_1-0-0/docker_status/config",
      },
      {
        topic:
          "homeassistant/button/ghcr_io_example_web_app_1-0-0/docker_manual_restart/config",
      },
      {
        topic: "homeassistant/update/ghcr_io_example_web_app_1-0-0/docker_update/config",
      },
    ];

    const inventory = buildPublishedEntityInventoryForContainer(
      container,
      discoveryTopics
    );

    const sensorEntity = inventory.find((entity) => entity.component === "sensor");
    const buttonEntity = inventory.find((entity) => entity.component === "button");
    const updateEntity = inventory.find((entity) => entity.component === "update");

    expect(sensorEntity?.stateTopic).toBe(
      getContainerSensorStateTopic(container.image)
    );
    expect(buttonEntity?.stateTopic).toBeNull();
    expect(updateEntity?.stateTopic).toBe(
      getContainerUpdateStateTopic(container.image)
    );
  });
});

