import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outDir = path.join(projectRoot, "dist", "app");
const outfile = path.join(outDir, "index.cjs");
const buildDefines = {
  "process.env.ERP_URL": JSON.stringify(process.env.ERP_URL),
  "process.env.MIDAS_URL": JSON.stringify(process.env.MIDAS_URL),
};

await fs.mkdir(outDir, { recursive: true });

await build({
  entryPoints: [path.join(projectRoot, "src", "index.tsx")],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  jsx: "automatic",
  sourcemap: false,
  legalComments: "none",
  define: buildDefines,
  external: [
    "exceljs",
    "ink",
    "playwright",
    "playwright-core/lib/server/registry/index",
    "react",
    "react/jsx-runtime",
    "semver",
    "zod",
  ],
});

console.log(`Built app bundle ${outfile}`);
