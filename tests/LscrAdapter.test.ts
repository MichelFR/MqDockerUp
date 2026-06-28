const mockGet = jest.fn();

jest.mock("axios", () => ({
  create: jest.fn(() => ({ get: mockGet })),
}));

import { LscrAdapter } from "../src/registry-factory/LscrAdapter";

describe('LscrAdapter', () => {
  test('canHandleImage should return true for lscr images', () => {
    expect(LscrAdapter.canHandleImage('lscr.io/user/image:latest')).toBe(true);
    expect(LscrAdapter.canHandleImage('lscr.io/user/image')).toBe(true);
  });

  test('canHandleImage should return false for non-lscr images', () => {
    expect(LscrAdapter.canHandleImage('unsupported.registry.com/user/image')).toBe(false);
  });

  test('canHandleImage should return false for DockerHub images without explicit registry', () => {
    expect(LscrAdapter.canHandleImage('library/image')).toBe(false);
    expect(LscrAdapter.canHandleImage('user/image')).toBe(false);
    expect(LscrAdapter.canHandleImage('image')).toBe(false);
  });

  describe('getImageUrl', () => {
    it('should return the correct URL for a lscr image', () => {
      const adapter = new LscrAdapter('lscr.io/user/image');
      const url = adapter['getImageUrl']();

      expect(url).toEqual('https://hub.docker.com/v2/repositories/user/image/tags?name=latest');
    });

    it('should return the correct URL with a custom tag', () => {
      const adapter = new LscrAdapter('lscr.io/user/image', 'customTag');
      const url = adapter['getImageUrl']();

      expect(url).toEqual('https://hub.docker.com/v2/repositories/user/image/tags?name=customTag');
    });

    it('should return the correct URL with latest tag', () => {
      const adapter = new LscrAdapter('lscr.io/user/image', 'latest');
      const url = adapter['getImageUrl']();

      expect(url).toEqual('https://hub.docker.com/v2/repositories/user/image/tags?name=latest');
    });
  });

  describe('getVersionLabel', () => {
    const repoPath = 'lscr-test/backend';

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

      const adapter = new LscrAdapter(`lscr.io/${repoPath}`, 'latest');
      const result = await adapter.getVersionLabel();

      expect(result).toBe('2.15.3');
      expect(mockGet).toHaveBeenCalledWith(
        `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repoPath}:pull`
      );
    });

    it('returns null when the config blob has no version label', async () => {
      mockRegistryFlow(null);

      const adapter = new LscrAdapter(`lscr.io/${repoPath}`, 'latest');
      const result = await adapter.getVersionLabel();

      expect(result).toBeNull();
    });
  });
});
