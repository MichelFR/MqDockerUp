jest.mock("../src/index", () => ({
  mqttClient: {
    publish: jest.fn(),
    on: jest.fn(),
    end: jest.fn(),
  },
}));

import IgnoreService from "../src/services/IgnoreService";
import { ContainerInfo, ContainerInspectInfo } from "dockerode";

// Builds a minimal ContainerInfo (as returned by listContainers).
function makeContainerInfo(names: string[], labels: Record<string, string> = {}): ContainerInfo {
  return { Names: names, Labels: labels } as unknown as ContainerInfo;
}

// Builds a minimal ContainerInspectInfo (as returned by inspect).
function makeInspectInfo(image: string, name: string, labels: Record<string, string> = {}): ContainerInspectInfo {
  return { Config: { Image: image, Labels: labels }, Name: name } as unknown as ContainerInspectInfo;
}

// Re-imports IgnoreService so it picks up the current environment variables,
// since the service reads its config once at module load.
function loadIgnoreServiceWithEnv(env: Record<string, string>): typeof IgnoreService {
  let service: typeof IgnoreService = IgnoreService;
  jest.isolateModules(() => {
    for (const [key, value] of Object.entries(env)) {
      process.env[key] = value;
    }
    service = require("../src/services/IgnoreService").default;
  });
  return service;
}

describe('IgnoreService.ignoreUpdates', () => {
  const cases: Array<[string, string, boolean]> = [
    ['mqdockerup:latest', '/mqdockerup', true],
    ['MqDockerUp:v1.22.1', '/MqDockerUp', true],
    ['docker.io/user/mqdockerup:latest', '/custom_name', true],
    ['my.registry:5000/mqdockerup:latest', '/mqdockerup', true],
    ['nginx:latest', '/nginx', false],
    ['my.registry:5000/nginx:latest', '/nginx', false],
  ];

  test.each(cases)('%s %s', (image, name, expected) => {
    const container = {
      Config: {
        Image: image,
        Labels: {}
      },
      Name: name
    };

    expect(IgnoreService.ignoreUpdates(container as ContainerInspectInfo)).toBe(expected);
  });
});

describe('IgnoreService.ignoreContainer whitelist (MONITOR_CONTAINERS)', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.MONITOR_CONTAINERS;
    delete process.env.IGNORE_CONTAINERS;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('monitors every container when no whitelist is set (default)', () => {
    const service = loadIgnoreServiceWithEnv({});
    expect(service.ignoreContainer(makeContainerInfo(['/nginx']))).toBe(false);
    expect(service.ignoreContainer(makeContainerInfo(['/anything']))).toBe(false);
  });

  it('monitors every container when the whitelist is "*"', () => {
    const service = loadIgnoreServiceWithEnv({ MONITOR_CONTAINERS: '*' });
    expect(service.ignoreContainer(makeContainerInfo(['/nginx']))).toBe(false);
  });

  it('only monitors whitelisted containers and ignores the rest', () => {
    const service = loadIgnoreServiceWithEnv({ MONITOR_CONTAINERS: 'nginx,redis' });
    expect(service.ignoreContainer(makeContainerInfo(['/nginx']))).toBe(false);
    expect(service.ignoreContainer(makeContainerInfo(['/redis']))).toBe(false);
    expect(service.ignoreContainer(makeContainerInfo(['/postgres']))).toBe(true);
  });

  it('matches whitelist entries exactly (no substring matches)', () => {
    const service = loadIgnoreServiceWithEnv({ MONITOR_CONTAINERS: 'web' });
    expect(service.ignoreContainer(makeContainerInfo(['/web']))).toBe(false);
    expect(service.ignoreContainer(makeContainerInfo(['/webapp']))).toBe(true);
  });

  it('trims whitespace around whitelist entries', () => {
    const service = loadIgnoreServiceWithEnv({ MONITOR_CONTAINERS: ' nginx , redis ' });
    expect(service.ignoreContainer(makeContainerInfo(['/redis']))).toBe(false);
  });

  it('monitors a container carrying the monitor label even if not in the list', () => {
    const service = loadIgnoreServiceWithEnv({ MONITOR_CONTAINERS: 'nginx' });
    const labelled = makeContainerInfo(['/postgres'], { 'mqdockerup.monitor_container': 'true' });
    expect(service.ignoreContainer(labelled)).toBe(false);
  });

  it('lets an explicit ignore win over the whitelist', () => {
    const service = loadIgnoreServiceWithEnv({ MONITOR_CONTAINERS: 'nginx', IGNORE_CONTAINERS: 'nginx' });
    expect(service.ignoreContainer(makeContainerInfo(['/nginx']))).toBe(true);
  });

  it('lets the ignore label win over the whitelist', () => {
    const service = loadIgnoreServiceWithEnv({ MONITOR_CONTAINERS: 'nginx' });
    const ignored = makeContainerInfo(['/nginx'], { 'mqdockerup.ignore_container': 'true' });
    expect(service.ignoreContainer(ignored)).toBe(true);
  });
});

