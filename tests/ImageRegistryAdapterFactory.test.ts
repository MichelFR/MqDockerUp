import { DockerhubAdapter } from "../src/registry-factory/DockerhubAdapter";
import { ImageRegistryAdapterFactory } from "../src/registry-factory/ImageRegistryAdapterFactory";

describe('ImageRegistryAdapterFactory', () => {
  test('getAdapter should return DockerHubAdapter for DockerHub images', () => {
    expect(ImageRegistryAdapterFactory.getAdapter('docker.io/user/image') instanceof DockerhubAdapter).toBe(true);
    expect(ImageRegistryAdapterFactory.getAdapter('user/image') instanceof DockerhubAdapter).toBe(true);
    expect(ImageRegistryAdapterFactory.getAdapter('image') instanceof DockerhubAdapter).toBe(true);
  });

  test('getAdapter should throw an error for non-supported images', () => {
    expect(() => ImageRegistryAdapterFactory.getAdapter('unsupported.registry.com/image')).toThrow();
  });

  test('getRegistryName should return DockerHub for DockerHub images', () => {
    expect(ImageRegistryAdapterFactory.getRegistryName('docker.io/user/image')).toBe('DockerHub');
    expect(ImageRegistryAdapterFactory.getRegistryName('user/image')).toBe('DockerHub');
    expect(ImageRegistryAdapterFactory.getRegistryName('image')).toBe('DockerHub');
  });

  test('getRegistryName should throw an error for non-supported images', () => {
    expect(() => ImageRegistryAdapterFactory.getRegistryName('unsupported.registry.com/image')).toThrow();
  });
});
