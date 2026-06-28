const mockGet = jest.fn();

jest.mock("axios", () => ({
  create: jest.fn(() => ({ get: mockGet })),
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

  describe('checkForNewDigest', () => {
    beforeEach(() => {
      mockGet.mockReset();
    });

    it('resolves the digest without resolving a version label', async () => {
      mockGet.mockResolvedValue({ data: { digest: 'sha256:abc123', images: [{}] } });

      const adapter = new DockerhubAdapter('dockerhub-test-1/backend', 'latest');
      const result = await adapter.checkForNewDigest();

      expect(result).toEqual({ newDigest: 'abc123' });
      expect(mockGet).toHaveBeenCalledTimes(1);
    });
  });

  describe('getVersionLabel', () => {
    beforeEach(() => {
      mockGet.mockReset();
    });

    it('resolves newVersion from the registry config blob', async () => {
      mockGet.mockImplementation((url: string) => {
        if (url.startsWith('https://auth.docker.io/token')) {
          return Promise.resolve({ data: { token: 'test-token' } });
        }
        if (url === 'https://registry-1.docker.io/v2/dockerhub-test-1/backend/manifests/latest') {
          return Promise.resolve({ data: { config: { digest: 'sha256:configdigest' } } });
        }
        if (url === 'https://registry-1.docker.io/v2/dockerhub-test-1/backend/blobs/sha256:configdigest') {
          return Promise.resolve({ data: { config: { Labels: { "org.opencontainers.image.version": "2.15.3" } } } });
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });

      const adapter = new DockerhubAdapter('dockerhub-test-1/backend', 'latest');
      const result = await adapter.getVersionLabel();

      expect(result).toBe('2.15.3');
      expect(mockGet).toHaveBeenCalledWith(
        'https://auth.docker.io/token?service=registry.docker.io&scope=repository:dockerhub-test-1/backend:pull'
      );
    });

    it('returns null when the config blob has no version label', async () => {
      mockGet.mockImplementation((url: string) => {
        if (url.startsWith('https://auth.docker.io/token')) {
          return Promise.resolve({ data: { token: 'test-token' } });
        }
        if (url === 'https://registry-1.docker.io/v2/dockerhub-test-3/backend/manifests/latest') {
          return Promise.resolve({ data: { config: { digest: 'sha256:configdigest' } } });
        }
        if (url === 'https://registry-1.docker.io/v2/dockerhub-test-3/backend/blobs/sha256:configdigest') {
          return Promise.resolve({ data: { config: { Labels: {} } } });
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });

      const adapter = new DockerhubAdapter('dockerhub-test-3/backend', 'latest');
      const result = await adapter.getVersionLabel();

      expect(result).toBeNull();
    });
  });
});
