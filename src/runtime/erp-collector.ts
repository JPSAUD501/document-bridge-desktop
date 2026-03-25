import fs from "node:fs/promises";
import path from "node:path";
import { buildSavedPdfName, fileExists, normalizePdfFileName, sanitizeFileName, summarizeError } from "../lib/utils";
import type { BrowserManager } from "./browser-manager";
import type { ManifestStore } from "./manifest-store";
import type { RunLogger } from "./logger";

interface ErpCollectorOptions {
  browserManager: BrowserManager;
  downloadsDir: string;
  manifestStore: ManifestStore;
  logger: RunLogger;
  onCurrentItem: (value?: string) => Promise<void>;
  onManifestChanged: () => Promise<void>;
}

export class ErpCollector {
  readonly #browserManager: BrowserManager;
  readonly #downloadsDir: string;
  readonly #manifestStore: ManifestStore;
  readonly #logger: RunLogger;
  readonly #onCurrentItem: (value?: string) => Promise<void>;
  readonly #onManifestChanged: () => Promise<void>;

  constructor(options: ErpCollectorOptions) {
    this.#browserManager = options.browserManager;
    this.#downloadsDir = options.downloadsDir;
    this.#manifestStore = options.manifestStore;
    this.#logger = options.logger;
    this.#onCurrentItem = options.onCurrentItem;
    this.#onManifestChanged = options.onManifestChanged;
  }

  async run(): Promise<void> {
    await this.#logger.info("erp", "Lendo a grade filtrada do ERP.");
    await this.#browserManager.waitForErpGrid();

    const processed = new Set(
      this.#manifestStore.items
        .filter((item) => item.downloadStatus === "downloaded" || item.downloadStatus === "download_failed")
        .map((item) => item.poNumber),
    );

    let sourceRow = this.#manifestStore.items.length;
    let stablePasses = 0;

    while (stablePasses < 4) {
      const visiblePoNumbers = await this.#browserManager.getVisiblePoNumbers();
      let foundNew = false;

      for (const poNumber of visiblePoNumbers) {
        if (processed.has(poNumber)) {
          continue;
        }

        processed.add(poNumber);
        foundNew = true;
        sourceRow += 1;
        this.#manifestStore.ensureItem({
          id: sanitizeFileName(poNumber),
          poNumber,
          sourceRow,
        });
        await this.#manifestStore.persist();
        await this.#onManifestChanged();
        await this.processPurchaseOrder(poNumber);
      }

      stablePasses = foundNew ? 0 : stablePasses + 1;
      await this.#browserManager.scrollErpGrid();
    }

    await this.#onCurrentItem(undefined);
    await this.#logger.info("erp", "Leitura da grade do ERP concluida.", {
      total: this.#manifestStore.items.length,
    });
  }

  async processPurchaseOrder(poNumber: string): Promise<void> {
    const itemId = sanitizeFileName(poNumber);
    const item = this.#manifestStore.findById(itemId);
    if (!item) {
      throw new Error(`Item do manifesto nao encontrado para ${poNumber}`);
    }

    if (item.downloadStatus === "downloaded" && item.downloadPath && (await fileExists(item.downloadPath))) {
      const repairedSavedFileName = normalizePdfFileName(
        item.savedFileName ?? path.basename(item.downloadPath),
        `${poNumber}.pdf`,
      );
      const repairedDownloadPath = path.join(this.#downloadsDir, repairedSavedFileName);

      if (repairedDownloadPath !== item.downloadPath) {
        await fs.rename(item.downloadPath, repairedDownloadPath);
      }

      await this.#manifestStore.updateItem(itemId, {
        originalFileName: item.originalFileName
          ? normalizePdfFileName(item.originalFileName, `${poNumber}.pdf`)
          : undefined,
        savedFileName: repairedSavedFileName,
        downloadPath: repairedDownloadPath,
        uploadStatus: "queued_for_upload",
      });
      await this.#onManifestChanged();
      await this.#logger.info("erp", "PDF ja existente; reaproveitando arquivo salvo.", { poNumber });
      return;
    }

    await this.#onCurrentItem(poNumber);
    await this.#manifestStore.updateItem(itemId, {
      downloadStatus: "downloading",
      attempts: item.attempts + 1,
      lastError: undefined,
    });
    await this.#onManifestChanged();
    await this.#logger.info("erp", "Baixando PDF.", { poNumber });

    const tempDownloadPath = path.join(
      this.#downloadsDir,
      buildSavedPdfName(item.sourceRow, poNumber, `${poNumber}.partial.pdf`),
    );

    try {
      await this.#browserManager.openErpPurchaseOrder(poNumber);
      const { originalFileName } = await this.#browserManager.downloadErpAttachment(tempDownloadPath);
      await this.#browserManager.closeErpDialogs();
      await this.#browserManager.waitForErpGrid();

      const savedFileName = buildSavedPdfName(item.sourceRow, poNumber, originalFileName);
      const downloadPath = path.join(this.#downloadsDir, savedFileName);
      if (downloadPath !== tempDownloadPath) {
        await fs.rename(tempDownloadPath, downloadPath);
      }

      await this.#manifestStore.updateItem(itemId, {
        originalFileName,
        savedFileName,
        downloadPath,
        downloadStatus: "downloaded",
        uploadStatus: "queued_for_upload",
        lastError: undefined,
      });
      await this.#onManifestChanged();
      await this.#logger.info("erp", "PDF baixado com sucesso.", { poNumber, downloadPath });
    } catch (error) {
      await this.#browserManager.closeErpDialogs().catch(() => undefined);
      await this.#browserManager.waitForErpGrid().catch(() => undefined);
      await fs.unlink(tempDownloadPath).catch(() => undefined);
      await this.#manifestStore.updateItem(itemId, {
        downloadStatus: "download_failed",
        lastError: summarizeError(error),
      });
      await this.#onManifestChanged();
      await this.#logger.error("erp", "Falha ao baixar o PDF.", {
        poNumber,
        error: summarizeError(error),
      });
    }
  }
}
