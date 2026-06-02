process.env.MAIN_PREFIX = "server";

jest.mock("../src/index", () => ({
  mqttClient: {
    publish: jest.fn(),
    on: jest.fn(),
    end: jest.fn(),
  },
}));

jest.mock("../src/services/DockerService", () => ({
  __esModule: true,
  default: {
    listContainers: jest.fn(),
    getImageInfo: jest.fn(),
    getImageNewDigest: jest.fn(),
    getSourceRepo: jest.fn(),
  },
}));

jest.mock("../src/services/DatabaseService", () => ({
  __esModule: true,
  default: {
    containerExists: jest.fn().mockResolvedValue(false),
    addContainer: jest.fn().mockResolvedValue(undefined),
    addTopic: jest.fn().mockResolvedValue(undefined),
    getTopicsForContainer: jest.fn().mockResolvedValue([]),
    deleteTopic: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../src/services/IgnoreService", () => ({
  __esModule: true,
  default: {
    ignoreUpdates: jest.fn().mockReturnValue(false),
  },
}));

import { ContainerInspectInfo } from "dockerode";
import DockerService from "../src/services/DockerService";
import DatabaseService from "../src/services/DatabaseService";
import HomeassistantService from "../src/services/HomeassistantService";

describe("HomeassistantService discovery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("uses container names for Home Assistant identity when containers share an image", async () => {
    const containers = [
      {
        Id: "container-one",
        Name: "/esphome",
        Config: { Image: "ghcr.io/esphome/esphome:latest" },
      },
      {
        Id: "container-two",
        Name: "/esphomefelishas",
        Config: { Image: "ghcr.io/esphome/esphome:latest" },
      },
    ] as unknown as ContainerInspectInfo[];

    (DockerService.listContainers as jest.Mock).mockResolvedValue(containers);

    const client = { publish: jest.fn() };
    await HomeassistantService.publishConfigMessages(client);

    const messages = client.publish.mock.calls.map(([topic, payload]) => ({
      topic,
      payload: JSON.parse(payload),
    }));

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          topic: "homeassistant/sensor/server_esphome/docker_id/config",
          payload: expect.objectContaining({
            unique_id: "server_esphome Container ID",
            state_topic: "mqdockerup/server_esphome",
            device: expect.objectContaining({
              identifiers: ["server_esphome"],
            }),
          }),
        }),
        expect.objectContaining({
          topic: "homeassistant/sensor/server_esphomefelishas/docker_id/config",
          payload: expect.objectContaining({
            unique_id: "server_esphomefelishas Container ID",
            state_topic: "mqdockerup/server_esphomefelishas",
            device: expect.objectContaining({
              identifiers: ["server_esphomefelishas"],
            }),
          }),
        }),
        expect.objectContaining({
          topic: "homeassistant/button/server_esphome/docker_manual_restart/config",
          payload: expect.objectContaining({
            command_topic: "mqdockerup/server_esphome/command/restart",
            command_template: JSON.stringify({ containerId: "container-one", topicName: "server_esphome" }),
            payload_press: "restart",
            unique_id: "server_esphome_manual_restart",
            device: expect.objectContaining({
              identifiers: ["server_esphome"],
            }),
          }),
        }),
        expect.objectContaining({
          topic: "homeassistant/button/server_esphomefelishas/docker_manual_restart/config",
          payload: expect.objectContaining({
            command_topic: "mqdockerup/server_esphomefelishas/command/restart",
            command_template: JSON.stringify({ containerId: "container-two", topicName: "server_esphomefelishas" }),
            payload_press: "restart",
            unique_id: "server_esphomefelishas_manual_restart",
            device: expect.objectContaining({
              identifiers: ["server_esphomefelishas"],
            }),
          }),
        }),
        expect.objectContaining({
          topic: "homeassistant/update/server_esphome/docker_update/config",
          payload: expect.objectContaining({
            command_topic: "mqdockerup/server_esphome/command/update",
            payload_available: "online",
            payload_not_available: "offline",
            payload_install: JSON.stringify({ containerId: "container-one", image: "ghcr.io/esphome/esphome", topicName: "server_esphome" }),
          }),
        }),
        expect.objectContaining({
          topic: "homeassistant/update/server_esphomefelishas/docker_update/config",
          payload: expect.objectContaining({
            command_topic: "mqdockerup/server_esphomefelishas/command/update",
            payload_available: "online",
            payload_not_available: "offline",
            payload_install: JSON.stringify({ containerId: "container-two", image: "ghcr.io/esphome/esphome", topicName: "server_esphomefelishas" }),
          }),
        }),
      ])
    );
  });

  test("parses image references with registry ports", async () => {
    const containers = [
      {
        Id: "container-one",
        Name: "/registry-app",
        Config: { Image: "registry.local:5000/team/app:1.2.3" },
      },
    ] as unknown as ContainerInspectInfo[];

    (DockerService.listContainers as jest.Mock).mockResolvedValue(containers);

    const client = { publish: jest.fn() };
    await HomeassistantService.publishConfigMessages(client);

    const messages = client.publish.mock.calls.map(([topic, payload]) => ({
      topic,
      payload: JSON.parse(payload),
    }));

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          topic: "homeassistant/update/server_registry_app/docker_update/config",
          payload: expect.objectContaining({
            command_topic: "mqdockerup/server_registry_app/command/update",
            payload_install: JSON.stringify({ containerId: "container-one", image: "registry.local:5000/team/app", topicName: "server_registry_app" }),
            device: expect.objectContaining({
              model: "registry.local:5000/team/app:1.2.3",
            }),
          }),
        }),
      ])
    );
  });

  test("preserves digest image references in Home Assistant device metadata", async () => {
    const containers = [
      {
        Id: "container-one",
        Name: "/digest-app",
        Config: { Image: "ghcr.io/example/app@sha256:abcdef123456" },
      },
    ] as unknown as ContainerInspectInfo[];

    (DockerService.listContainers as jest.Mock).mockResolvedValue(containers);

    const client = { publish: jest.fn() };
    await HomeassistantService.publishConfigMessages(client);

    const messages = client.publish.mock.calls.map(([topic, payload]) => ({
      topic,
      payload: JSON.parse(payload),
    }));

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          topic: "homeassistant/sensor/server_digest_app/docker_id/config",
          payload: expect.objectContaining({
            device: expect.objectContaining({
              model: "ghcr.io/example/app@sha256:abcdef123456",
            }),
          }),
        }),
        expect.objectContaining({
          topic: "homeassistant/update/server_digest_app/docker_update/config",
          payload: expect.objectContaining({
            payload_install: JSON.stringify({ containerId: "container-one", image: "ghcr.io/example/app", topicName: "server_digest_app" }),
            device: expect.objectContaining({
              model: "ghcr.io/example/app@sha256:abcdef123456",
            }),
          }),
        }),
      ])
    );
  });

  test("falls back safely when Docker image references are missing", async () => {
    const containers = [
      {
        Id: "container-one",
        Name: "/missing-image",
        Config: {},
      },
    ] as unknown as ContainerInspectInfo[];

    (DockerService.listContainers as jest.Mock).mockResolvedValue(containers);

    const client = { publish: jest.fn() };
    await HomeassistantService.publishConfigMessages(client);

    const messages = client.publish.mock.calls.map(([topic, payload]) => ({
      topic,
      payload: JSON.parse(payload),
    }));

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          topic: "homeassistant/sensor/server_missing_image/docker_image/config",
          payload: expect.objectContaining({
            device: expect.objectContaining({
              model: "unknown",
            }),
          }),
        }),
      ])
    );
  });

  test("uses digest image references when publishing update state", async () => {
    const container = {
      Id: "container-one",
      Name: "/digest-app",
      Config: { Image: "ghcr.io/example/app@sha256:abcdef123456" },
    } as unknown as ContainerInspectInfo;

    (DockerService.getImageInfo as jest.Mock).mockResolvedValue({ RepoDigests: [] });
    (DockerService.getSourceRepo as jest.Mock).mockResolvedValue(null);

    const client = { publish: jest.fn() };
    await HomeassistantService.publishImageUpdateMessage(container, client);

    expect(DockerService.getImageInfo).toHaveBeenCalledWith("ghcr.io/example/app@sha256:abcdef123456");
    expect(DockerService.getImageNewDigest).not.toHaveBeenCalled();
    expect(client.publish).toHaveBeenCalledWith(
      "mqdockerup/server_digest_app/update",
      expect.stringContaining('"installed_version":"latest: abcdef123456"'),
      { retain: true }
    );
  });

  test("records discovery topics for containers that already exist", async () => {
    const containers = [
      {
        Id: "existing-container",
        Name: "/esphome",
        Config: { Image: "ghcr.io/esphome/esphome:latest" },
      },
    ] as unknown as ContainerInspectInfo[];

    (DockerService.listContainers as jest.Mock).mockResolvedValue(containers);
    (DatabaseService.containerExists as jest.Mock).mockResolvedValue(true);

    const client = { publish: jest.fn() };
    await HomeassistantService.publishConfigMessages(client);

    expect(DatabaseService.addContainer).not.toHaveBeenCalled();
    expect(DatabaseService.addTopic).toHaveBeenCalledWith(
      "homeassistant/sensor/server_esphome/docker_id/config",
      "existing-container"
    );
  });

  test("clears stale discovery topics for existing containers after publishing current topics", async () => {
    const containers = [
      {
        Id: "existing-container",
        Name: "/esphome",
        Config: { Image: "ghcr.io/esphome/esphome:latest" },
      },
    ] as unknown as ContainerInspectInfo[];

    (DockerService.listContainers as jest.Mock).mockResolvedValue(containers);
    (DatabaseService.containerExists as jest.Mock).mockResolvedValue(true);
    (DatabaseService.getTopicsForContainer as jest.Mock).mockResolvedValue([
      { topic: "homeassistant/sensor/server_esphome/docker_id/config" },
      { topic: "homeassistant/sensor/server_ghcr_io_esphome_esphome_latest/docker_id/config" },
    ]);

    const client = { publish: jest.fn() };
    await HomeassistantService.publishConfigMessages(client);

    expect(client.publish).toHaveBeenCalledWith(
      "homeassistant/sensor/server_ghcr_io_esphome_esphome_latest/docker_id/config",
      "",
      { retain: true }
    );
    expect(DatabaseService.deleteTopic).toHaveBeenCalledWith(
      "homeassistant/sensor/server_ghcr_io_esphome_esphome_latest/docker_id/config",
      "existing-container"
    );
  });

  test("does not clear current update discovery topics during stale topic cleanup", async () => {
    const containers = [
      {
        Id: "existing-container",
        Name: "/esphome",
        Config: { Image: "ghcr.io/esphome/esphome:latest" },
      },
    ] as unknown as ContainerInspectInfo[];

    (DockerService.listContainers as jest.Mock).mockResolvedValue(containers);
    (DatabaseService.containerExists as jest.Mock).mockResolvedValue(true);
    (DatabaseService.getTopicsForContainer as jest.Mock).mockResolvedValue([
      { topic: "homeassistant/button/server_esphome/docker_manual_update/config" },
      { topic: "homeassistant/update/server_esphome/docker_update/config" },
    ]);

    const client = { publish: jest.fn() };
    await HomeassistantService.publishConfigMessages(client);

    expect(DatabaseService.deleteTopic).not.toHaveBeenCalled();
  });
});
