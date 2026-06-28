import ConfigService from "../services/ConfigService";
import logger from "../services/LoggerService";
import { ImageRegistryAdapter } from "./ImageRegistryAdapter";

const config = ConfigService.getConfig();

export class GithubAdapter extends ImageRegistryAdapter {
    private tag: string;

    constructor(image: string, tag: string = 'latest') {
        const accessToken =  config?.accessTokens?.github;

        super(image, accessToken);
        this.tag = tag;

        if (!accessToken) {
            logger.error('Github access token is not defined');
        }

    }

    static get displayName() {
        return 'Github Packages';
    }

    static canHandleImage(image: string): boolean {
        try {
            const url = new URL(`https://${image}`);
            const host = url.hostname;

            // check if the host is exactly 'ghcr.io'
            return host === 'ghcr.io';
        } catch (error) {
            // if the image string is not a valid URL, it's not a Github image
            return false;
        }
    }

    private getImageUrl(): string {
        const parts = this.image.split(':')[0].split('/');
        const registry = parts[0];
        const repoPath = parts.slice(1).join('/');
        return `https://${registry}/v2/${repoPath}/manifests/${this.tag}`;
    }

    private getBlobUrl(digest: string): string {
        const parts = this.image.split(':')[0].split('/');
        const registry = parts[0];
        const repoPath = parts.slice(1).join('/');
        return `https://${registry}/v2/${repoPath}/blobs/${digest}`;
    }

    async checkForNewDigest(): Promise<{ newDigest: string; }> {
        const accessTokenSet = !!config?.accessTokens?.github;
        if (accessTokenSet) {
            try {
                this.http.defaults.headers['Accept'] = 'application/vnd.oci.image.index.v1+json';

                const response = await this.http.get(this.getImageUrl());
                const newDigest = this.removeSHA256Prefix(response.headers['docker-content-digest']);

                return { newDigest };
            } catch (error) {
                logger.error(`Failed to check for new Github image digest: ${error}`);
                throw error;
            }
        }

        return { newDigest: "" };
    }

    /**
     * Resolves the org.opencontainers.image.version label of the tracked tag
     * by fetching its manifest and config blob
     */
    async getVersionLabel(): Promise<string | null> {
        try {
            const indexResponse = await this.http.get(this.getImageUrl(), {
                headers: { Accept: 'application/json' },
            });

            let configDigest = indexResponse.data?.config?.digest;
            if (!configDigest) return null;

            const configResponse = await this.http.get(this.getBlobUrl(configDigest));
            return configResponse.data?.config?.Labels?.["org.opencontainers.image.version"] ?? null;
        } catch (error) {
            return null;
        }
    }
}
