import logger from "../services/LoggerService";
import { ImageRegistryAdapter } from "./ImageRegistryAdapter";
import axios from "axios";

export class LscrAdapter extends ImageRegistryAdapter {
    private static readonly DOCKER_API_URL = 'https://hub.docker.com/v2/repositories';
    private static readonly REGISTRY_API_URL = 'https://registry-1.docker.io/v2';
    private tag: string;

    constructor(image: string, tag: string = 'latest', accessToken?: string) {
        super(image, accessToken);
        this.tag = tag;
    }

    static get displayName() {
        return 'LinuxServer.io';
    }

    static canHandleImage(image: string): boolean {
        try {
            const url = new URL(`https://${image}`);
            const host = url.hostname;
            // check if the host is exactly 'lcsr.io'
            const isLcsrIo = host === 'lscr.io';

            return isLcsrIo;
        } catch (error) {
            // if the image string is not a valid URL, it's not a LinuxServer.io image
            return false;
        }
    }

    private getImageUrl(): string {
        const image = this.image.replace('lscr.io/', '');

        return `${LscrAdapter.DOCKER_API_URL}/${image}/tags?name=${this.tag}`;
    }

    async checkForNewDigest(): Promise<{ newDigest: string; }> {
        try {
            let response = await this.http.get(this.getImageUrl());
            let newDigest = null;

            let images = response.data.results[0].images;
            if (images && images.length > 0) {
                newDigest = response.data.results[0].digest.split(":")[1];
            } else {
                logger.error("No Images found");
                logger.error(response);
            }

            return { newDigest };
        } catch (error) {
            logger.error(`Failed to check for new lscr.io image digest: ${error}`);
            throw error;
        }
    }

    /**
     * Resolves the org.opencontainers.image.version label of the tracked tag
     * by fetching its manifest and config blob from Docker Hub's registry API
     */
    async getVersionLabel(): Promise<string | null> {
        try {
            const repoPath = this.image.replace('lscr.io/', '');
            const tokenResponse = await axios.get(
                `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repoPath}:pull`
            );
            const headers = { Authorization: `Bearer ${tokenResponse.data.token}` };

            const indexResponse = await axios.get(`${LscrAdapter.REGISTRY_API_URL}/${repoPath}/manifests/${this.tag}`, {
                headers: { ...headers, Accept: 'application/json' },
            });

            let configDigest = indexResponse.data?.config?.digest;
            if (!configDigest) return null;

            const configResponse = await axios.get(`${LscrAdapter.REGISTRY_API_URL}/${repoPath}/blobs/${configDigest}`, { headers });
            return configResponse.data?.config?.Labels?.["org.opencontainers.image.version"] ?? null;
        } catch (error) {
            return null;
        }
    }
}