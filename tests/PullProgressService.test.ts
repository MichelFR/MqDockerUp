jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn() } }));
import axios from "axios";
import PullProgressService from "../src/services/PullProgressService";

describe("manifest layer sizes", () => {
  beforeEach(() => jest.resetAllMocks());
  test("uses the matching platform manifest and its compressed layer sizes", async () => {
    const get = axios.get as jest.Mock;
    get.mockResolvedValueOnce({ status: 200, data: { manifests: [
        { digest: "sha256:arm", platform: { os: "linux", architecture: "arm64" } },
        { digest: "sha256:amd", platform: { os: "linux", architecture: "amd64" } },
      ] } })
      .mockResolvedValueOnce({ status: 200, data: { layers: [{ digest: `sha256:${"a".repeat(64)}`, size: 1234 }] } });
    expect(await PullProgressService.getLayerSizes("httpd:2.4-alpine", "linux", "x86_64")).toEqual({ aaaaaaaaaaaa: 1234 });
    expect(get.mock.calls[1][0]).toContain("/library/httpd/manifests/sha256:amd");
  });
  test("uses indeterminate progress when registry metadata is unavailable", async () => {
    (axios.get as jest.Mock).mockRejectedValue(new Error("unavailable"));
    expect(await PullProgressService.getLayerSizes("ghcr.io/example/image:dev", "linux", "amd64")).toBeNull();
  });
  test("does not guess an ambiguous platform", async () => {
    (axios.get as jest.Mock).mockResolvedValueOnce({ status: 200, data: { manifests: [] } });
    expect(await PullProgressService.getLayerSizes("httpd", "linux", "amd64")).toBeNull();
  });
  test.each([
    ["httpd:latest", "registry-1.docker.io", "library/httpd"],
    ["ghcr.io/tphakala/birdnet-go:dev", "ghcr.io", "tphakala/birdnet-go"],
    ["lscr.io/linuxserver/sonarr:latest", "lscr.io", "linuxserver/sonarr"],
    ["registry.example:5443/team/nested/image:release", "registry.example:5443", "team/nested/image"],
  ])("follows standard bearer authentication for %s", async (image, host, repository) => {
    const get = axios.get as jest.Mock;
    get.mockResolvedValueOnce({ status: 401, headers: { "www-authenticate": 'Bearer realm="https://auth.example/token",service="registry.example"' } })
      .mockResolvedValueOnce({ data: { access_token: "test" } })
      .mockResolvedValueOnce({ status: 200, data: { layers: [{ digest: `sha256:${"a".repeat(64)}`, size: 1234 }] } });
    expect(await PullProgressService.getLayerSizes(image, "linux", "amd64")).toEqual({ aaaaaaaaaaaa: 1234 });
    expect(get.mock.calls[0][0]).toContain(`https://${host}/v2/${repository}/manifests/`);
    expect(get.mock.calls[1][1].params.scope).toBe(`repository:${repository}:pull`);
    expect(get.mock.calls[2][1].headers.Authorization).toBe("Bearer test");
  });
  test.each([0, 32, 1234])("counts duplicate layers of size %s once", async size => {
    const layer = { digest: `sha256:${"a".repeat(64)}`, size };
    (axios.get as jest.Mock).mockResolvedValueOnce({ status: 200, data: { layers: [layer, layer] } });
    expect(await PullProgressService.getLayerSizes("httpd", "linux", "amd64")).toEqual({ aaaaaaaaaaaa: size });
  });
  test("rejects conflicting sizes for the same blob", async () => {
    const digest = `sha256:${"a".repeat(64)}`;
    (axios.get as jest.Mock).mockResolvedValueOnce({ status: 200, data: { layers: [{ digest, size: 32 }, { digest, size: 33 }] } });
    expect(await PullProgressService.getLayerSizes("httpd", "linux", "amd64")).toBeNull();
  });
  test("rejects ambiguous shortened layer IDs", async () => {
    (axios.get as jest.Mock).mockResolvedValueOnce({ status: 200, data: { layers: [
      { digest: `sha256:${"a".repeat(64)}`, size: 32 },
      { digest: `sha256:${"a".repeat(12)}${"b".repeat(52)}`, size: 32 },
    ] } });
    expect(await PullProgressService.getLayerSizes("httpd", "linux", "amd64")).toBeNull();
  });
  test("does not follow an insecure token endpoint", async () => {
    (axios.get as jest.Mock).mockResolvedValueOnce({ status: 401, headers: { "www-authenticate": 'Bearer realm="http://auth.example/token"' } });
    expect(await PullProgressService.getLayerSizes("httpd", "linux", "amd64")).toBeNull();
    expect(axios.get).toHaveBeenCalledTimes(1);
  });
  test("selects the actual ARM variant", async () => {
    const get = axios.get as jest.Mock;
    get.mockResolvedValueOnce({ status: 200, data: { manifests: [
      { digest: "sha256:arm6", platform: { os: "linux", architecture: "arm", variant: "v6" } },
      { digest: "sha256:arm7", platform: { os: "linux", architecture: "arm", variant: "v7" } },
    ] } }).mockResolvedValueOnce({ status: 200, data: { layers: [{ digest: `sha256:${"a".repeat(64)}`, size: 1 }] } });
    expect(await PullProgressService.getLayerSizes("httpd", "linux", "armv7l")).toEqual({ aaaaaaaaaaaa: 1 });
    expect(get.mock.calls[1][0]).toContain("sha256:arm7");
  });
  test("supports immutable digest references and SHA-512 blob descriptors", async () => {
    const digest = `sha512:${"a".repeat(128)}`;
    (axios.get as jest.Mock).mockResolvedValueOnce({ status: 200, data: { layers: [{ digest, size: 1 }] } });
    expect(await PullProgressService.getLayerSizes(`ghcr.io/team/nested/image@${digest}`, "linux", "amd64")).toEqual({ aaaaaaaaaaaa: 1 });
    expect((axios.get as jest.Mock).mock.calls[0][0]).toContain(`/team/nested/image/manifests/${digest}`);
  });
  test.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid byte count %s", async size => {
    (axios.get as jest.Mock).mockResolvedValueOnce({ status: 200, data: { layers: [{ digest: `sha256:${"a".repeat(64)}`, size }] } });
    expect(await PullProgressService.getLayerSizes("httpd", "linux", "amd64")).toBeNull();
  });
  test("denied token access falls back without leaking credentials or breaking updates", async () => {
    (axios.get as jest.Mock).mockResolvedValueOnce({ status: 401, headers: { "www-authenticate": 'Bearer realm="https://auth.example/token"' } })
      .mockRejectedValueOnce(new Error("access denied"));
    expect(await PullProgressService.getLayerSizes("registry.example/team/private", "linux", "amd64")).toBeNull();
    expect((axios.get as jest.Mock).mock.calls[1][1].headers).toBeUndefined();
  });
});
