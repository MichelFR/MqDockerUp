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
});
