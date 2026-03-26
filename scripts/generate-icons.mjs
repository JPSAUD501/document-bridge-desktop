/**
 * generate-icons.mjs
 * Generates PNG + ICO icons from the Pegasus SVG logo.
 * Usage: node scripts/generate-icons.mjs
 * Requires: @resvg/resvg-js, png-to-ico (devDependencies)
 */

import { Resvg } from "@resvg/resvg-js";
import pngToIco from "png-to-ico";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const resourcesDir = join(rootDir, "resources");

const svgPath = join(resourcesDir, "icon.svg");
const svgContent = readFileSync(svgPath, "utf-8");

function renderPng(width) {
  const resvg = new Resvg(svgContent, {
    fitTo: { mode: "width", value: width },
    background: "transparent",
  });
  return resvg.render().asPng();
}

// Render all sizes
const sizes = [16, 32, 48, 64, 128, 256, 512];
const pngBuffers = {};
for (const size of sizes) {
  pngBuffers[size] = renderPng(size);
  const out = join(resourcesDir, `icon-${size}.png`);
  writeFileSync(out, pngBuffers[size]);
  console.log(`✓  icon-${size}.png`);
}

// Main 512×512 PNG (used for general references)
writeFileSync(join(resourcesDir, "icon.png"), pngBuffers[512]);
console.log("✓  icon.png (512×512)");

// Tray icon 32×32
writeFileSync(join(resourcesDir, "tray.png"), pngBuffers[32]);
console.log("✓  tray.png (32×32)");

// ICO file — NSIS and Windows shell require a real .ico
// Embed sizes: 16, 32, 48, 64, 128, 256
const icoSizes = [16, 32, 48, 64, 128, 256];
const icoBuffer = await pngToIco(icoSizes.map((s) => pngBuffers[s]));
writeFileSync(join(resourcesDir, "icon.ico"), icoBuffer);
console.log("✓  icon.ico (16/32/48/64/128/256) — used by NSIS installer");

console.log("\nDone. Run `npm run package` to build the installer.");
