import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { calculateSha256 } from "../src/bootstrap/checksum-validator";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appName = process.env.APP_NAME ?? "erp-midas-tui";
const releaseAssetName = process.env.RELEASE_ASSET_NAME ?? `${appName}.exe`;
const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const targetPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(distDir, releaseAssetName);
const checksumPath = path.join(distDir, "SHA256SUMS.txt");

const hash = await calculateSha256(targetPath);
await fs.mkdir(distDir, { recursive: true });
await fs.writeFile(checksumPath, `${hash} *${path.basename(targetPath)}\n`, "utf8");

console.log(`Wrote ${checksumPath}`);
