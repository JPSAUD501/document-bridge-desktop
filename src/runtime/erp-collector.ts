import fs from "node:fs/promises";
import path from "node:path";
import { buildSavedPdfName, fileExists, normalizePdfFileName, sanitizeFileName, summarizeError } from "../lib/utils";
import type { BrowserManager, ErpGridState } from "./browser-manager";
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

const ERP_MAX_SCAN_PASSES = 500;
const ERP_END_CONFIRMATION_ATTEMPTS = 3;

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
    await this.discover();
    await this.downloadDiscovered();
  }

  async discover(): Promise<void> {
    await this.#logger.info("erp", "Iniciando a varredura completa da grade do ERP.");
    await this.#browserManager.waitForErpGrid();

    const knownPoNumbers = new Set(this.#manifestStore.items.map((item) => item.poNumber));
    let sourceRow = this.#manifestStore.items.reduce((highest, item) => Math.max(highest, item.sourceRow), 0);

    await this.scanErpGridUntilEnd(async (state) => {
      let foundNew = false;
      let foundCount = 0;

      for (const poNumber of state.visiblePoNumbers) {
        if (knownPoNumbers.has(poNumber)) {
          continue;
        }

        knownPoNumbers.add(poNumber);
        foundNew = true;
        foundCount += 1;
        sourceRow += 1;
        this.#manifestStore.ensureItem({
          id: sanitizeFileName(poNumber),
          poNumber,
          sourceRow,
        });
      }

      if (foundNew) {
        await this.#manifestStore.persist();
        await this.#onManifestChanged();
        await this.#logger.info("erp", "Novas OCs descobertas na grade do ERP.", {
          discovered: this.#manifestStore.items.length,
          count: foundCount,
          visible: state.visiblePoNumbers.length,
        });
      }

      return { progress: foundNew };
    });

    await this.#onCurrentItem(undefined);
    await this.#logger.info("erp", "Varredura da grade do ERP concluida.", {
      total: this.#manifestStore.items.length,
    });
  }

  async downloadDiscovered(): Promise<void> {
    const pendingPoNumbers = new Set<string>();

    for (const item of this.getOrderedItems()) {
      if (item.uploadStatus === "uploaded") {
        continue;
      }

      if (await this.reuseExistingDownload(item.id)) {
        continue;
      }

      if (item.downloadStatus !== "pending") {
        await this.#manifestStore.updateItem(item.id, {
          originalFileName: undefined,
          savedFileName: undefined,
          downloadPath: undefined,
          downloadStatus: "pending",
          uploadStatus: "pending",
          lastError: undefined,
        });
      }

      pendingPoNumbers.add(item.poNumber);
    }

    await this.#onManifestChanged();
    await this.#logger.info("erp", "Leitura da grade do ERP concluida.", {
      total: this.#manifestStore.items.length,
    });

    if (pendingPoNumbers.size === 0) {
      await this.#logger.info("erp", "Nenhum PDF pendente para baixar no ERP.");
      return;
    }

    await this.#logger.info("erp", "Iniciando o download dos PDFs descobertos no ERP.", {
      pending: pendingPoNumbers.size,
      discovered: this.#manifestStore.items.length,
    });

    await this.scanErpGridUntilEnd(async (state) => {
      let processedAny = false;

      for (const poNumber of state.visiblePoNumbers) {
        if (!pendingPoNumbers.has(poNumber)) {
          continue;
        }

        processedAny = true;
        pendingPoNumbers.delete(poNumber);
        await this.processPurchaseOrder(poNumber);

        if (pendingPoNumbers.size === 0) {
          return { progress: true, stop: true };
        }
      }

      return { progress: processedAny };
    });

    if (pendingPoNumbers.size > 0) {
      const unresolvedError = "A OC nao foi reencontrada na grade do ERP durante a etapa de download.";
      for (const poNumber of pendingPoNumbers) {
        const item = this.#manifestStore.findById(sanitizeFileName(poNumber));
        if (!item || item.uploadStatus === "uploaded") {
          continue;
        }

        await this.#manifestStore.updateItem(item.id, {
          downloadStatus: "download_failed",
          uploadStatus: "pending",
          lastError: unresolvedError,
        });
      }
      await this.#onManifestChanged();
      await this.#logger.error("erp", "Nem todas as OCs descobertas puderam ser reencontradas para download.", {
        pending: pendingPoNumbers.size,
        discovered: this.#manifestStore.items.length,
      });
    }

    await this.#onCurrentItem(undefined);
  }

  async processPurchaseOrder(poNumber: string): Promise<void> {
    const itemId = sanitizeFileName(poNumber);
    const item = this.#manifestStore.findById(itemId);
    if (!item) {
      throw new Error(`Item do manifesto nao encontrado para ${poNumber}`);
    }

    if (await this.reuseExistingDownload(itemId)) {
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

  async scanErpGridUntilEnd(
    onVisibleState: (
      state: ErpGridState,
    ) => Promise<{ progress: boolean; stop?: boolean }>,
  ): Promise<void> {
    await this.#browserManager.waitForErpGrid();
    let state = await this.#browserManager.resetErpGridToTop();
    let endConfirmationAttempts = 0;

    for (let pass = 0; pass < ERP_MAX_SCAN_PASSES; pass += 1) {
      const { progress, stop } = await onVisibleState(state);

      if (stop) {
        return;
      }

      const currentState = await this.#browserManager.getErpGridState();
      if (currentState.visibleSignature !== state.visibleSignature) {
        state = currentState;
        endConfirmationAttempts = 0;
        continue;
      }

      const advanceResult = await this.#browserManager.advanceErpGrid(currentState);

      if (advanceResult.advanced) {
        endConfirmationAttempts = 0;
      } else if (advanceResult.reachedEnd && !progress) {
        endConfirmationAttempts += 1;
        await this.#logger.info("erp", "Grade do ERP sem novo avanço; confirmando fim da lista.", {
          count: endConfirmationAttempts,
          discovered: this.#manifestStore.items.length,
          visible: advanceResult.state.visiblePoNumbers.length,
        });
      } else {
        endConfirmationAttempts = 0;
      }

      state = advanceResult.state;

      if (advanceResult.reachedEnd && endConfirmationAttempts >= ERP_END_CONFIRMATION_ATTEMPTS) {
        await this.#logger.info("erp", "Fim fisico da grade do ERP confirmado.", {
          count: endConfirmationAttempts,
          discovered: this.#manifestStore.items.length,
          visible: state.visiblePoNumbers.length,
        });
        return;
      }
    }

    throw new Error("A varredura do ERP excedeu o limite de iteracoes sem confirmar o fim da grade.");
  }

  getOrderedItems() {
    return [...this.#manifestStore.items].sort((left, right) => left.sourceRow - right.sourceRow);
  }

  async reuseExistingDownload(itemId: string): Promise<boolean> {
    const item = this.#manifestStore.findById(itemId);
    if (!item || item.downloadStatus !== "downloaded" || !item.downloadPath) {
      return false;
    }

    if (!(await fileExists(item.downloadPath))) {
      return false;
    }

    const repairedSavedFileName = normalizePdfFileName(
      item.savedFileName ?? path.basename(item.downloadPath),
      `${item.poNumber}.pdf`,
    );
    const repairedDownloadPath = path.join(this.#downloadsDir, repairedSavedFileName);

    if (repairedDownloadPath !== item.downloadPath) {
      await fs.rename(item.downloadPath, repairedDownloadPath);
    }

    await this.#manifestStore.updateItem(itemId, {
      originalFileName: item.originalFileName
        ? normalizePdfFileName(item.originalFileName, `${item.poNumber}.pdf`)
        : undefined,
      savedFileName: repairedSavedFileName,
      downloadPath: repairedDownloadPath,
      uploadStatus: "queued_for_upload",
    });
    await this.#onManifestChanged();
    await this.#logger.info("erp", "PDF ja existente; reaproveitando arquivo salvo.", {
      poNumber: item.poNumber,
    });
    return true;
  }
}
