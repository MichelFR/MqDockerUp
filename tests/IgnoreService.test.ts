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
  test('returns true for MqDockerUp containers (lowercase)', () => {
    const container = {
      Config: { 
        Image: "mqdockerup:latest",
        Labels: {}
      },
      Name: "/mqdockerup-container"
    } as unknown as ContainerInspectInfo;
    
    expect(IgnoreService.ignoreUpdates(container)).toBe(true);
  });

  test('returns true for MqDockerUp containers (mixed case)', () => {
    const container = {
      Config: { 
        Image: "MqDockerUp:v1.22.1",
        Labels: {}
      },
      Name: "/MqDockerUp-container"
    } as unknown as ContainerInspectInfo;
    
    expect(IgnoreService.ignoreUpdates(container)).toBe(true);
  });

  test('returns true for MqDockerUp containers with registry prefix', () => {
    const container = {
      Config: { 
        Image: "docker.io/user/mqdockerup:latest",
        Labels: {}
      },
      Name: "/my-mqdockerup"
    } as unknown as ContainerInspectInfo;
    
    expect(IgnoreService.ignoreUpdates(container)).toBe(true);
  });

  test('returns false for non-MqDockerUp containers', () => {
    const container = {
      Config: { 
        Image: "nginx:latest",
        Labels: {}
      },
      Name: "/nginx-container"
    } as unknown as ContainerInspectInfo;
    
    expect(IgnoreService.ignoreUpdates(container)).toBe(false);
  });

  test('returns true for containers with ignore label set to true', () => {
    const container = {
      Config: { 
        Image: "nginx:latest",
        Labels: {
          "mqdockerup.ignore_updates": "true"
        }
      },
      Name: "/nginx-container"
    } as unknown as ContainerInspectInfo;
    
    expect(IgnoreService.ignoreUpdates(container)).toBe(true);
  });

  test('returns false for containers with ignore label set to false', () => {
    const container = {
      Config: { 
        Image: "nginx:latest",
        Labels: {
          "mqdockerup.ignore_updates": "false"
        }
      },
      Name: "/nginx-container"
    } as unknown as ContainerInspectInfo;
    
    expect(IgnoreService.ignoreUpdates(container)).toBe(false);
  });
});