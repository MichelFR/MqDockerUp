import Docker from "dockerode";
import {execFileSync} from "child_process";
import {mkdirSync, writeFileSync} from "fs";

// A prebuilt checkout image and explicit opt-in keep normal test runs read-only.
const describeDocker = process.env.MQDOCKERUP_SELF_UPDATE_DOCKER_TEST === "1" ? describe : describe.skip;
describeDocker("self-update with a real Docker daemon", () => {
  const docker = new Docker({timeout: 45000});
  const prefix = "codex-mqdockerup-self-update-test";
  const base = process.env.MQDOCKERUP_SELF_UPDATE_TEST_IMAGE;
  const oldTag = `${prefix}:old`;
  const newTag = `${prefix}:new`;
  const label = "mqdockerup.self_update_test";
  let ownsResources = false;
  let primary: Docker.Network;
  let secondary: Docker.Network;
  let staticAddress: string;
  const evidence: any[] = [];
  const targetIds = new Set<string>();
  const volumes = new Set<string>();

  const command = `
    const Docker = require('/app/node_modules/dockerode');
    const fs = require('fs');
    const Service = require('/app/src/services/SelfUpdateService').default;
    const docker = new Docker();
    process.on('SIGTERM', () => process.exit(0));
    (async () => {
      const id = Service.getContainerId();
      if (!id) throw new Error('Could not identify self');
      console.info('SELF_ID:' + id);
      if (process.env.MQDOCKERUP_PREDECESSOR_ID) {
        if (process.env.FAIL_REPLACEMENT === 'true') process.exit(23);
        if (fs.readFileSync('/state/sentinel', 'utf8') !== 'persistent') throw new Error('Lost anonymous volume');
        if (process.env.SKIP_READY !== 'true') Service.markReady();
        setInterval(() => {}, 1000);
        return;
      }
      fs.writeFileSync('/state/sentinel', 'persistent');
      while (!fs.existsSync('/tmp/start-self-update')) await new Promise(resolve => setTimeout(resolve, 100));
      fs.unlinkSync('/tmp/start-self-update');
      await Service.start(docker, await docker.getContainer(id).inspect());
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;

  async function until(check: () => Promise<boolean>, timeout = 60000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error("Timed out waiting for self-update");
  }

  beforeAll(async () => {
    if (!base || !/^[a-zA-Z0-9_./:@-]+$/.test(base)) throw new Error("Set MQDOCKERUP_SELF_UPDATE_TEST_IMAGE to a checkout image");
    if ((await docker.listContainers({all: true})).some(container => container.Names.some(name => name.includes(prefix)))) {
      throw new Error("Test container name already exists");
    }
    if ((await docker.listNetworks()).some(network => network.Name.startsWith(prefix))) throw new Error("Test networks already exist");
    for (const tag of [oldTag, newTag]) {
      await docker.getImage(tag).inspect().then(() => { throw new Error("Test image already exists"); }, error => { if (error.statusCode !== 404) throw error; });
    }
    ownsResources = true;
    for (const [tag, marker] of [[oldTag, "old"], [newTag, "new"]]) {
      execFileSync("docker", ["build", "-t", tag, "-"], {
        input: `FROM ${base}\nLABEL ${label}=${marker}\n`, stdio: ["pipe", "pipe", "pipe"],
      });
    }
    primary = await docker.createNetwork({Name: `${prefix}-primary`});
    secondary = await docker.createNetwork({Name: `${prefix}-secondary`});
    const subnet = (await primary.inspect()).IPAM?.Config?.[0]?.Subnet?.split("/")[0];
    if (!subnet) throw new Error("Test network has no subnet");
    staticAddress = `${subnet.split(".").slice(0, 3).join(".")}.100`;
  }, 60000);

  async function create(fail = false, skipReady = false) {
    const donor = await docker.createContainer({
      name: `${prefix}-donor`, Image: oldTag, Volumes: {"/inherited": {}},
      Labels: {[label]: "true", "mqdockerup.ignore_container": "true"}, HostConfig: {NetworkMode: "none"},
    });
    for (const mount of (await donor.inspect()).Mounts) if (mount.Type === "volume" && mount.Name) volumes.add(mount.Name);
    const old = await docker.createContainer({
      name: prefix, Image: oldTag, Hostname: "custom-updater-hostname", WorkingDir: "/tmp",
      Entrypoint: ["node"], Cmd: ["/app/node_modules/ts-node/dist/bin.js", "-P", "/app/tsconfig.json", "-e", command],
      Env: [`FAIL_REPLACEMENT=${fail}`, `SKIP_READY=${skipReady}`], Volumes: {"/state": {}, "/app/data": {}},
      Labels: {[label]: "true", "mqdockerup.ignore_container": "true", "mqdockerup.ignore_updates": "true"},
      ExposedPorts: {"12345/tcp": {}},
      HostConfig: {Binds: ["/var/run/docker.sock:/var/run/docker.sock", "/destination-only"], NetworkMode: `${prefix}-primary`, RestartPolicy: {Name: "no"},
        VolumesFrom: [`${donor.id}:ro`], Mounts: [{Type: "volume", Source: "", Target: "/extra", VolumeOptions: {NoCopy: true, Labels: {}, DriverConfig: {Name: "local", Options: {}}}}],
        PortBindings: {"12345/tcp": [{HostIp: "127.0.0.1", HostPort: ""}]}},
      NetworkingConfig: {EndpointsConfig: {[`${prefix}-primary`]: {IPAMConfig: {IPv4Address: staticAddress}, Aliases: ["self-update-alias"]}}},
    });
    targetIds.add(old.id);
    const initial = await old.inspect();
    const knownVolumes = (await docker.listVolumes()).Volumes || [];
    for (const mount of initial.Mounts) {
      if (mount.Type !== "volume") continue;
      const name = mount.Name || knownVolumes.find(volume => volume.Mountpoint === mount.Source)?.Name;
      if (name) volumes.add(name);
    }
    await secondary.connect({Container: old.id, EndpointConfig: {Aliases: ["secondary-alias"]}});
    await old.start();
    await until(async () => (await old.logs({stdout: true, stderr: true})).toString().includes(`SELF_ID:${old.id}`));
    const newImage = await docker.getImage(newTag).inspect();
    await docker.getImage(newTag).tag({repo: prefix, tag: "old"});
    return {old, info: await old.inspect(), newImage};
  }

  async function trigger(old: Docker.Container) {
    const exec = await old.exec({Cmd: ["touch", "/tmp/start-self-update"], AttachStdout: true, AttachStderr: true});
    const stream = await exec.start({});
    stream.resume();
  }

  async function cleanupContainers() {
    if (!ownsResources) return;
    const owned = (await docker.listContainers({all: true})).filter(container => container.Labels[label] ||
      targetIds.has(container.Labels["mqdockerup.self_update"]));
    for (const container of owned) {
      await docker.getContainer(container.Id).remove({force: true, v: true}).catch(error => { if (error.statusCode !== 404) throw error; });
    }
    for (const volume of volumes) await docker.getVolume(volume).remove().catch(error => { if (error.statusCode !== 404) throw error; });
    volumes.clear();
  }

  afterEach(async () => {
    await cleanupContainers();
    // Restore the old tag after the test's deliberate local retag.
    if (ownsResources) {
      const images = await docker.listImages({filters: {label: [`${label}=old`]}});
      if (images[0]) await docker.getImage(images[0].Id).tag({repo: prefix, tag: "old"});
    }
  }, 60000);

  afterAll(async () => {
    await cleanupContainers();
    if (!ownsResources) return;
    for (const network of [secondary, primary]) if (network) await network.remove();
    for (const image of await docker.listImages({filters: {label: [label]}})) await docker.getImage(image.Id).remove({force: true});
    mkdirSync("test-results", {recursive: true});
    writeFileSync("test-results/self-update.json", JSON.stringify(evidence, null, 2));
  }, 60000);

  test("the helper survives its caller and preserves volumes, hostname, ports, and both networks", async () => {
    const {old, info, newImage} = await create();
    await trigger(old);
    let replacement: any;
    await until(async () => {
      try {
        replacement = await docker.getContainer(prefix).inspect();
        if (!replacement.State.Running && replacement.State.ExitCode !== 0) throw new Error((await old.logs({stdout: true, stderr: true})).toString());
        if (replacement.Id === old.id || !replacement.State.Running) return false;
        await old.inspect();
        return false;
      } catch (error: any) { if (error.statusCode === 404) return replacement?.State.Running === true; throw error; }
    });
    expect(replacement.Image).toBe(newImage.Id);
    expect(replacement.Config.Image).toBe(oldTag);
    expect(replacement.Config.Hostname).toBe("custom-updater-hostname");
    expect(replacement.Config.Env).toContain(`MQDOCKERUP_PREDECESSOR_ID=${old.id}`);
    expect(replacement.Mounts.find((mount: any) => mount.Destination === "/state").Name).toBe(info.Mounts.find(mount => mount.Destination === "/state")!.Name);
    for (const path of ["/inherited", "/extra", "/app/data", "/destination-only"]) {
      expect(replacement.Mounts.find((mount: any) => mount.Destination === path).Source).toBe(info.Mounts.find(mount => mount.Destination === path)!.Source);
    }
    expect(replacement.NetworkSettings.Networks[`${prefix}-primary`].IPAddress).toBe(staticAddress);
    expect(replacement.NetworkSettings.Networks[`${prefix}-secondary`].Aliases).toContain("secondary-alias");
    expect(replacement.HostConfig.PortBindings).toEqual(info.HostConfig.PortBindings);
    await until(async () => !(await docker.listContainers({all: true})).some(container => container.Labels["mqdockerup.self_update"] === old.id));
    evidence.push({case: "success", old: old.id, replacement: replacement.Id, image: replacement.Image, staticAddress, mountsPreserved: true, helperCleaned: true});
  }, 90000);

  test("an exiting replacement restores the old container and its network address", async () => {
    const {old} = await create(true);
    await trigger(old);
    await until(async () => {
      const current = await old.inspect();
      return current.State.Running && current.RestartCount === 0 &&
        (await old.logs({stdout: true, stderr: true})).toString().split(`SELF_ID:${old.id}`).length >= 3;
    });
    const restored = await docker.getContainer(prefix).inspect();
    expect(restored.Id).toBe(old.id);
    expect(restored.NetworkSettings.Networks[`${prefix}-primary`].IPAddress).toBe(staticAddress);
    expect(restored.NetworkSettings.Networks[`${prefix}-secondary`].Aliases).toContain("secondary-alias");
    await until(async () => !(await docker.listContainers({all: true})).some(container => container.Labels["mqdockerup.self_update"] === old.id));
    evidence.push({case: "rollback", restored: restored.Id, running: restored.State.Running, staticAddress});
  }, 90000);

  test("a running replacement without a startup acknowledgment is rolled back", async () => {
    const {old} = await create(false, true);
    await trigger(old);
    await until(async () => {
      const current = await old.inspect();
      return current.State.Running &&
        (await old.logs({stdout: true, stderr: true})).toString().split(`SELF_ID:${old.id}`).length >= 3;
    }, 160000);
    const restored = await docker.getContainer(prefix).inspect();
    expect(restored.Id).toBe(old.id);
    expect(restored.NetworkSettings.Networks[`${prefix}-primary`].IPAddress).toBe(staticAddress);
    await until(async () => !(await docker.listContainers({all: true})).some(container => container.Labels["mqdockerup.self_update"] === old.id));
    evidence.push({case: "startup-timeout-rollback", restored: restored.Id, running: restored.State.Running});
  }, 180000);
});
