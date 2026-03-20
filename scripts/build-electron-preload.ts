import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, context, type BuildOptions } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outDir = path.join(projectRoot, "dist-electron", "preload");
const watchMode = process.argv.includes("--watch");

await fs.mkdir(outDir, { recursive: true });

const options: BuildOptions = {
  entryPoints: [path.join(projectRoot, "src", "preload", "preload.ts")],
  outfile: path.join(outDir, "index.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: true,
  legalComments: "none" as const,
  external: ["electron"],
};

if (watchMode) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("Watching Electron preload bundle...");
} else {
  await build(options);
  console.log(`Built ${path.join(outDir, "index.cjs")}`);
}
