import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ErpCollector } from "../src/runtime/erp-collector";
import { sanitizeFileName } from "../src/lib/utils";
import { ManifestStore } from "../src/runtime/manifest-store";
import type { BrowserManager } from "../src/runtime/browser-manager";
import type { RunLogger } from "../src/runtime/logger";

function buildBrowserManagerMock(windows: string[][]) {
  let index = 0;

  return {
    waitForErpGrid: vi.fn().mockResolvedValue(undefined),
    inspectVisiblePoNumbers: vi.fn().mockImplementation(async () => windows[0] ?? []),
    resetErpGridToTop: vi.fn().mockImplementation(async () => {
      index = 0;
    }),
    getVisiblePoNumbers: vi.fn().mockImplementation(async () => windows[Math.min(index, windows.length - 1)] ?? []),
    scrollErpGrid: vi.fn().mockImplementation(async () => {
      if (index < windows.length - 1) {
        index += 1;
      }
    }),
    openErpPurchaseOrder: vi.fn().mockResolvedValue(undefined),
    downloadErpAttachment: vi.fn().mockImplementation(async (downloadPath: string) => {
      await fs.writeFile(downloadPath, "pdf");
      return { originalFileName: `${path.basename(downloadPath).replace(".partial.pdf", "")}.pdf` };
    }),
    closeErpDialogs: vi.fn().mockResolvedValue(undefined),
  } as unknown as BrowserManager;
}

function buildLoggerMock() {
  return {
    info: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
  } as unknown as RunLogger;
}

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (!tempDir) {
      continue;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

async function createManifestStore(tempDir: string) {
  const manifestStore = new ManifestStore(path.join(tempDir, "manifest.json"), "run-test");
  await manifestStore.initialize();
  return manifestStore;
}

describe("ErpCollector", () => {
  test("discovers all unique OCs across a long ERP grid before stabilizing", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "erp-discovery-"));
    tempDirs.push(tempDir);

    const manifestStore = await createManifestStore(tempDir);
    const browserManager = buildBrowserManagerMock([
      ["OC0001", "OC0002", "OC0003", "OC0004", "OC0005"],
      ["OC0006", "OC0007", "OC0008", "OC0009", "OC0010"],
      ["OC0011", "OC0012"],
      ["OC0011", "OC0012"],
      ["OC0011", "OC0012"],
      ["OC0011", "OC0012"],
      ["OC0011", "OC0012"],
    ]);
    const logger = buildLoggerMock();

    const collector = new ErpCollector({
      browserManager,
      downloadsDir: path.join(tempDir, "downloads"),
      manifestStore,
      logger,
      onCurrentItem: async () => undefined,
      onManifestChanged: async () => undefined,
    });

    await collector.discover();

    expect(browserManager.resetErpGridToTop).toHaveBeenCalledTimes(1);
    expect(manifestStore.items).toHaveLength(12);
    expect(new Set(manifestStore.items.map((item) => item.poNumber)).size).toBe(12);
  });

  test("downloads every discovered OC by scanning the ERP grid from the top again", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "erp-download-"));
    tempDirs.push(tempDir);

    const downloadsDir = path.join(tempDir, "downloads");
    await fs.mkdir(downloadsDir, { recursive: true });
    const manifestStore = await createManifestStore(tempDir);
    for (let index = 1; index <= 12; index += 1) {
      const poNumber = `OC${String(index).padStart(4, "0")}`;
      manifestStore.ensureItem({
        id: sanitizeFileName(poNumber),
        poNumber,
        sourceRow: index,
      });
    }
    await manifestStore.persist();

    const browserManager = buildBrowserManagerMock([
      ["OC0001", "OC0002", "OC0003", "OC0004", "OC0005"],
      ["OC0006", "OC0007", "OC0008", "OC0009", "OC0010"],
      ["OC0011", "OC0012"],
      ["OC0011", "OC0012"],
    ]);
    const logger = buildLoggerMock();

    const collector = new ErpCollector({
      browserManager,
      downloadsDir,
      manifestStore,
      logger,
      onCurrentItem: async () => undefined,
      onManifestChanged: async () => undefined,
    });

    await collector.downloadDiscovered();

    expect(browserManager.resetErpGridToTop).toHaveBeenCalledTimes(1);
    expect(browserManager.openErpPurchaseOrder).toHaveBeenCalledTimes(12);

    for (const item of manifestStore.items) {
      expect(item.downloadStatus).toBe("downloaded");
      expect(item.uploadStatus).toBe("queued_for_upload");
      expect(item.downloadPath).toBeTruthy();
      if (item.downloadPath) {
        await expect(fs.access(item.downloadPath)).resolves.toBeUndefined();
      }
    }
  });
});
