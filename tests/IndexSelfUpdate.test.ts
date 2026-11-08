import {EventEmitter} from "events";

describe("self-update discovery handoff on MQTT reconnect", () => {
  const original = process.env.MQDOCKERUP_PREDECESSOR_ID;
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    if (original === undefined) delete process.env.MQDOCKERUP_PREDECESSOR_ID;
    else process.env.MQDOCKERUP_PREDECESSOR_ID = original;
  });

  test.each(["a".repeat(64), "invalid", ""])("handles predecessor %s without deleting retained discovery", async id => {
    process.env.MQDOCKERUP_PREDECESSOR_ID = id;
    jest.useFakeTimers();
    const handlers: Record<string, (...args: any[]) => any> = {};
    const signals: Record<string, (...args: any[]) => any> = {};
    const client = {connected: true, on: jest.fn((event, callback) => { handlers[event] = callback; }),
      subscribe: jest.fn((topics, callback) => callback(id === "" ? new Error("denied") : null, [{qos: id === "invalid" ? 128 : 0}])),
      end: jest.fn((force, options, callback) => callback())};
    const database = {deleteContainer: jest.fn().mockResolvedValue(undefined)};
    const self = {predecessorVariable: "MQDOCKERUP_PREDECESSOR_ID", handoffContainerId: id, getContainerId: () => "b".repeat(64), markReady: jest.fn(), clearReady: jest.fn()};
    const events = new EventEmitter();
    const homeassistant = {resetPublishCache: jest.fn(), publishAvailability: jest.fn(), removeContainer: jest.fn(), publishAbortUpdateMessage: jest.fn(), publishUpdateProgressMessage: jest.fn()};
    const replacement = {Id: "b".repeat(64), Name: "/mqdockerup"};
    const config = {mqtt: {topic: "test", connectionUri: "mqtt://test"}, main: {containerCheckOnChanges: true}, logs: {level: "info"}, ignore: {containers: "*", updates: "*"}};
    jest.spyOn(process, "on").mockImplementation((event: any, callback: any) => {signals[event] = callback; return process;});
    jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
    jest.isolateModules(() => {
      jest.doMock("mqtt", () => ({connect: () => client}));
      jest.doMock("../src/services/ConfigService", () => ({__esModule: true, default: {getConfig: () => config, autoParseEnvVariable: (value: any) => value}}));
      jest.doMock("../src/services/LoggerService", () => ({__esModule: true, default: {info: jest.fn(), warn: jest.fn(), verbose: jest.fn(), error: jest.fn()}}));
      jest.doMock("../src/services/DatabaseService", () => ({__esModule: true, default: database}));
      jest.doMock("../src/services/HomeassistantService", () => ({__esModule: true, default: homeassistant}));
      jest.doMock("../src/services/DockerService", () => ({__esModule: true, default: {events, listenToDockerEvents: jest.fn(), updatingContainers: [id, "other"],
        docker: {getContainer: jest.fn().mockReturnValue({inspect: jest.fn().mockResolvedValue(replacement)})}}}));
      jest.doMock("../src/services/SelfUpdateService", () => ({__esModule: true, default: self}));
      jest.doMock("../src/services/MigrationService", () => ({__esModule: true, default: {runStartupMigrations: jest.fn()}}));
      require("../src/index");
    });
    events.emit("destroy", {containerId: id, containerName: "old"});
    await jest.advanceTimersByTimeAsync(2000);
    await handlers.connect();
    expect(database.deleteContainer).toHaveBeenCalledTimes(id.length === 64 ? 1 : 0);
    if (id.length === 64) expect(database.deleteContainer).toHaveBeenCalledWith(id);
    expect(homeassistant.removeContainer).not.toHaveBeenCalled();
    expect(client.subscribe).toHaveBeenCalled();
    expect(self.markReady).toHaveBeenCalledTimes(id.length === 64 ? 1 : 0);
    expect(homeassistant.publishUpdateProgressMessage).toHaveBeenCalledTimes(id.length === 64 ? 1 : 0);
    if (id.length === 64) expect(homeassistant.publishUpdateProgressMessage).toHaveBeenCalledWith(replacement, client, 100, false);
    handlers.close();
    expect(self.clearReady).toHaveBeenCalledTimes(1);
    await signals.SIGTERM();
    expect(homeassistant.publishAbortUpdateMessage).toHaveBeenCalledTimes(1);
    expect(homeassistant.publishAbortUpdateMessage).toHaveBeenCalledWith("other", client);
  });
});
