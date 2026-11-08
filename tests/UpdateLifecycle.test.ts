jest.mock("../src/index", () => ({ mqttClient: {} }));
jest.mock("../src/services/PullProgressService", () => ({ __esModule: true, default: { getLayerSizes: jest.fn() } }));
jest.mock("../src/services/DatabaseService", () => ({
  __esModule: true, default: { deleteContainer: jest.fn() },
}));
jest.mock("../src/services/LoggerService", () => ({
  __esModule: true, default: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../src/services/HomeassistantService", () => ({
  __esModule: true, default: {
    publishUpdateProgressMessage: jest.fn(), publishAbortUpdateMessage: jest.fn(),
    publishContainer: jest.fn(), publishImageUpdateMessage: jest.fn(),
  },
}));
import DockerService from "../src/services/DockerService";
import HomeassistantService from "../src/services/HomeassistantService";
import PullProgressService from "../src/services/PullProgressService";
import SelfUpdateService from "../src/services/SelfUpdateService";

describe("DockerService update progress lifecycle", () => {
  const info = { Id: "old", Name: "/example", Image: "image-id", Config: { Image: "example:latest" }, HostConfig: {}, State: { Running: true } };
  let old: any;
  let replacement: any;
  let finish: (error: Error | null) => void;
  let progress: (event: any) => void;
  let pull: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    DockerService.updatingContainers = [];
    DockerService.selfUpdateContainerId = undefined;
    (PullProgressService.getLayerSizes as jest.Mock).mockResolvedValue({ layer: 100 });
    old = { inspect: jest.fn().mockResolvedValue(info), stop: jest.fn(), rename: jest.fn(), remove: jest.fn(), start: jest.fn() };
    replacement = { id: "new", start: jest.fn(), remove: jest.fn(), inspect: jest.fn().mockResolvedValue({ ...info, Id: "new" }) };
    pull = jest.fn((image, callback) => callback(null, {}));
    DockerService.docker = {
      info: jest.fn().mockResolvedValue({ OSType: "linux", Architecture: "amd64" }),
      getContainer: jest.fn().mockReturnValue(old), pull,
      createContainer: jest.fn().mockResolvedValue(replacement),
      getImage: jest.fn().mockReturnValue({ remove: jest.fn() }),
      modem: { followProgress: jest.fn((stream, callback, onProgress) => { finish = callback; progress = onProgress; }) },
    } as any;
  });

  async function begin() {
    const operation = DockerService.updateContainer("old");
    await new Promise(resolve => setImmediate(resolve));
    return { operation };
  }

  afterEach(() => { jest.restoreAllMocks(); });

  test("cached pull stays active, awaits replacement, and completes", async () => {
    const { operation } = await begin();
    expect(HomeassistantService.publishUpdateProgressMessage).toHaveBeenCalledWith(info, {}, null, true);
    let settled = false;
    operation.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish(null);
    await operation;
    expect(replacement.start).toHaveBeenCalledTimes(1);
    expect(HomeassistantService.publishUpdateProgressMessage).toHaveBeenCalledWith(info, {}, 100, true);
    expect(HomeassistantService.publishUpdateProgressMessage).toHaveBeenLastCalledWith(expect.objectContaining({ Id: "new" }), {}, 100, false);
    expect(DockerService.updatingContainers).toEqual([]);
  });

  test("publishes measured download progress", async () => {
    const { operation } = await begin();
    progress({ id: "layer", status: "Downloading", progressDetail: { current: 25, total: 100 } });
    expect(HomeassistantService.publishUpdateProgressMessage).toHaveBeenCalledWith(info, {}, 25, true);
    finish(null);
    await operation;
  });

  test("replays the captured Docker pull without resetting measured progress", async () => {
    const fixture = require("./fixtures/docker-pull-events.json");
    (PullProgressService.getLayerSizes as jest.Mock).mockResolvedValue(fixture.layerSizes);
    const { operation } = await begin();
    let now = 2000;
    jest.spyOn(Date, "now").mockImplementation(() => now += 2000);
    let pulls = 0;
    for (const event of fixture.events) {
      if (event.status.startsWith("Pulling from ") && ++pulls > 1) break;
      progress(event);
    }
    const calls = (HomeassistantService.publishUpdateProgressMessage as jest.Mock).mock.calls;
    const values = calls.filter(call => typeof call[2] === "number").map(call => call[2]);
    expect(values.length).toBeGreaterThan(2);
    expect(values[values.length - 1]).toBe(100);
    expect(values.every((value, index) => index === 0 || value >= values[index - 1])).toBe(true);
    expect(calls.filter(call => call[2] === null && call[3]).length).toBe(1);
    finish(null);
    await operation;
    expect(HomeassistantService.publishAbortUpdateMessage).not.toHaveBeenCalled();
  });

  test("duplicate commands do not start a second pull", async () => {
    const { operation } = await begin();
    await DockerService.updateContainer("old");
    expect(pull).toHaveBeenCalledTimes(1);
    finish(null);
    await operation;
  });
  test("self-update delegates to a helper without stopping its own process", async () => {
    jest.spyOn(SelfUpdateService, "isSelf").mockReturnValue(true);
    const start = jest.spyOn(SelfUpdateService, "start").mockResolvedValue();
    const { operation } = await begin();
    finish(null);
    await operation;
    expect(start).toHaveBeenCalledWith(DockerService.docker, info);
    expect(old.stop).not.toHaveBeenCalled();
    expect(DockerService.docker.createContainer).not.toHaveBeenCalled();
  });
  test("helper creation failure clears active progress without stopping this instance", async () => {
    jest.spyOn(SelfUpdateService, "isSelf").mockReturnValue(true);
    jest.spyOn(SelfUpdateService, "start").mockRejectedValue(new Error("helper failed"));
    const { operation } = await begin();
    finish(null);
    await operation;
    expect(old.stop).not.toHaveBeenCalled();
    expect(HomeassistantService.publishAbortUpdateMessage).toHaveBeenCalledWith(info, {});
    expect(DockerService.updatingContainers).toEqual([]);
    expect(DockerService.selfUpdateContainerId).toBeUndefined();
  });
  test("self-update refuses to interrupt an already active container update", async () => {
    jest.spyOn(SelfUpdateService, "isSelf").mockReturnValue(true);
    DockerService.updatingContainers = ["another"];
    await DockerService.updateContainer("old");
    expect(pull).not.toHaveBeenCalled();
    expect(old.stop).not.toHaveBeenCalled();
    expect(DockerService.updatingContainers).toEqual(["another"]);
    expect(DockerService.selfUpdateContainerId).toBeUndefined();
  });
  test("new updates cannot begin while the self-update handoff is pending", async () => {
    jest.spyOn(SelfUpdateService, "isSelf").mockReturnValue(true);
    jest.spyOn(SelfUpdateService, "start").mockResolvedValue();
    const { operation } = await begin();
    expect(DockerService.selfUpdateContainerId).toBe("old");
    await DockerService.updateContainer("another");
    expect(pull).toHaveBeenCalledTimes(1);
    finish(null);
    await operation;
    expect(DockerService.selfUpdateContainerId).toBeUndefined();
  });
  test("missing manifest metadata keeps the whole update active without a percentage", async () => {
    (PullProgressService.getLayerSizes as jest.Mock).mockResolvedValue(null);
    const { operation } = await begin();
    progress({ id: "layer", status: "Downloading", progressDetail: { current: 25, total: 100 } });
    expect((HomeassistantService.publishUpdateProgressMessage as jest.Mock).mock.calls.some(call => typeof call[2] === "number")).toBe(false);
    finish(null);
    await operation;
    expect(HomeassistantService.publishAbortUpdateMessage).not.toHaveBeenCalled();
    expect(DockerService.updatingContainers).toEqual([]);
  });
  test("late layers and extraction cannot move download progress backwards", async () => {
    (PullProgressService.getLayerSizes as jest.Mock).mockResolvedValue({ first: 100, second: 900 });
    const { operation } = await begin();
    let now = 2000;
    jest.spyOn(Date, "now").mockImplementation(() => now += 2000);
    progress({ id: "first", status: "Downloading", progressDetail: { current: 100, total: 100 } });
    progress({ id: "second", status: "Downloading", progressDetail: { current: 0, total: 900 } });
    progress({ id: "first", status: "Extracting", progressDetail: { current: 1, total: 2000 } });
    progress({ id: "config-blob", status: "Download complete", progressDetail: {} });
    progress({ id: "manifest-blob", status: "Downloading", progressDetail: { current: 100, total: 200 } });
    const percentages = (HomeassistantService.publishUpdateProgressMessage as jest.Mock).mock.calls
      .filter(call => typeof call[2] === "number").map(call => call[2]);
    expect(percentages).toEqual([10, 10]);
    expect(HomeassistantService.publishUpdateProgressMessage).not.toHaveBeenLastCalledWith(info, {}, null, true);
    finish(null);
    await operation;
  });

  test.each(["pull", "stream", "stop", "rename", "create", "start", "inspect"])("clears progress and locks after %s failure", async failure => {
    if (failure === "pull") pull.mockImplementation((image, callback) => callback(new Error("pull failed")));
    if (failure === "start") replacement.start.mockRejectedValue(new Error("start failed"));
    if (failure === "stop") old.stop.mockRejectedValue(new Error("stop failed"));
    if (failure === "rename") old.rename.mockRejectedValue(new Error("rename failed"));
    if (failure === "create") (DockerService.docker.createContainer as jest.Mock).mockRejectedValue(new Error("create failed"));
    if (failure === "inspect") replacement.inspect.mockRejectedValue(new Error("inspect failed"));
    const { operation } = await begin();
    if (failure !== "pull") finish(failure === "stream" ? new Error("stream failed") : null);
    await operation;
    expect(HomeassistantService.publishAbortUpdateMessage).toHaveBeenCalledWith(info, {});
    expect(DockerService.updatingContainers).toEqual([]);
    if (failure === "start") expect(old.start).toHaveBeenCalledTimes(1);
  });
});
