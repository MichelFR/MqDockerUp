import ConfigService from '../services/ConfigService';
import { ImageRegistryAdapter } from './ImageRegistryAdapter';
import logger from "../services/LoggerService";

export class GithubAdapter extends ImageRegistryAdapter {
    private tag: string;

    constructor(image: string, tag: string = 'latest') {
        const accessToken =  ConfigService.getConfig()?.accessTokens?.github;

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
        const imageNameWithTag = this.image.split(':')[0];
        const [registry, user, image] = imageNameWithTag.split('/');
        return `https://${registry}/v2/${user}/${image}/manifests/${this.tag}`;
    }

    async checkForNewDigest(): Promise<{ newDigest: string; isDifferent: boolean }> {
        try {
            this.http.defaults.headers['Accept'] = 'application/vnd.oci.image.index.v1+json';
            
            const response = await this.http.get(this.getImageUrl());
            const newDigest = this.removeSHA256Prefix(response.headers['docker-content-digest']);

            const isDifferent = this.oldDigest !== newDigest;

            return { newDigest, isDifferent };
        } catch (error) {
            logger.error(`Failed to check for new github image digest: ${error}`);
            throw error;
        }
    }
}
