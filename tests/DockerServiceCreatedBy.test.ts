jest.mock("../src/index", () => ({
  mqttClient: {
    publish: jest.fn(),
    on: jest.fn(),
    end: jest.fn(),
  },
}));

import DockerService from "../src/services/DockerService";
import { ContainerInspectInfo } from "dockerode";

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

describe("DockerService.splitImageReference", () => {
  test("parses normal image tags", () => {
    expect(DockerService.splitImageReference("ghcr.io/esphome/esphome:latest")).toEqual({
      image: "ghcr.io/esphome/esphome",
      tag: "latest",
    });
  });

  test("preserves registry ports when parsing image tags", () => {
    expect(DockerService.splitImageReference("registry.local:5000/team/app:1.2.3")).toEqual({
      image: "registry.local:5000/team/app",
      tag: "1.2.3",
    });
  });

  test("handles digest-pinned image references", () => {
    expect(DockerService.splitImageReference("ghcr.io/example/app@sha256:abcdef123456")).toEqual({
      image: "ghcr.io/example/app",
      tag: "latest",
      digest: "sha256:abcdef123456",
    });
  });

  test("falls back safely when image references are missing", () => {
    expect(DockerService.splitImageReference(undefined)).toEqual({
      image: "unknown",
      tag: "latest",
    });
  });
});
