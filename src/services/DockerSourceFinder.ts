const Docker = require("dockerode");
const https = require("https");
import * as http from "http";

export default class DockerSourceFinder {
  public static docker = new Docker();

  constructor() {
    DockerSourceFinder.docker = new Docker();
  }

  async getImageLabels(imageName: string) {
    try {
      const image = await DockerSourceFinder.docker.getImage(imageName);
      const inspect = await image.inspect();
      return inspect.Config.Labels;
    } catch (error: unknown) {
      console.error(
        `Error accessing image ${imageName}:`,
        error instanceof Error ? error.message : String(error)
      );
      return null;
    }
  }

  parseGithubUrl(url: string) {
    const parsed = new URL(url);
    if (parsed.hostname === "github.com") {
      const pathParts = parsed.pathname.split("/").filter((p) => p);
      if (pathParts.length >= 2) {
        return `github.com/${pathParts[0]}/${pathParts[1]}`;
      }
    }
    return null;
  }

  async findSourceRepo(imageName: string) {
    // Try method 1: Check Docker labels
    const labels = await this.getImageLabels(imageName);
    if (labels && labels["org.opencontainers.image.source"]) {
      return labels["org.opencontainers.image.source"];
    }

    // Try method 2: Check Docker Hub API
    try {
      const dockerHubUrl = `https://hub.docker.com/v2/repositories/${imageName}`;
      const response = await this.makeHttpsRequest(dockerHubUrl);
      if (response.ok) {
        const data = await response.json();
        const fullDescription = data.full_description || "";
        if (fullDescription.toLowerCase().includes("[github]")) {
          const startIndex = fullDescription.indexOf("[github");
          const endIndex = fullDescription.indexOf("]", startIndex);
          if (startIndex !== -1 && endIndex !== -1) {
            const githubUrl = fullDescription
              .slice(startIndex, endIndex)
              .replace("[github]", "");
            return this.parseGithubUrl(githubUrl);
          }
        }
      }
    } catch (error: unknown) {
      console.error(
        `Error checking Docker Hub API:`,
        error instanceof Error ? error.message : String(error)
      );
    }

    // Try method 3: URL pattern matching
    const repoParts = imageName.split("/");
    if (repoParts.length >= 2) {
      const username = repoParts[0];
      const repoName = repoParts[repoParts.length - 1].split(":")[0];
      const potentialRepo = `github.com/${username}/${repoName}`;

      const response = await this.makeHttpsRequest(`https://${potentialRepo}`, {
        method: "HEAD",
      });
      if (response.ok) {
        return potentialRepo;
      }
    }

    return null;
  }

  private makeHttpsRequest(
    url: string,
    options: { method?: string; headers?: { [key: string]: string } } = {}
  ): Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    json: () => Promise<any>;
  }> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        url,
        {
          method: options.method || "GET",
          headers: options.headers || {},
        },
        (res: http.IncomingMessage) => {
          let body = "";
          res.on("data", (chunk: Buffer) => (body += chunk));
          res.on("end", () => {
            try {
              // Create response object with non-nullable properties
              const response = {
                ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
                status: res.statusCode || 0,
                statusText: res.statusMessage || "Unknown Status",
                json: () => Promise.resolve(JSON.parse(body)),
              };
              resolve(response);
            } catch (err: unknown) {
              reject(
                new Error(
                  `Failed to parse response: ${
                    err instanceof Error ? err.message : String(err)
                  }`
                )
              );
            }
          });
        }
      );

      req.on("error", (err: unknown) => {
        reject(
          new Error(
            `Request failed: ${
              err instanceof Error ? err.message : String(err)
            }`
          )
        );
      });

      req.end();
    });
  }
}
