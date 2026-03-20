import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

await Promise.all([
  fs.rm(path.join(projectRoot, "dist"), { recursive: true, force: true }),
  fs.rm(path.join(projectRoot, "dist-electron"), { recursive: true, force: true }),
  fs.rm(path.join(projectRoot, "release"), { recursive: true, force: true }),
]);
