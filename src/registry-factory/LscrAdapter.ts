import { ImageRegistryAdapter } from './ImageRegistryAdapter';

export class LscrAdapter extends ImageRegistryAdapter {
    private static readonly DOCKER_API_URL = 'https://hub.docker.com/v2/repositories';
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

    async checkForNewDigest(): Promise<{ newDigest: string; isDifferent: boolean }> {
        try {
            let response = await this.http.get(this.getImageUrl());
            let newDigest = null;

            let images = response.data.results[0].images;
            if (images && images.length > 0) {
                newDigest = response.data.results[0].digest.split(":")[1];
            } else {
                console.log("No Images found");
                console.log(response);
            }

            const isDifferent = this.oldDigest !== newDigest;

            return { newDigest, isDifferent };
        } catch (error) {
            console.error(`Failed to check for new lscr.io image digest: ${error}`);
            throw error;
        }
    }
}
