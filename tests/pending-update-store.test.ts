import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { PendingUpdateStore } from "../src/main/services/update/pending-update-store";

describe("PendingUpdateStore", () => {
  test("writes, reads and clears pending update metadata", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "erp-midas-pending-"));
    const store = new PendingUpdateStore(path.join(tempDir, "pending-update.json"));

    await store.write("1.2.3");
    const saved = await store.read();
    expect(saved?.version).toBe("1.2.3");

    await store.clear();
    await expect(store.read()).resolves.toBeNull();
  });
});