describe('IgnoreService.ignoreUpdates whitelist (MONITOR_UPDATES)', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.MONITOR_UPDATES;
    delete process.env.IGNORE_UPDATES;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('only checks updates for whitelisted containers', () => {
    const service = loadIgnoreServiceWithEnv({ MONITOR_UPDATES: 'nginx' });
    expect(service.ignoreUpdates(makeInspectInfo('nginx:latest', '/nginx'))).toBe(false);
    expect(service.ignoreUpdates(makeInspectInfo('redis:latest', '/redis'))).toBe(true);
  });

  it('always ignores MqDockerUp updates even when whitelisted', () => {
    const service = loadIgnoreServiceWithEnv({ MONITOR_UPDATES: 'mqdockerup' });
    expect(service.ignoreUpdates(makeInspectInfo('mqdockerup:latest', '/mqdockerup'))).toBe(true);
  });

  it('checks updates for a container carrying the monitor_updates label', () => {
    const service = loadIgnoreServiceWithEnv({ MONITOR_UPDATES: 'nginx' });
    const labelled = makeInspectInfo('redis:latest', '/redis', { 'mqdockerup.monitor_updates': 'true' });
    expect(service.ignoreUpdates(labelled)).toBe(false);
  });
});

describe('IgnoreService with a partially defined config', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  // Loads IgnoreService with a mocked ConfigService so we can inject a config
  // whose `ignore` section is missing keys (as a shallow-merged partial
  // config.yaml produces), without touching the real config file.
  function loadIgnoreServiceWithConfig(configValue: any): typeof IgnoreService {
    let service: typeof IgnoreService = IgnoreService;
    jest.isolateModules(() => {
      jest.doMock("../src/services/ConfigService", () => ({
        __esModule: true,
        default: { getConfig: () => configValue },
      }));
      service = require("../src/services/IgnoreService").default;
    });
    return service;
  }

  it('does not crash when ignore.updates is undefined', () => {
    const service = loadIgnoreServiceWithConfig({ ignore: { containers: "" } });
    expect(() => service.ignoreUpdates(makeInspectInfo('nginx:latest', '/nginx'))).not.toThrow();
    expect(service.ignoreUpdates(makeInspectInfo('nginx:latest', '/nginx'))).toBe(false);
  });

  it('does not crash when ignore.containers is undefined', () => {
    const service = loadIgnoreServiceWithConfig({ ignore: { updates: "" } });
    expect(() => service.ignoreContainer(makeContainerInfo(['/nginx']))).not.toThrow();
    expect(service.ignoreContainer(makeContainerInfo(['/nginx']))).toBe(false);
  });

  it('does not crash when getConfig returns undefined', () => {
    const service = loadIgnoreServiceWithConfig(undefined);
    expect(() => service.ignoreContainer(makeContainerInfo(['/nginx']))).not.toThrow();
    expect(() => service.ignoreUpdates(makeInspectInfo('nginx:latest', '/nginx'))).not.toThrow();
  });
});
