import logger from "../services/LoggerService";
import { ImageRegistryAdapter } from "./ImageRegistryAdapter";

export class DockerhubAdapter extends ImageRegistryAdapter {
    private static readonly DOCKER_API_URL = 'https://hub.docker.com/v2/repositories';
    private tag: string;

    constructor(image: string, tag: string = 'latest', accessToken?: string) {
        super(image, accessToken);
        this.tag = tag;
    }

    static get displayName() {
        return 'DockerHub';
    }

    static canHandleImage(image: string): boolean {
        try {
            const url = new URL(`https://${image}`);
            const host = url.hostname;
    
            // check if the host is exactly 'docker.io'
            const isDockerIo = host === 'docker.io';
    
            const parts = image.split("/");
            const isDefaultDocker = parts.length === 1 || (parts.length === 2 && !parts[0].includes("."));
    
            return isDockerIo || isDefaultDocker;
        } catch (error) {
            // if the image string is not a valid URL, it's not a Docker image
            return false;
        }
    }

    private getImageUrl(): string {
        const parts = this.image.split("/");
        let repoPath: string;

        if (parts.length === 1) {
            // Official Docker library image (e.g., "nginx")
            repoPath = `library/${parts[0]}`;
        } else if (parts[0].includes(".") || parts[0].includes(":")) {
            // Has a registry prefix (e.g., "docker.io/user/image" or "my-registry.com/user/image")
            repoPath = parts.slice(1).join("/");
        } else {
            // No registry prefix, just user/image
            repoPath = parts.join("/");
        }

        return `${DockerhubAdapter.DOCKER_API_URL}/${repoPath}/tags/${this.tag}`;
    }
    
    async checkForNewDigest(): Promise<{ newDigest: string; }> {
        try {
            let response = await this.http.get(this.getImageUrl());
            let newDigest = null;

            let images = response.data.images;
            if (images && images.length > 0) {
                newDigest = response.data.digest.split(":")[1];
            } else {
                logger.error("No Images found");
                logger.error(response);
            }

            return { newDigest};
        } catch (error) {
            logger.error(`Failed to check for new Docker image digest: ${error}`);
            logger.warn(`This might be a locally generated image. To prevent similar issues, exclude it from future MqDockerUp checks (see docs)`);
            throw error;
        }
    }
}