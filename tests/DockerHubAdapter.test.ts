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

  describe('checkForNewDigest', () => {
    it('should return the new digest and isDifferent flag = true', async () => {
      const adapter = new DockerhubAdapter('image', 'latest', 'accessToken');
      adapter['oldDigest'] = 'oldDigest';
      const result = await adapter.checkForNewDigest();

      expect(result).toEqual({
        newDigest: 'mockDigest',
        isDifferent: true, // Assuming oldDigest and newDigest are different
      });
    });

    it('should return the new digest and isDifferent flag = false', async () => {
      const adapter = new DockerhubAdapter('image', 'latest', 'accessToken');
      adapter['oldDigest'] = 'mockDigest';
      const result = await adapter.checkForNewDigest();

      expect(result).toEqual({
        newDigest: 'mockDigest',
        isDifferent: false // Assuming oldDigest and newDigest are the same
      });
    });

    describe('getImageUrl', () => {
      it('should return the correct URL for an official library image', () => {
        const adapter = new DockerhubAdapter('officialImage');
        const url = adapter['getImageUrl']();

        expect(url).toEqual('https://hub.docker.com/v2/repositories/library/officialImage/tags?name=latest');
      });

      it('should return the correct URL for a user image', () => {
        const adapter = new DockerhubAdapter('user/image');
        const url = adapter['getImageUrl']();

        expect(url).toEqual('https://hub.docker.com/v2/repositories/user/image/tags?name=latest');
      });

      it('should return the correct URL with a custom tag', () => {
        const adapter = new DockerhubAdapter('officialImage', 'customTag');
        const url = adapter['getImageUrl']();

        expect(url).toEqual('https://hub.docker.com/v2/repositories/library/officialImage/tags?name=customTag');
      });
    });
  });
});
