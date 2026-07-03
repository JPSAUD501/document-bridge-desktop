import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { resolveBrowserProfileDir, resolveRunPaths } from "../src/runtime/run-context";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("resolveRunPaths", () => {
  test("uses the selected output root when provided", async () => {
    const outputRootPath = await fs.mkdtemp(path.join(os.tmpdir(), "document-bridge-output-root-"));

    const runPaths = await resolveRunPaths({
      help: false,
      outputRootPath,
    });

    expect(path.dirname(runPaths.runDir)).toBe(outputRootPath);
    expect(runPaths.downloadsDir).toBe(path.join(runPaths.runDir, "downloads"));
    expect(runPaths.browserProfileDir).toContain(path.join("tmp", "erp-midas-desktop", "browser-profile"));
  });

  test("uses ERP_MIDAS_BROWSER_PROFILE_DIR when provided", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "document-bridge-workspace-"));
    const browserProfileDir = await fs.mkdtemp(path.join(os.tmpdir(), "document-bridge-profile-"));
    process.env.ERP_MIDAS_BROWSER_PROFILE_DIR = browserProfileDir;

    await expect(resolveBrowserProfileDir(workspaceRoot)).resolves.toBe(path.resolve(browserProfileDir));
  });
});
