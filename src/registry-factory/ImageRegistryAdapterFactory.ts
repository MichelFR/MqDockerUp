import { DockerhubAdapter } from './DockerhubAdapter';
import { GithubAdapter } from './GithubAdapter';
import { ImageRegistryAdapter } from './ImageRegistryAdapter';
import { LscrAdapter } from './LscrAdapter';

export class ImageRegistryAdapterFactory {
    private static registryAdapters = [
        DockerhubAdapter,
        GithubAdapter,
        LscrAdapter,
        // add other adapters here in a similar way
    ];

    static getAdapter(image: string, tag?: string, accessToken?: string): ImageRegistryAdapter {
        for (const adapter of this.registryAdapters) {
            if (adapter.canHandleImage(image)) {
                return new adapter(image, tag, accessToken);
            }
        }
        throw new Error(`No adapter found for the image: ${image}`);
    }

    static getRegistryName(image: string): string {
        for (const adapter of this.registryAdapters) {
            if (adapter.canHandleImage(image)) {
                return adapter.displayName;
            }
        }
        throw new Error(`No registry found for the image: ${image}`);
    }

}
