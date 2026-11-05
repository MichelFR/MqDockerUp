import axios from "axios";

export default class PullProgressService {
  public static async getLayerSizes(image: string, os: string, architecture: string): Promise<Record<string, number> | null> {
    try {
      const parts = image.split("/");
      const explicitRegistry = parts.length > 1 && (parts[0].includes(".") || parts[0].includes(":"));
      const registry = explicitRegistry ? parts.shift()! : "docker.io";
      const reference = parts.join("/");
      const at = reference.indexOf("@");
      const colon = reference.lastIndexOf(":");
      let repository = at >= 0 ? reference.slice(0, at) : colon >= 0 ? reference.slice(0, colon) : reference;
      const tag = at >= 0 ? reference.slice(at + 1) : colon >= 0 ? reference.slice(colon + 1) : "latest";
      if (registry === "docker.io" && !repository.includes("/")) repository = `library/${repository}`;
      const host = registry === "docker.io" ? "registry-1.docker.io" : registry;
      const options = { headers: {
        Authorization: "",
        Accept: "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
      }, timeout: 10000, maxRedirects: 0, validateStatus: (status: number) => status === 200 || status === 401 };
      const getManifest = async (reference: string) => {
        const url = `https://${host}/v2/${repository}/manifests/${reference}`;
        let response = await axios.get(url, options);
        if (response.status === 401) {
          const challenge = response.headers["www-authenticate"];
          if (typeof challenge !== "string" || !/^Bearer\s/i.test(challenge)) throw new Error("Unsupported registry authentication");
          const params: Record<string, string> = {};
          for (const match of challenge.matchAll(/([a-z_]+)="((?:[^"\\]|\\.)*)"/gi)) {
            params[match[1].toLowerCase()] = JSON.parse(`"${match[2]}"`);
          }
          const realm = new URL(params.realm);
          if (realm.protocol !== "https:" || realm.username || realm.password) throw new Error("Unsafe token endpoint");
          const token = await axios.get(realm.href, {
            params: { service: params.service, scope: `repository:${repository}:pull` },
            timeout: 10000, maxRedirects: 0,
          });
          const bearer = token.data.token || token.data.access_token;
          if (typeof bearer !== "string" || !bearer) throw new Error("Registry token unavailable");
          options.headers.Authorization = `Bearer ${bearer}`;
          response = await axios.get(url, options);
        }
        if (response.status !== 200) throw new Error("Manifest unavailable");
        return response.data;
      };
      let manifest = await getManifest(tag);
      if (Array.isArray(manifest.manifests)) {
        const arm = /^armv([5-8])l$/.exec(architecture);
        const arch = architecture === "x86_64" ? "amd64" : architecture === "aarch64" ? "arm64" : arm ? "arm" : architecture;
        const matches = manifest.manifests.filter((entry: any) => entry.platform?.os === os && entry.platform?.architecture === arch && (!arm || entry.platform?.variant === `v${arm[1]}`));
        if (matches.length !== 1) return null;
        manifest = await getManifest(matches[0].digest);
      }
      if (!Array.isArray(manifest.layers) || !manifest.layers.length) return null;
      const sizes: Record<string, number> = {};
      const digests: Record<string, string> = {};
      for (const layer of manifest.layers) {
        if (!/^sha(?:256|512):[a-f0-9]+$/.test(layer.digest) || !Number.isSafeInteger(layer.size) || layer.size < 0) return null;
        const hash = layer.digest.split(":")[1];
        if (hash.length !== (layer.digest.startsWith("sha256:") ? 64 : 128)) return null;
        const id = hash.slice(0, 12);
        if (id in sizes && (digests[id] !== layer.digest || sizes[id] !== layer.size)) return null;
        digests[id] = layer.digest;
        sizes[id] = layer.size;
      }
      return sizes;
    } catch {
      // Private, unsupported or unavailable registries retain indeterminate progress.
      return null;
    }
  }
}
