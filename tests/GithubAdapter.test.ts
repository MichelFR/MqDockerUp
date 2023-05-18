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
});
