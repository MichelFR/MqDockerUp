const mockGet = jest.fn();

jest.mock("axios", () => ({
  create: jest.fn(() => ({ get: mockGet })),
  get: mockGet,
}));

import { DockerhubAdapter } from "../src/registry-factory/DockerhubAdapter";

describe('DockerHubAdapter', () => {
  test('canHandleImage should return true for DockerHub images', () => {
    expect(DockerhubAdapter.canHandleImage('docker.io/user/image')).toBe(true);
    expect(DockerhubAdapter.canHandleImage('user/image')).toBe(true);
    expect(DockerhubAdapter.canHandleImage('image')).toBe(true);
  });

  test('canHandleImage should return false for non-DockerHub images', () => {
    expect(DockerhubAdapter.canHandleImage('unsupported.registry.com/image')).toBe(false);
  });

  test('canHandleImage should return true for DockerHub images without explicit registry', () => {
    expect(DockerhubAdapter.canHandleImage('library/image')).toBe(true);
    expect(DockerhubAdapter.canHandleImage('user/image')).toBe(true);
    expect(DockerhubAdapter.canHandleImage('image')).toBe(true);
  });

  describe('getImageUrl', () => {
    it('should return the correct URL for an official library image', () => {
      const adapter = new DockerhubAdapter('officialImage');
      const url = adapter['getImageUrl']();

      expect(url).toEqual('https://hub.docker.com/v2/repositories/library/officialImage/tags/latest');
    });

    it('should return the correct URL for a user image', () => {
      const adapter = new DockerhubAdapter('user/image');
      const url = adapter['getImageUrl']();

      expect(url).toEqual('https://hub.docker.com/v2/repositories/user/image/tags/latest');
    });

    it('should return the correct URL with a custom tag', () => {
      const adapter = new DockerhubAdapter('officialImage', 'customTag');
      const url = adapter['getImageUrl']();

      expect(url).toEqual('https://hub.docker.com/v2/repositories/library/officialImage/tags/customTag');
    });
  });

  describe('getVersionLabel', () => {
    const repoPath = 'dockerhub-test/backend';

    function mockRegistryFlow(version: string | null) {
      mockGet.mockImplementation((url: string) => {
        if (url === `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repoPath}:pull`) {
          return Promise.resolve({ data: { token: 'test-token' } });
        }
        if (url === `https://registry-1.docker.io/v2/${repoPath}/manifests/latest`) {
          return Promise.resolve({ data: { config: { digest: 'sha256:configdigest' } } });
        }
        if (url === `https://registry-1.docker.io/v2/${repoPath}/blobs/sha256:configdigest`) {
          const labels = version ? { "org.opencontainers.image.version": version } : {};
          return Promise.resolve({ data: { config: { Labels: labels } } });
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });
    }

    beforeEach(() => {
      mockGet.mockReset();
    });

    it('resolves newVersion from the registry config blob', async () => {
      mockRegistryFlow('2.15.3');

      const adapter = new DockerhubAdapter(repoPath, 'latest');
      const result = await adapter.getVersionLabel();

      expect(result).toBe('2.15.3');
      expect(mockGet).toHaveBeenCalledWith(
        `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repoPath}:pull`
      );
    });

    it('returns null when the config blob has no version label', async () => {
      mockRegistryFlow(null);

      const adapter = new DockerhubAdapter(repoPath, 'latest');
      const result = await adapter.getVersionLabel();

      expect(result).toBeNull();
    });
  });
});
