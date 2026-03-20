import semver from "semver";
import { APP_TIMEOUTS } from "../config";

export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: GitHubReleaseAsset[];
}

export async function fetchStableReleases(
  owner: string,
  repo: string,
  token?: string,
): Promise<GitHubRelease[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), APP_TIMEOUTS.long);

  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status}`);
    }

    const releases = (await response.json()) as GitHubRelease[];
    return releases.filter(
      (release) =>
        !release.draft &&
        !release.prerelease &&
        semver.valid(release.tag_name),
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function selectLatestStableRelease(releases: GitHubRelease[]): GitHubRelease | undefined {
  return [...releases].sort((left, right) => semver.rcompare(left.tag_name, right.tag_name))[0];
}
