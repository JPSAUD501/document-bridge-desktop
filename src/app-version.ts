import { BUILD_INFO } from "./build-info";

type ProcessWithPkg = NodeJS.Process & {
  pkg?: unknown;
};

export const APP_NAME = resolveBuildValue(BUILD_INFO.appName) ?? process.env.APP_NAME ?? "erp-midas-tui";
export const APP_VERSION =
  resolveBuildValue(BUILD_INFO.appVersion) ?? process.env.APP_VERSION ?? "v0.0.0-dev";
export const GITHUB_OWNER =
  resolveBuildValue(BUILD_INFO.githubOwner) ?? process.env.GITHUB_OWNER ?? "";
export const GITHUB_REPO = resolveBuildValue(BUILD_INFO.githubRepo) ?? process.env.GITHUB_REPO ?? "";
export const RELEASE_ASSET_NAME =
  resolveBuildValue(BUILD_INFO.releaseAssetName) ??
  process.env.RELEASE_ASSET_NAME ??
  `${APP_NAME}.exe`;

export function isUpdaterConfigured(): boolean {
  return Boolean(GITHUB_OWNER && GITHUB_REPO && RELEASE_ASSET_NAME);
}

export function isCompiledBinary(): boolean {
  return Boolean((process as ProcessWithPkg).pkg);
}

function resolveBuildValue(value: string): string | undefined {
  if (/^__[A-Z0-9_]+__$/.test(value)) {
    return undefined;
  }

  return value;
}
