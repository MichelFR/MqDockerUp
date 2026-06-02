process.env.MAIN_PREFIX = "server";
process.env.MQTT_HALEGACY = "true";

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
    getImageInfo: jest.fn(),
    getImageNewDigest: jest.fn(),
    getSourceRepo: jest.fn(),
  },
}));

import { ContainerInspectInfo } from "dockerode";
import DockerService from "../src/services/DockerService";
import HomeassistantService from "../src/services/HomeassistantService";

describe("HomeassistantService legacy update payload", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("keeps the legacy nested update state while using container topics", async () => {
    const container = {
      Id: "container-one",
      Name: "/esphome",
      Config: { Image: "ghcr.io/esphome/esphome:latest" },
    } as unknown as ContainerInspectInfo;

    (DockerService.getImageInfo as jest.Mock).mockResolvedValue({
      RepoDigests: ["ghcr.io/esphome/esphome@sha256:123456789abcdef"],
    });
    (DockerService.getImageNewDigest as jest.Mock).mockResolvedValue("abcdef123456789");
    (DockerService.getSourceRepo as jest.Mock).mockResolvedValue("https://github.com/esphome/esphome");

    const client = { publish: jest.fn() };
    await HomeassistantService.publishImageUpdateMessage(container, client, 40, 15, "installing");

    const [topic, payload] = client.publish.mock.calls[0];
    const parsedPayload = JSON.parse(payload);

    expect(topic).toBe("mqdockerup/server_esphome/update");
    expect(parsedPayload).toEqual(expect.objectContaining({
      installed_version: "latest: 123456789abc",
      latest_version: "latest: abcdef123456",
      title: "ghcr.io/esphome/esphome:latest",
      progress: 40,
      update: expect.objectContaining({
        state: "installing",
        installed_version: "latest: 123456789abc",
        latest_version: "latest: abcdef123456",
        progress: 40,
        remaining: 15,
      }),
    }));
    expect(parsedPayload.update.last_check).toEqual(expect.any(String));
  });
});
