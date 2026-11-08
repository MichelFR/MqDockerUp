import Docker, {ContainerInspectInfo} from "dockerode";
import {readFileSync, writeFileSync, unlinkSync} from "fs";
import {PassThrough} from "stream";

/** Replaces this instance from a short-lived process that survives its shutdown. */
export default class SelfUpdateService {
  public static readonly predecessorVariable = "MQDOCKERUP_PREDECESSOR_ID";
  public static readonly helperLabel = "mqdockerup.self_update";
  public static handoffContainerId: string | undefined;
  private static readonly socketPath = "/var/run/docker.sock";
  private static readonly readyPath = "/app/data/.mqdockerup-ready";

  public static markReady(): void {
    const id = this.getContainerId();
    if (id) writeFileSync(this.readyPath, id);
  }

  public static clearReady(): void {
    try {
      if (readFileSync(this.readyPath, "utf8") === this.getContainerId()) unlinkSync(this.readyPath);
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  public static getContainerId(): string | null {
    // Docker's cgroup v2 namespace can hide the ID; its hostname bind mount
    // still identifies the container even when its hostname was overridden.
    for (const path of ["/proc/self/mountinfo", "/proc/self/cgroup"]) {
      try {
        const text = readFileSync(path, "utf8");
        const match = path.endsWith("mountinfo")
          ? text.match(/\/containers\/([a-f0-9]{64})\/hostname\s+\/etc\/hostname\s/)
          : text.match(/(?:\/docker\/|docker-)([a-f0-9]{64})(?:\.scope)?(?:\s|\/|$)/);
        if (match) return match[1];
      } catch (_) {
        // Native installations and non-Docker runtimes have no self-update ID.
      }
    }
    return null;
  }

  public static isSelf(info: ContainerInspectInfo): boolean {
    return !!info.Id && info.Id === this.getContainerId();
  }

  public static canUpdate(info: ContainerInspectInfo): boolean {
    return this.isSelf(info) && !info.HostConfig.AutoRemove &&
      info.Mounts?.some(mount => mount.Destination === this.socketPath && mount.Type === "bind") === true;
  }

  public static async start(docker: Docker, info: ContainerInspectInfo): Promise<void> {
    if (!this.canUpdate(info)) throw new Error("Self-update requires an identified container and a mounted Docker socket without AutoRemove");
    const image = await docker.getImage(info.Config.Image).inspect();
    const socket = info.Mounts.find(mount => mount.Destination === this.socketPath)!;
    const helper = await docker.createContainer({
      name: `mqdockerup-self-update-${info.Id}`,
      Image: info.Image,
      WorkingDir: "/app",
      Entrypoint: ["node"],
      Cmd: ["node_modules/ts-node/dist/bin.js", "src/self-update.ts", info.Id, image.Id],
      Labels: { [this.helperLabel]: info.Id, "mqdockerup.ignore_container": "true", "mqdockerup.ignore_updates": "true" },
      HostConfig: {
        Binds: [`${socket.Source}:${this.socketPath}`],
        AutoRemove: true,
        NetworkMode: "none",
        RestartPolicy: { Name: "no" },
      },
    });
    const output = new PassThrough();
    let diagnostics = "";
    output.on("data", chunk => { diagnostics = (diagnostics + chunk.toString()).slice(-8192); });
    let attached: (NodeJS.ReadWriteStream & {destroy?: () => void}) | undefined;
    this.handoffContainerId = info.Id;
    try {
      try {
        attached = await helper.attach({stream: true, stdout: true, stderr: true});
        attached.on("error", () => {});
        docker.modem.demuxStream(attached, output, output);
        await helper.start();
      } catch (error) {
        await helper.remove({force: true});
        throw error;
      }
      // Keep the caller's update lock until it is stopped. If preflight fails,
      // the still-running caller can clear progress and report the failure.
      const result = await helper.wait();
      if (result.StatusCode !== 0) throw new Error(`Self-update helper failed before handoff: ${diagnostics.trim()}`);
    } finally {
      attached?.destroy?.();
      output.destroy();
      this.handoffContainerId = undefined;
    }
  }

  public static buildConfig(info: ContainerInspectInfo): Docker.ContainerCreateOptions {
    const hostConfig = { ...info.HostConfig, Binds: [...(info.HostConfig.Binds || [])], Mounts: info.HostConfig.Mounts?.map(mount => ({...mount})) };
    // Anonymous volumes have names in inspect.Mounts but not in HostConfig.
    // Reuse them rather than silently allocating empty data volumes.
    for (const mount of info.Mounts || []) {
      if (mount.Type !== "volume") continue;
      if (!mount.Name) throw new Error(`Cannot preserve unnamed volume at ${mount.Destination}`);
      const anonymousBind = hostConfig.Binds.indexOf(mount.Destination);
      if (anonymousBind !== -1) hostConfig.Binds[anonymousBind] = `${mount.Name}:${mount.Destination}:${mount.RW ? "rw" : "ro"}`;
      const explicit = hostConfig.Mounts?.find(item => item.Target === mount.Destination);
      if (explicit?.Type === "volume" && !explicit.Source) explicit.Source = mount.Name;
      const configured = !!explicit ||
        hostConfig.Binds.some(bind => bind.split(":")[1] === mount.Destination);
      if (!configured) hostConfig.Binds.push(`${mount.Name}:${mount.Destination}:${mount.RW ? "rw" : "ro"}`);
    }
    return {
      ...info.Config,
      name: info.Name.replace(/^\//, ""),
      HostConfig: hostConfig,
      Env: [...(info.Config.Env || []).filter(value => !value.startsWith(`${this.predecessorVariable}=`)), `${this.predecessorVariable}=${info.Id}`],
    };
  }

  public static async replace(docker: Docker, containerId: string, imageId: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(containerId) || !/^sha256:[a-f0-9]{64}$/.test(imageId)) {
      throw new Error("Invalid self-update container or image ID");
    }
    const old = docker.getContainer(containerId);
    const info = await old.inspect();
    if (info.HostConfig.AutoRemove) throw new Error("Cannot roll back an AutoRemove container");
    const image = await docker.getImage(info.Config.Image).inspect();
    if (image.Id !== imageId) throw new Error("Image reference changed before self-update");
    if (info.Mounts.some(mount => mount.Type === "volume" && !mount.Name)) {
      // Legacy destination-only binds can omit Name in container inspect.
      // Resolve through Docker's volume metadata, not a storage-path guess.
      const {Volumes} = await docker.listVolumes();
      for (const mount of info.Mounts) {
        if (mount.Type === "volume" && !mount.Name) {
          mount.Name = Volumes?.find(volume => volume.Mountpoint === mount.Source)?.Name;
        }
      }
    }
    const config = this.buildConfig(info);
    const name = config.name!;
    const endpoints: Record<string, any> = {};
    for (const [network, endpoint] of Object.entries(info.NetworkSettings.Networks || {})) {
      endpoints[network] = {
        IPAMConfig: endpoint.IPAMConfig || undefined,
        Links: endpoint.Links || undefined,
        Aliases: endpoint.Aliases?.filter((alias: string) => alias !== containerId.substring(0, 12)),
      };
    }
    const primary = Object.keys(endpoints).find(network => network === info.HostConfig.NetworkMode) || Object.keys(endpoints)[0];
    if (primary && !["host", "none", "bridge"].includes(primary)) {
      config.NetworkingConfig = { EndpointsConfig: { [primary]: endpoints[primary] } };
    }
    let replacement: Docker.Container | undefined;
    let stopped = false;
    let renamed = false;
    const disconnected: string[] = [];
    try {
      await old.stop({t: 30});
      stopped = true;
      await old.rename({name: `${name}_mqdockerup_old_${containerId.substring(0, 12)}`});
      renamed = true;
      for (const network of Object.keys(endpoints)) {
        if (["host", "none"].includes(network)) continue;
        await docker.getNetwork(network).disconnect({Container: containerId});
        disconnected.push(network);
      }
      replacement = await docker.createContainer(config);
      for (const network of Object.keys(endpoints)) {
        if (network === primary || ["host", "none"].includes(network)) continue;
        await docker.getNetwork(network).connect({Container: replacement.id, EndpointConfig: endpoints[network]});
      }
      // Preserve the tag for future checks, but reject a concurrent retag/pull.
      if ((await replacement.inspect()).Image !== imageId) throw new Error("Replacement image changed during self-update");
      await replacement.start();
      await this.waitUntilRunning(replacement);
    } catch (error) {
      const failures: string[] = [];
      const recover = async (step: string, action: () => Promise<unknown>) => {
        try { await action(); } catch (recoveryError) { failures.push(`${step}: ${recoveryError}`); }
      };
      if (replacement) await recover("remove replacement", () => replacement!.remove({force: true}));
      if (renamed) await recover("restore name", () => old.rename({name}));
      for (const network of disconnected) {
        await recover(`restore network ${network}`, () => docker.getNetwork(network).connect({Container: containerId, EndpointConfig: endpoints[network]}));
      }
      if (stopped && info.State.Running) await recover("restart predecessor", () => old.start());
      if (failures.length) throw new Error(`Self-update failed: ${error}. Recovery of ${containerId}: ${failures.join("; ")}`);
      throw error;
    }
    // Cleanup failures must not remove a working replacement or roll it back.
    await old.remove();
  }

  public static async waitUntilRunning(container: Docker.Container): Promise<void> {
    const deadline = Date.now() + 120000;
    const stableAfter = Date.now() + 10000;
    while (Date.now() < deadline) {
      const info = await container.inspect();
      if (!info.State.Running || info.RestartCount > 0 || info.State.Health?.Status === "unhealthy") {
        throw new Error("Self-update replacement failed to stay running");
      }
      if (Date.now() >= stableAfter && (!info.State.Health || info.State.Health.Status === "healthy") && await this.isReady(container)) return;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error("Self-update replacement readiness timed out");
  }

  private static async isReady(container: Docker.Container): Promise<boolean> {
    const probe = await container.exec({
      Cmd: ["node", "-e", "try { process.exit(require('fs').readFileSync(process.argv[2], 'utf8') === process.argv[1] ? 0 : 1); } catch (_) { process.exit(1); }", container.id, this.readyPath],
      AttachStdout: false, AttachStderr: false,
    });
    const response = await probe.start({Detach: true});
    response?.resume();
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const result = await probe.inspect();
      if (!result.Running) return result.ExitCode === 0;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
  }
}
