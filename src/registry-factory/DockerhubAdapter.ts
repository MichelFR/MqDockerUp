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

        if (parts.length === 1) {
            // If the image name doesn't include a '/', it's an official library image
            return `${DockerhubAdapter.DOCKER_API_URL}/library/${this.image}/tags/${this.tag}`;
        } else {
            // If the image name includes a '/', it's a user image
            return `${DockerhubAdapter.DOCKER_API_URL}/${this.image}/tags/${this.tag}`;
        }
    }

    async checkForNewDigest(): Promise<{ newDigest: string; isDifferent: boolean }> {
        try {
            let response = await this.http.get(this.getImageUrl());
            let newDigest = null;

            let images = response.data.images;
            if (images && images.length > 0) {
                newDigest = response.data.digest.split(":")[1];
            } else {
                console.log("No Images found");
                console.log(response);
            }

            const isDifferent = this.oldDigest !== newDigest;

            return { newDigest, isDifferent };
        } catch (error) {
            console.error(`Failed to check for new Dockerhub image digest: ${error}`);
            console.warn(`This might be a locally generated image. To prevent similar issues, add \`mqdockerup.ignore=true\` label to exclude it from future MqDockerUp checks`)
            throw error;
        }
    }
}
