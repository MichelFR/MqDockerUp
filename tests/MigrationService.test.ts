const mockDb = {
  getMeta: jest.fn(),
  getAllTopics: jest.fn(),
  getContainers: jest.fn(),
  deleteContainer: jest.fn(),
  setMeta: jest.fn(),
};

jest.mock("../src/services/DatabaseService", () => ({
  __esModule: true,
  default: mockDb,
}));

import MigrationService from "../src/services/MigrationService";

const FLAG = "legacyContainerTopicCleanup";

function makeClient() {
  return { publish: jest.fn() };
}

describe("MigrationService legacy topic cleanup", () => {
  beforeEach(() => jest.clearAllMocks());

  it("clears stored topics, wipes containers and sets the flag on first run", () => {
    mockDb.getMeta.mockReturnValue(undefined);
    mockDb.getAllTopics.mockReturnValue([
      { topic: "homeassistant/sensor/nginx_latest/docker_id/config", containerId: "c1" },
      { topic: "homeassistant/button/nginx_latest/docker_manual_restart/config", containerId: "c1" },
    ]);
    mockDb.getContainers.mockImplementation((cb: Function) => cb(null, [{ id: "c1" }]));
    const client = makeClient();

    MigrationService.runStartupMigrations(client);

    // Empty + retained payload to each stored topic (removes the HA entity).
    expect(client.publish).toHaveBeenCalledTimes(2);
    expect(client.publish).toHaveBeenCalledWith(
      "homeassistant/sensor/nginx_latest/docker_id/config",
      "",
      { retain: true, qos: 0 }
    );
    expect(mockDb.deleteContainer).toHaveBeenCalledWith("c1");
    expect(mockDb.setMeta).toHaveBeenCalledWith(FLAG, "done");
  });

  it("does nothing when the migration already ran", () => {
    mockDb.getMeta.mockReturnValue("done");
    const client = makeClient();

    MigrationService.runStartupMigrations(client);

    expect(client.publish).not.toHaveBeenCalled();
    expect(mockDb.getAllTopics).not.toHaveBeenCalled();
    expect(mockDb.setMeta).not.toHaveBeenCalled();
  });

  it("marks done without publishing on a fresh install with no stored topics", () => {
    mockDb.getMeta.mockReturnValue(undefined);
    mockDb.getAllTopics.mockReturnValue([]);
    mockDb.getContainers.mockImplementation((cb: Function) => cb(null, []));
    const client = makeClient();

    MigrationService.runStartupMigrations(client);

    expect(client.publish).not.toHaveBeenCalled();
    expect(mockDb.setMeta).toHaveBeenCalledWith(FLAG, "done");
  });
});
