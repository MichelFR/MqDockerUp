jest.mock("../src/index", () => ({
  mqttClient: {
    publish: jest.fn(),
    on: jest.fn(),
    end: jest.fn(),
  },
}));

import IgnoreService from "../src/services/IgnoreService";
import { ContainerInspectInfo } from "dockerode";

describe('IgnoreService.ignoreUpdates', () => {
  const cases: Array<[string, string, boolean]> = [
    ['mqdockerup:latest', '/mqdockerup', true],
    ['MqDockerUp:v1.22.1', '/MqDockerUp', true],
    ['docker.io/user/mqdockerup:latest', '/custom_name', true],
    ['nginx:latest', '/nginx', false],
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