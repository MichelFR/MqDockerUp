import SelfUpdateService from "../src/services/SelfUpdateService";
import fs from "fs";
import {PassThrough} from "stream";

describe("SelfUpdateService", () => {
  const id = "a".repeat(64);
  const imageId = `sha256:${"b".repeat(64)}`;
  let info: any;
  let old: any;
  let replacement: any;
  let docker: any;
  let network: any;

  beforeEach(() => {
    info = {
      Id: id, Name: "/mqdockerup", Image: `sha256:${"c".repeat(64)}`,
      Config: { Image: "micrib/mqdockerup:latest", Env: ["MQTT_PASSWORD=secret"], Labels: {"com.docker.compose.service": "mqdockerup"} },
      HostConfig: { NetworkMode: "primary", RestartPolicy: {Name: "unless-stopped"}, Binds: ["/data:/app/data:ro"] },
      Mounts: [{Type: "bind", Source: "/run/user/1000/docker.sock", Destination: "/var/run/docker.sock"},
        {Type: "volume", Name: "anonymous-data", Destination: "/anonymous", RW: true}],
      State: {Running: true},
      NetworkSettings: {Networks: {
        primary: {Aliases: [id.substring(0, 12), "mqdockerup"], IPAMConfig: {IPv4Address: "172.28.0.3"}},
        secondary: {Aliases: ["updater"]},
      }},
    };
    old = {inspect: jest.fn().mockResolvedValue(info), stop: jest.fn(), rename: jest.fn(), start: jest.fn(), remove: jest.fn()};
    replacement = {id: "new", inspect: jest.fn().mockResolvedValue({Image: imageId, State: {Running: true}, RestartCount: 0}), start: jest.fn(), remove: jest.fn()};
    network = {connect: jest.fn(), disconnect: jest.fn()};
    docker = {modem: {demuxStream: jest.fn()}, getContainer: jest.fn().mockReturnValue(old), getImage: jest.fn().mockReturnValue({inspect: jest.fn().mockResolvedValue({Id: imageId})}),
      createContainer: jest.fn().mockResolvedValue(replacement), getNetwork: jest.fn().mockReturnValue(network)};
    jest.spyOn(SelfUpdateService, "waitUntilRunning").mockResolvedValue();
  });
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

  test("preserves settings, anonymous volumes, networks, and future image checks", async () => {
    await SelfUpdateService.replace(docker, id, imageId);
    const config = docker.createContainer.mock.calls[0][0];
    expect(config.Image).toBe(info.Config.Image);
    expect(config.HostConfig.RestartPolicy).toEqual(info.HostConfig.RestartPolicy);
    expect(config.HostConfig.Binds).toEqual(["/data:/app/data:ro", "anonymous-data:/anonymous:rw"]);
    expect(config.Labels).toEqual(info.Config.Labels);
    expect(config.Env).toEqual(["MQTT_PASSWORD=secret", `MQDOCKERUP_PREDECESSOR_ID=${id}`]);
    expect(config.NetworkingConfig.EndpointsConfig.primary.Aliases).toEqual(["mqdockerup"]);
    expect(network.disconnect).toHaveBeenCalledTimes(2);
    expect(network.connect).toHaveBeenCalledWith({Container: "new", EndpointConfig: {Aliases: ["updater"], IPAMConfig: undefined, Links: undefined}});
    expect(old.remove).toHaveBeenCalledTimes(1);
    expect(old.start).not.toHaveBeenCalled();
  });

  test("preserves anonymous Mounts sources and volumes alongside VolumesFrom", () => {
    info.HostConfig.VolumesFrom = ["donor:ro"];
    info.HostConfig.Mounts = [{Type: "volume", Target: "/anonymous", VolumeOptions: {NoCopy: true}}];
    info.Mounts.push({Type: "volume", Name: "own-extra", Destination: "/extra", RW: true});
    const config = SelfUpdateService.buildConfig(info);
    expect(config.HostConfig!.Mounts![0]).toEqual({Type: "volume", Target: "/anonymous", Source: "anonymous-data", VolumeOptions: {NoCopy: true}});
    expect(config.HostConfig!.Binds).toContain("own-extra:/extra:rw");
    expect(config.HostConfig!.VolumesFrom).toEqual(["donor:ro"]);
    expect(info.HostConfig.Mounts[0].Source).toBeUndefined();
  });

  test("replaces destination-only binds instead of duplicating their destination", () => {
    info.HostConfig.Binds = ["/anonymous"];
    expect(SelfUpdateService.buildConfig(info).HostConfig!.Binds).toEqual(["anonymous-data:/anonymous:rw"]);
  });

  test("resolves legacy volume names through Docker metadata before stopping", async () => {
    info.HostConfig.Binds = ["/anonymous"];
    info.Mounts[1] = {Type: "volume", Source: "/custom-storage/data", Destination: "/anonymous", RW: true};
    docker.listVolumes = jest.fn().mockResolvedValue({Volumes: [{Name: "resolved-volume", Mountpoint: "/custom-storage/data"}]});
    await SelfUpdateService.replace(docker, id, imageId);
    expect(docker.createContainer.mock.calls[0][0].HostConfig.Binds).toEqual(["resolved-volume:/anonymous:rw"]);
  });

  test.each(["remove", "rename", "network"])("continues recovery after a rollback %s failure", async step => {
    replacement.start.mockRejectedValue(new Error("start failed"));
    if (step === "remove") replacement.remove.mockRejectedValue(new Error("removal denied"));
    if (step === "rename") old.rename.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("rename denied"));
    if (step === "network") network.connect.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("network missing"));
    await expect(SelfUpdateService.replace(docker, id, imageId)).rejects.toThrow(`Recovery of ${id}`);
    expect(old.start).toHaveBeenCalledTimes(1);
    expect(network.connect).toHaveBeenCalledTimes(3);
    expect(old.remove).not.toHaveBeenCalled();
  });

  test.each(["stop", "rename", "disconnect", "create", "connect", "start", "readiness", "image"])("rolls back %s failures without removing the predecessor", async failure => {
    const error = new Error("failed");
    if (failure === "stop") old.stop.mockRejectedValueOnce(error);
    if (failure === "rename") old.rename.mockRejectedValueOnce(error);
    if (failure === "disconnect") network.disconnect.mockRejectedValueOnce(error);
    if (failure === "create") docker.createContainer.mockRejectedValueOnce(error);
    if (failure === "connect") network.connect.mockRejectedValueOnce(error);
    if (failure === "start") replacement.start.mockRejectedValueOnce(error);
    if (failure === "readiness") (SelfUpdateService.waitUntilRunning as jest.Mock).mockRejectedValueOnce(error);
    if (failure === "image") replacement.inspect.mockResolvedValueOnce({Image: "different"});
    await expect(SelfUpdateService.replace(docker, id, imageId)).rejects.toThrow();
    expect(old.remove).not.toHaveBeenCalled();
    expect(old.start).toHaveBeenCalledTimes(failure === "stop" ? 0 : 1);
    if (!["stop", "rename", "disconnect", "create"].includes(failure)) expect(replacement.remove).toHaveBeenCalledWith({force: true});
  });

  test("cleanup failure leaves a working replacement alone", async () => {
    old.remove.mockRejectedValue(new Error("cleanup failed"));
    await expect(SelfUpdateService.replace(docker, id, imageId)).rejects.toThrow("cleanup failed");
    expect(replacement.remove).not.toHaveBeenCalled();
    expect(old.start).not.toHaveBeenCalled();
  });

  test.each(["unknown", "autoremove", "retag"])("refuses %s before stopping anything", async failure => {
    if (failure === "autoremove") info.HostConfig.AutoRemove = true;
    if (failure === "retag") docker.getImage().inspect.mockResolvedValue({Id: "different"});
    await expect(SelfUpdateService.replace(docker, failure === "unknown" ? "short-id" : id, imageId)).rejects.toThrow();
    expect(old.stop).not.toHaveBeenCalled();
  });

  test("helper has only the socket, runs known code, and pins the target", async () => {
    jest.spyOn(SelfUpdateService, "getContainerId").mockReturnValue(id);
    const helper = {attach: jest.fn().mockResolvedValue(new PassThrough()), start: jest.fn(), wait: jest.fn().mockResolvedValue({StatusCode: 0}), remove: jest.fn()};
    docker.createContainer.mockResolvedValue(helper);
    await SelfUpdateService.start(docker, info);
    const config = docker.createContainer.mock.calls[0][0];
    expect(config.Image).toBe(info.Image);
    expect(config.Cmd.slice(-2)).toEqual([id, imageId]);
    expect(config.Env).toBeUndefined();
    expect(config.HostConfig.Binds).toEqual(["/run/user/1000/docker.sock:/var/run/docker.sock"]);
    expect(config.HostConfig.NetworkMode).toBe("none");
    expect(config.HostConfig.AutoRemove).toBe(true);
    expect(config.Labels["mqdockerup.ignore_container"]).toBe("true");
  });

  test("failed helper startup cleans up without stopping this instance", async () => {
    jest.spyOn(SelfUpdateService, "getContainerId").mockReturnValue(id);
    const helper = {attach: jest.fn().mockResolvedValue(new PassThrough()), start: jest.fn().mockRejectedValue(new Error("start failed")), remove: jest.fn()};
    docker.createContainer.mockResolvedValue(helper);
    await expect(SelfUpdateService.start(docker, info)).rejects.toThrow("start failed");
    expect(helper.remove).toHaveBeenCalledWith({force: true});
    expect(old.stop).not.toHaveBeenCalled();
  });

  test("marks an intentional shutdown only while the helper is active", async () => {
    jest.spyOn(SelfUpdateService, "getContainerId").mockReturnValue(id);
    let finish: (result: any) => void = () => {};
    const helper = {attach: jest.fn().mockResolvedValue(new PassThrough()), start: jest.fn(), wait: jest.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; }))};
    docker.createContainer.mockResolvedValue(helper);
    const operation = SelfUpdateService.start(docker, info);
    await new Promise(resolve => setImmediate(resolve));
    expect(SelfUpdateService.handoffContainerId).toBe(id);
    finish({StatusCode: 1});
    await expect(operation).rejects.toThrow("before handoff");
    expect(SelfUpdateService.handoffContainerId).toBeUndefined();
  });

  test("unknown identity cannot launch a helper", async () => {
    jest.spyOn(SelfUpdateService, "getContainerId").mockReturnValue(null);
    await expect(SelfUpdateService.start(docker, info)).rejects.toThrow("identified container");
    expect(docker.createContainer).not.toHaveBeenCalled();
  });

  test.each(["mountinfo", "cgroup", "scope", "unknown"])("identifies %s without relying on the hostname", source => {
    jest.spyOn(fs, "readFileSync").mockImplementation((path: any) => {
      if (source === "mountinfo" && path === "/proc/self/mountinfo") return `31 20 8:1 /var/lib/docker/containers/${id}/hostname /etc/hostname rw - ext4 /dev/sda rw`;
      if (source === "cgroup" && path === "/proc/self/cgroup") return `1:cpu:/docker/${id}\n`;
      if (source === "scope" && path === "/proc/self/cgroup") return `0::/system.slice/docker-${id}.scope\n`;
      return "0::/\n";
    });
    expect(SelfUpdateService.getContainerId()).toBe(source === "unknown" ? null : id);
  });

  test("requires socket access and a recoverable predecessor", () => {
    jest.spyOn(SelfUpdateService, "getContainerId").mockReturnValue(id);
    expect(SelfUpdateService.canUpdate(info)).toBe(true);
    info.HostConfig.AutoRemove = true;
    expect(SelfUpdateService.canUpdate(info)).toBe(false);
    info.HostConfig.AutoRemove = false;
    info.Mounts = [];
    expect(SelfUpdateService.canUpdate(info)).toBe(false);
  });

  test.each(["exited", "restarted", "unhealthy", "timeout", "no-ack", "healthy"])("checks replacement %s", async state => {
    (SelfUpdateService.waitUntilRunning as jest.Mock).mockRestore();
    jest.useFakeTimers();
    replacement.inspect.mockResolvedValue({State: {Running: state !== "exited", Health: {Status: state === "unhealthy" ? "unhealthy" : state === "healthy" ? "healthy" : "starting"}}, RestartCount: state === "restarted" ? 1 : 0});
    if (state === "no-ack") replacement.inspect.mockResolvedValue({State: {Running: true}, RestartCount: 0});
    replacement.exec = jest.fn().mockResolvedValue({start: jest.fn(), inspect: jest.fn().mockResolvedValue({Running: false, ExitCode: state === "no-ack" ? 1 : 0})});
    const operation = SelfUpdateService.waitUntilRunning(replacement);
    const assertion = state === "healthy" ? expect(operation).resolves.toBeUndefined() : expect(operation).rejects.toThrow();
    await jest.advanceTimersByTimeAsync(121000);
    await assertion;
    if (state === "healthy") expect(replacement.exec.mock.calls[0][0].Cmd.slice(-1)).toEqual(["/app/data/.mqdockerup-ready"]);
  });
});
