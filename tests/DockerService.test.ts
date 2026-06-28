jest.mock("../src/index", () => ({
  mqttClient: {
    publish: jest.fn(),
    on: jest.fn(),
    end: jest.fn(),
  },
}));

jest.mock("../src/registry-factory/ImageRegistryAdapterFactory");

import { ImageRegistryAdapterFactory } from "../src/registry-factory/ImageRegistryAdapterFactory";
import DockerService from "../src/services/DockerService";

describe("DockerService.getImageVersionLabel", () => {
  it("returns the version label reported by the registry adapter", async () => {
    (ImageRegistryAdapterFactory.getAdapter as jest.Mock).mockReturnValue({
      getVersionLabel: jest.fn().mockResolvedValue("2.15.3"),
    });

    const result = await DockerService.getImageVersionLabel("penpot/backend", "latest");

    expect(result).toBe("2.15.3");
  });

  it("returns null when the adapter throws", async () => {
    (ImageRegistryAdapterFactory.getAdapter as jest.Mock).mockReturnValue({
      getVersionLabel: jest.fn().mockRejectedValue(new Error("network error")),
    });

    const result = await DockerService.getImageVersionLabel("penpot/backend", "latest");

    expect(result).toBeNull();
  });
});
