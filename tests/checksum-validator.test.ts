import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  calculateSha256,
  parseSha256Sums,
  validateFileChecksum,
} from "../src/bootstrap/checksum-validator";

describe("checksum validator", () => {
  test("parses SHA256SUMS files", () => {
    const parsed = parseSha256Sums("abc123 *erp-midas-tui.exe\n");
    expect(parsed.get("erp-midas-tui.exe")).toBe("abc123");
  });

  test("validates a file hash", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "erp-midas-tui-"));
    const filePath = path.join(tempDir, "sample.txt");
    await fs.writeFile(filePath, "hello", "utf8");

    const hash = await calculateSha256(filePath);
    expect(await validateFileChecksum(filePath, hash)).toBe(true);
  });
});
