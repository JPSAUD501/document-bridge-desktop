import { execFileSync } from "node:child_process";
import semver from "semver";

let tagsOutput = "";
try {
  tagsOutput = execFileSync("git", ["tag", "--list", "v*"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  console.log("v1.0.0");
  process.exit(0);
}

const tags = tagsOutput
  .split(/\r?\n/)
  .map((tag) => tag.trim())
  .filter((tag) => semver.valid(tag));

if (tags.length === 0) {
  console.log("v1.0.0");
  process.exit(0);
}

const latest = tags.sort((left, right) => semver.rcompare(left, right))[0];
if (!latest) {
  throw new Error("Failed to resolve latest version tag.");
}

const nextVersion = semver.inc(latest, "patch");
if (!nextVersion) {
  throw new Error(`Failed to increment version from ${latest}`);
}

console.log(`v${nextVersion}`);
