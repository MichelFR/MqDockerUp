jest.unmock("axios");
jest.mock("../src/index", () => ({ mqttClient: {} }));
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
import { execFileSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import DockerService from "../src/services/DockerService";
import HomeassistantService from "../src/services/HomeassistantService";
import PullProgressService from "../src/services/PullProgressService";

// Explicit opt-in: this suite owns only its named containers and image tag.
const describeDocker = process.env.MQDOCKERUP_DOCKER_TEST === "1" ? describe : describe.skip;
describeDocker("update lifecycle with a real Docker daemon", () => {
  const image = "httpd:2.4-alpine";
  const name = "codex-progress-integration-test";
  const docker = DockerService.docker;
  let ownsImage = false;
  let current: any;
  const events: any[] = [];
  let layerSizes: Record<string, number> | null = null;

  beforeAll(async () => {
    const existing = await docker.listContainers({ all: true });
    if (existing.some(container => container.Names.some(value => value.includes(name)))) throw new Error("Test container name already exists");
    try {
      await docker.getImage(image).inspect();
      throw new Error("Test image tag already exists; refusing to modify it");
    } catch (error: any) {
      if (error.statusCode !== 404) throw error;
    }
    execFileSync("docker", ["build", "-t", image, "-"], {
      input: 'FROM scratch\nCMD ["sleep", "600"]\n', stdio: ["pipe", "pipe", "pipe"],
    });
    ownsImage = true;
    const platform = await docker.info();
    layerSizes = await PullProgressService.getLayerSizes(image, platform.OSType, platform.Architecture);
    expect(layerSizes).not.toBeNull();
    const follow = docker.modem.followProgress.bind(docker.modem);
    jest.spyOn(docker.modem, "followProgress").mockImplementation((stream: any, done: any, progress: any) => {
      return follow(stream, done, (event: any) => {
        events.push(JSON.parse(JSON.stringify(event)));
        progress?.(event);
      });
    });
  }, 30000);

  async function create(command = ["sleep", "600"]) {
    current = await docker.createContainer({
      name, Image: image, Cmd: command,
      Labels: { "mqdockerup.ignore_container": "true", "mqdockerup.ignore_updates": "true" },
      HostConfig: { NetworkMode: "none" },
    });
    return current;
  }

  afterEach(async () => {
    if (!ownsImage) return;
    for (const container of await docker.listContainers({ all: true })) {
      if (container.Names.some(value => value === `/${name}` || value === `/${name}_mqdockerup_old`)) {
        await docker.getContainer(container.Id).remove({ force: true });
      }
    }
  }, 30000);

  afterAll(async () => {
    jest.restoreAllMocks();
    if (!ownsImage) return;
    for (const container of await docker.listContainers({ all: true })) {
      if (container.Names.some(value => value === `/${name}` || value === `/${name}_mqdockerup_old`)) {
        await docker.getContainer(container.Id).remove({ force: true });
      }
    }
    await docker.getImage(image).remove().catch(() => {});
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/docker-pull-events.json", JSON.stringify({ layerSizes, events }, null, 2));
  }, 30000);

  test("fresh download and cached update finish with no lost progress", async () => {
    const old = await create();
    await DockerService.updateContainer(old.id);
    const replacement = await docker.getContainer(name).inspect();
    expect(replacement.Id).not.toBe(old.id);
    expect(replacement.State.Running).toBe(true);
    expect(HomeassistantService.publishAbortUpdateMessage).not.toHaveBeenCalled();
    const calls = (HomeassistantService.publishUpdateProgressMessage as jest.Mock).mock.calls;
    const percentages = calls.filter(call => typeof call[2] === "number" && call[3]).map(call => call[2]);
    expect(percentages.length).toBeGreaterThan(0);
    expect(percentages.every((value, index) => index === 0 || value >= percentages[index - 1])).toBe(true);
    expect(calls.filter(call => call[2] === null && call[3]).length).toBe(1);
    expect(DockerService.updatingContainers).toEqual([]);
    writeFileSync("/tmp/mqdockerup-real-progress.json", JSON.stringify(calls.map(call => ({ percentage: call[2], active: call[3] })), null, 2));
    jest.clearAllMocks();
    await DockerService.updateContainer(replacement.Id);
    expect((await docker.getContainer(name).inspect()).Id).not.toBe(replacement.Id);
    expect(HomeassistantService.publishAbortUpdateMessage).not.toHaveBeenCalled();
    expect(HomeassistantService.publishUpdateProgressMessage).toHaveBeenLastCalledWith(expect.anything(), {}, 100, false);
    expect(DockerService.updatingContainers).toEqual([]);
    await docker.getContainer(name).remove({ force: true });
  }, 120000);

  test("a real failed start restores the previous container and clears progress", async () => {
    jest.clearAllMocks();
    const old = await create(["/codex-nonexistent-executable"]);
    await DockerService.updateContainer(old.id);
    expect((await docker.getContainer(name).inspect()).Id).toBe(old.id);
    expect(HomeassistantService.publishAbortUpdateMessage).toHaveBeenCalledTimes(1);
    expect(DockerService.updatingContainers).toEqual([]);
  }, 60000);
});
