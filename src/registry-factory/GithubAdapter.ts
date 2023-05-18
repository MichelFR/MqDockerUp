import axios from 'axios';
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

    getImageUrl(): string {
        const [user, repo, ...rest] = this.image.split('/').slice(1);
        return `https://api.github.com/user/${user}/packages/container/${repo}/versions`;
    }

    async getDigest(): Promise<string> {
        const url = this.getImageUrl();
        const response = await this.http.get(url);

        if (response.status === 200 && response.data) {
            const newDigest = response.data.metadata.container.tags[this.tag].digest;
            return newDigest;
        }

        throw new Error('Failed to get digest');
    }

    async checkForNewDigest(): Promise<{ newDigest: string; isDifferent: boolean }> {
        const newDigest = await this.getDigest();

        return {
            newDigest,
            isDifferent: this.oldDigest ? newDigest !== this.oldDigest : false,
        };
    }
}
