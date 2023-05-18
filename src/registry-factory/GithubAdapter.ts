import { ImageRegistryAdapter } from './ImageRegistryAdapter';

export class GithubAdapter extends ImageRegistryAdapter {
    private tag: string;

    constructor(image: string, tag: string = 'latest', accessToken?: string) {
        super(image, accessToken);
        this.tag = tag;
    }

    static canHandleImage(image: string): boolean {
        return image.includes('ghcr.io');
    }

    private getImageUrl(): string {
        const imageNameWithTag = this.image.split(':')[0];
        const [registry, user, image] = imageNameWithTag.split('/');
        return `https://${registry}/v2/${user}/${image}/manifests/${this.tag}`;
    }

    async checkForNewDigest(): Promise<{ newDigest: string; isDifferent: boolean }> {
        try {
            const response = await this.http.get(this.getImageUrl());
            const newDigest = response.headers['docker-content-digest'];

            const isDifferent = this.oldDigest !== newDigest;

            return { newDigest, isDifferent };
        } catch (error) {
            console.error(`Failed to check for new github image digest: ${error}`);
            throw error;
        }
    }
}
