import { DockerhubAdapter } from './DockerhubAdapter';
import { ImageRegistryAdapter } from './ImageRegistryAdapter';

export class ImageRegistryAdapterFactory {
    private static registryAdapters = [
        { adapter: DockerhubAdapter, canHandleImage: DockerhubAdapter.canHandleImage },
        // add other adapters here in a similar way
    ];

    static getAdapter(image: string, tag?: string, accessToken?: string): ImageRegistryAdapter {
        for (const { adapter, canHandleImage } of this.registryAdapters) {
            if (canHandleImage(image)) {
                return new adapter(image, tag, accessToken);
            }
        }
        throw new Error(`No adapter found for the image: ${image}`);
    }

    static getRegistryName(image: string): string {
        for (const { adapter, canHandleImage } of this.registryAdapters) {
            if (canHandleImage(image)) {
                if (adapter === DockerhubAdapter) {
                    return 'DockerHub';
                }
                // Add more conditions here for other adapters
            }
        }
        throw new Error(`No registry found for the image: ${image}`);
    }

}
