jest.mock("../src/index", () => ({
  mqttClient: {
    publish: jest.fn(),
    on: jest.fn(),
    end: jest.fn(),
  },
}));

jest.mock("axios", () => ({
  get: jest.fn(),
}));

import axios from "axios";
import DockerService from "../src/services/DockerService";

describe("DockerService.getLatestGithubReleaseTag", () => {
  beforeEach(() => {
    DockerService.LatestReleaseCache.clear();
    jest.clearAllMocks();
  });

  it("returns the latest release tag for a GitHub repository", async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: { tag_name: "2.15.3" } });

    const result = await DockerService.getLatestGithubReleaseTag("https://github.com/penpot/penpot");

    expect(result).toBe("2.15.3");
    expect(axios.get).toHaveBeenCalledWith("https://api.github.com/repos/penpot/penpot/releases/latest");
  });

  it("caches the result so subsequent calls do not hit the network again", async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: { tag_name: "2.15.3" } });

    await DockerService.getLatestGithubReleaseTag("https://github.com/penpot/penpot");
    await DockerService.getLatestGithubReleaseTag("https://github.com/penpot/penpot");

    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it("returns null for non-GitHub repositories", async () => {
    const result = await DockerService.getLatestGithubReleaseTag("https://gitlab.com/group/project");

    expect(result).toBeNull();
    expect(axios.get).not.toHaveBeenCalled();
  });

  it("returns null when the GitHub API request fails", async () => {
    (axios.get as jest.Mock).mockRejectedValue(new Error("not found"));

    const result = await DockerService.getLatestGithubReleaseTag("https://github.com/owner/repo");

    expect(result).toBeNull();
  });
});
