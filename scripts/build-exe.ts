import fs from "node:fs/promises";
import path from "node:path";
import semver from "semver";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const appName = process.env.APP_NAME ?? "erp-midas-tui";
const appVersion = process.env.APP_VERSION ?? "v0.0.0-dev";
const githubOwner = process.env.GITHUB_OWNER ?? "owner";
const githubRepo = process.env.GITHUB_REPO ?? "repo";
const releaseAssetName = process.env.RELEASE_ASSET_NAME ?? `${appName}.exe`;
const windowsVersion = semver.valid(appVersion)?.replace(/^v/, "") ?? "0.0.0";
const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const appDir = path.join(distDir, "app");
const outfile = path.join(distDir, releaseAssetName);
const bundlePath = path.join(appDir, "index.cjs");

await fs.rm(appDir, { recursive: true, force: true });
await fs.mkdir(distDir, { recursive: true });
await runCommand("npm", ["run", "build:app"], projectRoot);
await embedBuildInfo(bundlePath, {
  APP_NAME: appName,
  APP_VERSION: appVersion,
  GITHUB_OWNER: githubOwner,
  GITHUB_REPO: githubRepo,
  RELEASE_ASSET_NAME: releaseAssetName,
});
await fs.rm(outfile, { force: true }).catch(() => undefined);

const pkgBin = resolvePkgBin();
await runCommand(
  process.execPath,
  [
    pkgBin,
    bundlePath,
    "--target",
    "node20-win-x64",
    "--output",
    outfile,
    "--public-packages",
    "*",
    "--compress",
    "Brotli",
  ],
  projectRoot,
  {
    APP_VERSION: appVersion,
    APP_NAME: appName,
    RELEASE_ASSET_NAME: releaseAssetName,
  },
);

console.log(`Built ${outfile}`);
console.log(`Version embedded: ${appVersion}`);
console.log(`Windows version embedded: ${windowsVersion}`);
console.log(`GitHub repo embedded: ${githubOwner}/${githubRepo}`);

function resolvePkgBin(): string {
  const pkgPackageJsonPath = require.resolve("@yao-pkg/pkg/package.json");
  const pkgPackageJson = JSON.parse(
    require("node:fs").readFileSync(pkgPackageJsonPath, "utf8"),
  ) as { bin: string | Record<string, string> };
  const binEntry =
    typeof pkgPackageJson.bin === "string"
      ? pkgPackageJson.bin
      : pkgPackageJson.bin.pkg ?? Object.values(pkgPackageJson.bin)[0];
  if (!binEntry) {
    throw new Error("Could not resolve @yao-pkg/pkg bin entry.");
  }

  return path.resolve(path.dirname(pkgPackageJsonPath), binEntry);
}

async function embedBuildInfo(
  targetPath: string,
  replacements: Record<string, string>,
): Promise<void> {
  let contents = await fs.readFile(targetPath, "utf8");
  for (const [key, value] of Object.entries(replacements)) {
    contents = contents.replaceAll(`__${key}__`, escapeForJs(value));
  }
  await fs.writeFile(targetPath, contents, "utf8");
}

function escapeForJs(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n");
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: {
        ...process.env,
        ...extraEnv,
      },
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}
