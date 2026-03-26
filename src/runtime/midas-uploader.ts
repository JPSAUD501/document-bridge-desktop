import fs from "node:fs/promises";
import { chunk, summarizeError } from "../lib/utils";
import type { ManifestItem } from "../types";
import type { BrowserManager } from "./browser-manager";
import type { ManifestStore } from "./manifest-store";
import type { RunLogger } from "./logger";

const MIDAS_BATCH_SIZE = 5;

interface MidasUploaderOptions {
  browserManager: BrowserManager;
  manifestStore: ManifestStore;
  logger: RunLogger;
  onCurrentBatch: (value?: string) => Promise<void>;
  onCurrentItem: (value?: string) => Promise<void>;
  onManifestChanged: () => Promise<void>;
}

export class MidasUploader {
  readonly #browserManager: BrowserManager;
  readonly #manifestStore: ManifestStore;
  readonly #logger: RunLogger;
  readonly #onCurrentBatch: (value?: string) => Promise<void>;
  readonly #onCurrentItem: (value?: string) => Promise<void>;
  readonly #onManifestChanged: () => Promise<void>;

  constructor(options: MidasUploaderOptions) {
    this.#browserManager = options.browserManager;
    this.#manifestStore = options.manifestStore;
    this.#logger = options.logger;
    this.#onCurrentBatch = options.onCurrentBatch;
    this.#onCurrentItem = options.onCurrentItem;
    this.#onManifestChanged = options.onManifestChanged;
  }

  async run(): Promise<void> {
    const pending = this.#manifestStore.items.filter(
      (item) =>
        item.downloadStatus === "downloaded" &&
        item.downloadPath &&
        item.uploadStatus !== "uploaded",
    );
    const batches = chunk(pending, MIDAS_BATCH_SIZE);
    await this.#logger.info("midas", "Preparando a fila de envio.", {
      pending: pending.length,
      batches: batches.length,
    });

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex];
      if (!batch) {
        continue;
      }

      const label = `${batchIndex + 1}/${batches.length}`;
      await this.#onCurrentBatch(label);
      const supportsMultiple = await this.#browserManager.getMidasSupportsMultiple();

      if (supportsMultiple) {
        await this.uploadBatch(batch, label);
      } else {
        for (const item of batch) {
          await this.uploadSingle(item);
        }
      }
    }

    await this.#onCurrentBatch(undefined);
    await this.#onCurrentItem(undefined);
  }

  async uploadBatch(batch: ManifestItem[], label: string): Promise<void> {
    const readyItems = batch.filter((item) => item.downloadPath);
    const filePaths = readyItems.map((item) => item.downloadPath as string);

    try {
      for (const item of readyItems) {
        await this.#manifestStore.updateItem(item.id, { uploadStatus: "uploading", lastError: undefined });
      }
      await this.#onManifestChanged();

      await this.#browserManager.uploadMidasFiles(filePaths);

      for (const item of readyItems) {
        await this.#manifestStore.updateItem(item.id, { uploadStatus: "uploaded", lastError: undefined });
      }
      await this.#onManifestChanged();
      await this.#logger.info("midas", "Lote enviado com sucesso.", {
        batch: label,
        count: readyItems.length,
      });
    } catch (error) {
      for (const item of readyItems) {
        await this.#manifestStore.updateItem(item.id, {
          uploadStatus: "upload_failed",
          lastError: summarizeError(error),
        });
      }
      await this.#onManifestChanged();
      await this.#logger.error("midas", "Falha ao enviar o lote.", {
        batch: label,
        error: summarizeError(error),
      });
    }
  }

  async uploadSingle(item: ManifestItem): Promise<void> {
    if (!item.downloadPath) {
      return;
    }

    await this.#onCurrentItem(item.poNumber);
    try {
      await fs.access(item.downloadPath);
      await this.#manifestStore.updateItem(item.id, { uploadStatus: "uploading", lastError: undefined });
      await this.#onManifestChanged();

      await this.#browserManager.uploadMidasFiles([item.downloadPath]);

      await this.#manifestStore.updateItem(item.id, { uploadStatus: "uploaded", lastError: undefined });
      await this.#onManifestChanged();
      await this.#logger.info("midas", "Arquivo enviado com sucesso.", { poNumber: item.poNumber });
    } catch (error) {
      await this.#manifestStore.updateItem(item.id, {
        uploadStatus: "upload_failed",
        lastError: summarizeError(error),
      });
      await this.#onManifestChanged();
      await this.#logger.error("midas", "Falha ao enviar o arquivo.", {
        poNumber: item.poNumber,
        error: summarizeError(error),
      });
    }
  }
}
