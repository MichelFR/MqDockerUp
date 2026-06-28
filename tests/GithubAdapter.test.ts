const mockGet = jest.fn();

jest.mock("axios", () => ({
  create: jest.fn(() => ({ get: mockGet, defaults: { headers: {} } })),
}));

jest.mock("../src/services/ConfigService", () => ({
  __esModule: true,
  default: {
    getConfig: () => ({
      accessTokens: { github: "test-token" },
    }),
  },
}));

import { GithubAdapter } from "../src/registry-factory/GithubAdapter";

describe('GithubAdapter', () => {
  test('canHandleImage should return true for ghcr images', () => {
    expect(GithubAdapter.canHandleImage('ghcr.io/user/image:latest')).toBe(true);
    expect(GithubAdapter.canHandleImage('ghcr.io/user/image')).toBe(true);
  });

  test('canHandleImage should return false for non-ghcr images', () => {
    expect(GithubAdapter.canHandleImage('unsupported.registry.com/user/image')).toBe(false);
  });

  test('canHandleImage should return false for DockerHub images without explicit registry', () => {
    expect(GithubAdapter.canHandleImage('library/image')).toBe(false);
    expect(GithubAdapter.canHandleImage('user/image')).toBe(false);
    expect(GithubAdapter.canHandleImage('image')).toBe(false);
  });

  describe('getImageUrl', () => {
    it('should return the correct URL for a ghcr image', () => {
      const adapter = new GithubAdapter('ghcr.io/user/image');
      const url = adapter['getImageUrl']();

      expect(url).toEqual('https://ghcr.io/v2/user/image/manifests/latest');
    });

    it('should return the correct URL with a custom tag', () => {
      const adapter = new GithubAdapter('ghcr.io/user/image', 'customTag');
      const url = adapter['getImageUrl']();

      expect(url).toEqual('https://ghcr.io/v2/user/image/manifests/customTag');
    });

    it('should return the correct URL with latest tag', () => {
      const adapter = new GithubAdapter('ghcr.io/user/image', 'latest');
      const url = adapter['getImageUrl']();

      expect(url).toEqual('https://ghcr.io/v2/user/image/manifests/latest');
    });
  });

  describe('getVersionLabel', () => {
    beforeEach(() => {
      mockGet.mockReset();
    });

    it('resolves newVersion from the config blob', async () => {
      mockGet.mockImplementation((url: string) => {
        if (url === 'https://ghcr.io/v2/user/image/manifests/latest') {
          return Promise.resolve({ data: { config: { digest: 'sha256:configdigest' } } });
        }
        if (url === 'https://ghcr.io/v2/user/image/blobs/sha256:configdigest') {
          return Promise.resolve({ data: { config: { Labels: { "org.opencontainers.image.version": "2.15.3" } } } });
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });

      const adapter = new GithubAdapter('ghcr.io/user/image', 'latest');
      const result = await adapter.getVersionLabel();

      expect(result).toBe('2.15.3');
    });

    it('returns null when the config blob has no version label', async () => {
      mockGet.mockImplementation((url: string) => {
        if (url === 'https://ghcr.io/v2/user/image/manifests/latest') {
          return Promise.resolve({ data: { config: { digest: 'sha256:configdigest' } } });
        }
        if (url === 'https://ghcr.io/v2/user/image/blobs/sha256:configdigest') {
          return Promise.resolve({ data: { config: { Labels: {} } } });
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });

      const adapter = new GithubAdapter('ghcr.io/user/image', 'latest');
      const result = await adapter.getVersionLabel();

      expect(result).toBeNull();
    });
  });
});
