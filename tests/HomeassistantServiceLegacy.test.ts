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
    getImageVersionLabel: jest.fn(),
    getSourceRepo: jest.fn(),
    splitImageReference: jest.fn((reference: string | null | undefined) => {
      if (!reference) {
        return { image: "unknown", tag: "latest" };
      }

      const digestIndex = reference.indexOf("@");
      const imageReference = digestIndex === -1 ? reference : reference.substring(0, digestIndex);
      const digest = digestIndex === -1 ? undefined : reference.substring(digestIndex + 1);
      const lastSlashIndex = imageReference.lastIndexOf("/");
      const lastColonIndex = imageReference.lastIndexOf(":");

      if (lastColonIndex > lastSlashIndex) {
        return {
          image: imageReference.substring(0, lastColonIndex),
          tag: imageReference.substring(lastColonIndex + 1) || "latest",
          ...(digest ? { digest } : {}),
        };
      }

      return {
        image: imageReference,
        tag: "latest",
        ...(digest ? { digest } : {}),
      };
    }),
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
    (DockerService.getImageVersionLabel as jest.Mock).mockResolvedValue(null);
    (DockerService.getSourceRepo as jest.Mock).mockResolvedValue("https://github.com/esphome/esphome");

    const client = { publish: jest.fn() };
    await HomeassistantService.publishImageUpdateMessage(container, client, 40, 15, "installing");

    const [topic, payload] = client.publish.mock.calls[0];
    const parsedPayload = JSON.parse(payload);

    expect(topic).toBe("mqdockerup/server_esphome/update");
    expect(parsedPayload).toEqual(expect.objectContaining({
      installed_version: "latest: 123456789abc",
      latest_version: "latest: abcdef123456",
      title: "esphome",
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
