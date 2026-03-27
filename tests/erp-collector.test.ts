import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { buildManifestItemId } from "../src/lib/utils";
import type { BrowserManager, ErpGridAdvanceResult, ErpGridState } from "../src/runtime/browser-manager";
import { ErpCollector } from "../src/runtime/erp-collector";
import { ManifestStore } from "../src/runtime/manifest-store";
import type { RunLogger } from "../src/runtime/logger";

function buildGridState(
  visiblePoNumbers: Array<string | { poNumber: string; rowKey?: string }>,
  scrollTop: number,
  scrollHeight = 2_000,
  clientHeight = 400,
): ErpGridState {
  const visibleItems = visiblePoNumbers.map((value) =>
    typeof value === "string"
      ? { poNumber: value, rowKey: `${value}|row` }
      : { poNumber: value.poNumber, rowKey: value.rowKey ?? `${value.poNumber}|row` },
  );
  return {
    visibleItems,
    visiblePoNumbers: visibleItems.map((item) => item.poNumber),
    visibleSignature: visibleItems.map((item) => item.rowKey).join("|"),
    scrollTop,
    scrollHeight,
    clientHeight,
  };
}

function buildAdvanceResult(
  state: ErpGridState,
  options: Pick<ErpGridAdvanceResult, "advanced" | "reachedEnd">,
): ErpGridAdvanceResult {
  return {
    state,
    advanced: options.advanced,
    reachedEnd: options.reachedEnd,
  };
}

function buildBrowserManagerMock(initialState: ErpGridState, advanceResults: ErpGridAdvanceResult[]) {
  let advanceIndex = 0;
  let currentState = initialState;

  return {
    waitForErpGrid: vi.fn().mockResolvedValue(undefined),
    inspectVisiblePoNumbers: vi.fn().mockResolvedValue(initialState.visiblePoNumbers),
    getErpGridState: vi.fn().mockImplementation(async () => currentState),
    resetErpGridToTop: vi.fn().mockImplementation(async () => {
      currentState = initialState;
      return currentState;
    }),
    advanceErpGrid: vi.fn().mockImplementation(async () => {
      const fallback = advanceResults[Math.max(advanceResults.length - 1, 0)];
      const result = advanceResults[advanceIndex] ?? fallback;
      if (!result) {
        throw new Error("Nenhum resultado de avanço do grid foi configurado no teste.");
      }
      advanceIndex += 1;
      currentState = result.state;
      return result;
    }),
    scrollErpGrid: vi.fn().mockResolvedValue(undefined),
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
  test("discovers all unique ERP rows even when the first scroll attempt does not advance the virtualized grid", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "erp-discovery-"));
    tempDirs.push(tempDir);

    const manifestStore = await createManifestStore(tempDir);
    const initialState = buildGridState(["OC0001", "OC0002", "OC0003", "OC0004", "OC0005"], 0);
    const browserManager = buildBrowserManagerMock(initialState, [
      buildAdvanceResult(initialState, { advanced: false, reachedEnd: false }),
      buildAdvanceResult(buildGridState(["OC0006", "OC0007", "OC0008", "OC0009", "OC0010"], 500), {
        advanced: true,
        reachedEnd: false,
      }),
      buildAdvanceResult(buildGridState(["OC0011", "OC0012"], 1_000), {
        advanced: true,
        reachedEnd: false,
      }),
      buildAdvanceResult(buildGridState(["OC0011", "OC0012"], 1_600), {
        advanced: false,
        reachedEnd: true,
      }),
      buildAdvanceResult(buildGridState(["OC0011", "OC0012"], 1_600), {
        advanced: false,
        reachedEnd: true,
      }),
      buildAdvanceResult(buildGridState(["OC0011", "OC0012"], 1_600), {
        advanced: false,
        reachedEnd: true,
      }),
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
    expect(browserManager.advanceErpGrid).toHaveBeenCalled();
    expect((browserManager.advanceErpGrid as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(manifestStore.items).toHaveLength(12);
    expect(new Set(manifestStore.items.map((item) => item.id)).size).toBe(12);
  });

  test("keeps duplicate OCs when the row key is different", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "erp-duplicates-"));
    tempDirs.push(tempDir);

    const manifestStore = await createManifestStore(tempDir);
    const initialState = buildGridState(
      [
        { poNumber: "HRV-008813", rowKey: "5401|HRV-008813|2457539|RD GESTAO" },
        { poNumber: "HRV-008813", rowKey: "5401|HRV-008813|2885021|RD GESTAO" },
        { poNumber: "OC0292131", rowKey: "2102|OC0292131|360682|TOP SERVICE" },
      ],
      0,
    );
    const browserManager = buildBrowserManagerMock(initialState, [
      buildAdvanceResult(initialState, { advanced: false, reachedEnd: true }),
      buildAdvanceResult(initialState, { advanced: false, reachedEnd: true }),
      buildAdvanceResult(initialState, { advanced: false, reachedEnd: true }),
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

    expect(manifestStore.items).toHaveLength(3);
    expect(manifestStore.items.filter((item) => item.poNumber === "HRV-008813")).toHaveLength(2);
  });

  test("downloads every discovered OC by reusing the same end-confirmed grid sweep", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "erp-download-"));
    tempDirs.push(tempDir);

    const downloadsDir = path.join(tempDir, "downloads");
    await fs.mkdir(downloadsDir, { recursive: true });
    const manifestStore = await createManifestStore(tempDir);
    for (let index = 1; index <= 12; index += 1) {
      const poNumber = `OC${String(index).padStart(4, "0")}`;
      manifestStore.ensureItem({
        id: buildManifestItemId(poNumber, `${poNumber}|row`),
        poNumber,
        rowKey: `${poNumber}|row`,
        sourceRow: index,
      });
    }
    await manifestStore.persist();

    const initialState = buildGridState(["OC0001", "OC0002", "OC0003", "OC0004", "OC0005"], 0);
    const browserManager = buildBrowserManagerMock(initialState, [
      buildAdvanceResult(initialState, { advanced: false, reachedEnd: false }),
      buildAdvanceResult(buildGridState(["OC0006", "OC0007", "OC0008", "OC0009", "OC0010"], 500), {
        advanced: true,
        reachedEnd: false,
      }),
      buildAdvanceResult(buildGridState(["OC0011", "OC0012"], 1_000), {
        advanced: true,
        reachedEnd: false,
      }),
      buildAdvanceResult(buildGridState(["OC0011", "OC0012"], 1_600), {
        advanced: false,
        reachedEnd: true,
      }),
      buildAdvanceResult(buildGridState(["OC0011", "OC0012"], 1_600), {
        advanced: false,
        reachedEnd: true,
      }),
      buildAdvanceResult(buildGridState(["OC0011", "OC0012"], 1_600), {
        advanced: false,
        reachedEnd: true,
      }),
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
    expect(browserManager.advanceErpGrid).toHaveBeenCalled();
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
