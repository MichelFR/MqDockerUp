import axios, { AxiosInstance } from 'axios';

export abstract class ImageRegistryAdapter {
    protected http: AxiosInstance;
    protected image: string;
    protected oldDigest: string | null = null;

    constructor(image: string, accessToken?: string) {
        this.image = image;
        this.http = axios.create({
            headers: this.createHeaders(accessToken),
        });
    }

    private createHeaders(accessToken?: string): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        if (accessToken) {
            headers['Authorization'] = `Bearer ${accessToken}`;
        }

        return headers;
    }

    abstract checkForNewDigest(): Promise<{ newDigest: string; isDifferent: boolean }>;
}
