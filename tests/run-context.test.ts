import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { resolveRunPaths } from "../src/runtime/run-context";

describe("resolveRunPaths", () => {
  test("uses the selected output root when provided", async () => {
    const outputRootPath = await fs.mkdtemp(path.join(os.tmpdir(), "document-bridge-output-root-"));

    const runPaths = await resolveRunPaths({
      help: false,
      outputRootPath,
    });

    expect(path.dirname(runPaths.runDir)).toBe(outputRootPath);
    expect(runPaths.downloadsDir).toBe(path.join(runPaths.runDir, "downloads"));
  });
});
