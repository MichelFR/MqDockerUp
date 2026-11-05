jest.mock("../src/services/ConfigService", () => ({
  __esModule: true, default: { getConfig: () => ({ mqtt: { topic: "test" } }) },
}));
jest.mock("../src/services/DockerService", () => ({ __esModule: true, default: {
  updatingContainers: [], getImageInfo: jest.fn(), getImageNewDigest: jest.fn(), getSourceRepo: jest.fn(),
} }));
jest.mock("../src/services/DatabaseService", () => ({ __esModule: true, default: {} }));
jest.mock("../src/services/LoggerService", () => ({ __esModule: true, default: {
  info: jest.fn(), debug: jest.fn(), warn: jest.fn(),
} }));
import HomeassistantService from "../src/services/HomeassistantService";
import DockerService from "../src/services/DockerService";

describe("update progress payload", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    DockerService.updatingContainers = [];
  });
  test("background checks do not reset an active update", async () => {
    DockerService.updatingContainers = ["active"];
    const publish = jest.spyOn(HomeassistantService, "publishMessage").mockImplementation(async () => {});
    await HomeassistantService.publishImageUpdateMessage({ Id: "active" }, {});
    expect(publish).not.toHaveBeenCalled();
  });
  test("an already-running background check cannot reset progress", async () => {
    let release: (value: string) => void = () => {};
    (DockerService.getImageInfo as jest.Mock).mockResolvedValue({ RepoDigests: ["example@sha256:abc"] });
    (DockerService.getImageNewDigest as jest.Mock).mockResolvedValue("abc");
    (DockerService.getSourceRepo as jest.Mock).mockImplementation(() => new Promise<string>(resolve => { release = resolve; }));
    const publish = jest.spyOn(HomeassistantService, "publishMessage").mockImplementation(async () => {});
    const check = HomeassistantService.publishImageUpdateMessage({ Id: "active", Name: "/example", Config: { Image: "example:latest" } }, {});
    await new Promise(resolve => setImmediate(resolve));
    DockerService.updatingContainers = ["active"];
    release("https://github.com/example/example");
    await check;
    expect(publish).not.toHaveBeenCalled();
  });
  test("clears progress on completion and abort", async () => {
    const publish = jest.spyOn(HomeassistantService, "publishMessage").mockImplementation(async () => {});
    await HomeassistantService.publishUpdateProgressMessage({ Name: "/example" }, {}, 100, false);
    expect(publish).toHaveBeenLastCalledWith(expect.anything(), expect.any(String), {
      update_percentage: null, in_progress: false,
    }, { retain: false });
    await HomeassistantService.publishAbortUpdateMessage({ Name: "/example" }, {});
    expect(publish).toHaveBeenLastCalledWith(expect.anything(), expect.any(String), {
      update_percentage: null, in_progress: false,
    }, { retain: false });
    publish.mockRestore();
  });
  test.each([0, 25, 100, null])("preserves active progress %s", async percentage => {
    const publish = jest.spyOn(HomeassistantService, "publishMessage").mockImplementation(async () => {});
    await HomeassistantService.publishUpdateProgressMessage({ Name: "/example" }, {}, percentage, true);
    expect(publish).toHaveBeenLastCalledWith(expect.anything(), expect.any(String), {
      update_percentage: percentage, in_progress: true,
    }, { retain: false });
    publish.mockRestore();
  });
});
