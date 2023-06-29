import axios, { AxiosInstance } from 'axios';

export abstract class ImageRegistryAdapter {
    protected http: AxiosInstance;
    protected image: string;
    protected oldDigest: string | null = null;

    constructor(image: string, accessToken?: string) {
        // base64 the token
        let accessToken64 = accessToken ? Buffer.from(accessToken).toString('base64') : "";
        this.image = image;
        this.http = axios.create({
            headers: this.createHeaders(accessToken64),
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

    protected removeSHA256Prefix(input: string): string {
        const prefix = "sha256:";
        
        if (input.startsWith(prefix)) {
          return input.slice(prefix.length);
        } else {
          return input;
        }
      }
}
