import { ImageRegistryAdapter } from './ImageRegistryAdapter';

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
        const parts = image.split("/");
        const isDockerIo = parts[0].includes("docker.io");
        const isDefaultDocker = parts.length === 1 || (parts.length === 2 && !parts[0].includes("."));
        
        return isDockerIo || isDefaultDocker;
    }

    private getImageUrl(): string {
        const parts = this.image.split("/");

        if (parts.length === 1) {
            // If the image name doesn't include a '/', it's an official library image
            return `${DockerhubAdapter.DOCKER_API_URL}/library/${this.image}/tags?name=${this.tag}`;
        } else {
            // If the image name includes a '/', it's a user image
            return `${DockerhubAdapter.DOCKER_API_URL}/${this.image}/tags?name=${this.tag}`;
        }
    }

    async checkForNewDigest(): Promise<{ newDigest: string; isDifferent: boolean }> {
        try {
            const response = await this.http.get(this.getImageUrl());
            const newDigest = this.removeSHA256Prefix(response.data.results[0].images[0].digest);

            const isDifferent = this.oldDigest !== newDigest;

            return { newDigest, isDifferent };
        } catch (error) {
            console.error(`Failed to check for new Dockerhub image digest: ${error}`);
            throw error;
        }
    }
}
