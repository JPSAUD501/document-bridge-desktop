/**
 * generate-icons.mjs
 * Generates PNG icons from the Pegasus SVG logo.
 * Usage: node scripts/generate-icons.mjs
 * Requires: npm install @resvg/resvg-js (devDependency)
 */

import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const resourcesDir = join(rootDir, "resources");

const svgPath = join(resourcesDir, "icon.svg");
const svgContent = readFileSync(svgPath, "utf-8");

function renderSvg(width) {
  const resvg = new Resvg(svgContent, {
    fitTo: { mode: "width", value: width },
    background: "transparent",
  });
  return resvg.render().asPng();
}

// Main app icon (electron-builder uses 512x512 PNG → auto-converts to ICO)
const sizes = [16, 32, 48, 64, 128, 256, 512];
for (const size of sizes) {
  const out = join(resourcesDir, `icon-${size}.png`);
  writeFileSync(out, renderSvg(size));
  console.log(`✓  icon-${size}.png`);
}

// Primary icon (referenced by electron-builder)
writeFileSync(join(resourcesDir, "icon.png"), renderSvg(512));
console.log("✓  icon.png (512×512) — used by electron-builder");

// Tray icon
writeFileSync(join(resourcesDir, "tray.png"), renderSvg(32));
console.log("✓  tray.png (32×32)");

console.log("\nDone. Run `npm run package` to build the installer.");
