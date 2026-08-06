jest.mock("../src/index", () => ({
  mqttClient: {
    publish: jest.fn(),
    on: jest.fn(),
    end: jest.fn(),
  },
}));

import { ContainerInspectInfo } from "dockerode";
import fs from "fs";

fs.mkdirSync("./data", { recursive: true });

const DockerService = require("../src/services/DockerService").default;

describe('DockerService.getCreatedBy', () => {
  test('returns "Composer" when compose labels exist', () => {
    const container = {
      Config: { Labels: { 'com.docker.compose.project': 'demo' } }
    } as unknown as ContainerInspectInfo;
    expect(DockerService.getCreatedBy(container)).toBe('Composer');
  });

  test('returns "Docker" when compose labels are missing', () => {
    const container = {
      Config: { Labels: { 'random': 'value' } }
    } as unknown as ContainerInspectInfo;
    expect(DockerService.getCreatedBy(container)).toBe('Docker');
  });
});
