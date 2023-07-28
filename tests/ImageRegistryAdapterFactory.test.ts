import { DockerhubAdapter } from "../src/registry-factory/DockerhubAdapter";
import { GithubAdapter } from "../src/registry-factory/GithubAdapter";
import { ImageRegistryAdapterFactory } from "../src/registry-factory/ImageRegistryAdapterFactory";
import { LscrAdapter } from "../src/registry-factory/LscrAdapter";

describe('ImageRegistryAdapterFactory', () => {
  test('getAdapter should return DockerHubAdapter for DockerHub images', () => {
    expect(ImageRegistryAdapterFactory.getAdapter('docker.io/user/image') instanceof DockerhubAdapter).toBe(true);
    expect(ImageRegistryAdapterFactory.getAdapter('user/image') instanceof DockerhubAdapter).toBe(true);
    expect(ImageRegistryAdapterFactory.getAdapter('image') instanceof DockerhubAdapter).toBe(true);
  });

  test('getAdapter should return DockerHubAdapter for GitHub images', () => {
    expect(ImageRegistryAdapterFactory.getAdapter('ghcr.io/user/image') instanceof GithubAdapter).toBe(true);
  });

  test('getAdapter should return DockerHubAdapter for LinuxServer images', () => {
    expect(ImageRegistryAdapterFactory.getAdapter('lscr.io/user/image') instanceof LscrAdapter).toBe(true);
  });

  test('getAdapter should throw an error for non-supported images', () => {
    expect(() => ImageRegistryAdapterFactory.getAdapter('unsupported.registry.com/image')).toThrow();
  });

  test('getRegistryName should return DockerHub for DockerHub images', () => {
    expect(ImageRegistryAdapterFactory.getRegistryName('docker.io/user/image')).toBe('DockerHub');
    expect(ImageRegistryAdapterFactory.getRegistryName('user/image')).toBe('DockerHub');
    expect(ImageRegistryAdapterFactory.getRegistryName('image')).toBe('DockerHub');
  });

  test('getRegistryName should return DockerHub for GitHub images', () => {
    expect(ImageRegistryAdapterFactory.getRegistryName('ghcr.io/user/image')).toBe('Github Packages');
  });

  test('getRegistryName should return DockerHub for LinuxServer images', () => {
    expect(ImageRegistryAdapterFactory.getRegistryName('lscr.io/user/image')).toBe('LinuxServer.io');
  });


  test('getRegistryName should return "Not Found" for non-supported images', () => {
    expect(ImageRegistryAdapterFactory.getRegistryName('unsupported.registry.com/image')).toBe('Not Found');
  });
});
