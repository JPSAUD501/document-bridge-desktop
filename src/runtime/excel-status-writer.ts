import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import type { ManifestItem, UiPhase } from "../types";
import { APP_TIMEOUTS } from "../config";
import { buildCounts, sleep } from "../lib/utils";
import { translateDownloadStatus, translatePhase, translateUploadStatus } from "../lib/display";

interface ExcelSnapshot {
  items: ManifestItem[];
  phase: UiPhase;
  runDir: string;
}

export class ExcelStatusWriter {
  readonly #excelPath: string;
  readonly #statusListeners = new Set<(status: "idle" | "writing" | "error") => void>();
  readonly #errorListeners = new Set<(error: Error) => void>();
  #pendingSnapshot?: ExcelSnapshot;
  #isWriting = false;

  constructor(excelPath: string) {
    this.#excelPath = excelPath;
  }

  onStatus(listener: (status: "idle" | "writing" | "error") => void): () => void {
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.#errorListeners.add(listener);
    return () => this.#errorListeners.delete(listener);
  }

  schedule(snapshot: ExcelSnapshot): void {
    this.#pendingSnapshot = snapshot;
    if (!this.#isWriting) {
      void this.flush().catch((error) => {
        const resolvedError =
          error instanceof Error ? error : new Error(typeof error === "string" ? error : "Erro desconhecido no Excel");
        this.emitStatus("error");
        for (const listener of this.#errorListeners) {
          listener(resolvedError);
        }
      });
    }
  }

  async flush(): Promise<void> {
    if (this.#isWriting) {
      return;
    }

    this.#isWriting = true;
    while (this.#pendingSnapshot) {
      const snapshot = this.#pendingSnapshot;
      this.#pendingSnapshot = undefined;
      await this.writeSnapshot(snapshot);
    }
    this.#isWriting = false;
    this.emitStatus("idle");
  }

  async #writeWorkbook(snapshot: ExcelSnapshot): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    const itemsSheet = workbook.addWorksheet("itens");
    const summarySheet = workbook.addWorksheet("resumo");

    itemsSheet.columns = [
      { header: "ID", key: "id", width: 22 },
      { header: "OC", key: "poNumber", width: 20 },
      { header: "Linha na lista", key: "sourceRow", width: 14 },
      { header: "Arquivo original", key: "originalFileName", width: 32 },
      { header: "Arquivo salvo", key: "savedFileName", width: 32 },
      { header: "Status do download", key: "downloadStatus", width: 20 },
      { header: "Status do envio", key: "uploadStatus", width: 20 },
      { header: "Tentativas", key: "attempts", width: 12 },
      { header: "Ultimo erro", key: "lastError", width: 40 },
      { header: "Atualizado em", key: "updatedAt", width: 28 },
    ];

    for (const item of snapshot.items) {
      itemsSheet.addRow({
        id: item.id,
        poNumber: item.poNumber,
        sourceRow: item.sourceRow,
        originalFileName: item.originalFileName ?? "",
        savedFileName: item.savedFileName ?? "",
        downloadStatus: translateDownloadStatus(item.downloadStatus),
        uploadStatus: translateUploadStatus(item.uploadStatus),
        attempts: item.attempts,
        lastError: item.lastError ?? "",
        updatedAt: item.updatedAt,
      });
    }

    const counts = buildCounts(snapshot.items);
    summarySheet.addRows([
      ["fase", translatePhase(snapshot.phase)],
      ["pasta_da_execucao", snapshot.runDir],
      ["total", counts.total],
      ["pendentes", counts.pending],
      ["baixando", counts.downloading],
      ["pdfs_baixados", counts.downloaded],
      ["falhas_no_download", counts.downloadFailed],
      ["na_fila_de_envio", counts.queuedForUpload],
      ["enviando", counts.uploading],
      ["enviados", counts.uploaded],
      ["falhas_no_envio", counts.uploadFailed],
    ]);

    const tempPath = `${this.#excelPath}.tmp`;
    await fs.mkdir(path.dirname(this.#excelPath), { recursive: true });
    const buffer = await workbook.xlsx.writeBuffer();
    await fs.writeFile(tempPath, Buffer.from(buffer));
    await fs.rm(this.#excelPath, { force: true }).catch(() => undefined);
    await fs.rename(tempPath, this.#excelPath);
  }

  async writeSnapshot(snapshot: ExcelSnapshot): Promise<void> {
    this.emitStatus("writing");

    let lastError: unknown;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        await this.#writeWorkbook(snapshot);
        this.emitStatus("idle");
        return;
      } catch (error) {
        lastError = error;
        this.emitStatus("error");
        await sleep(APP_TIMEOUTS.excelRetryBase * attempt);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(typeof lastError === "string" ? lastError : "Falha ao gravar o status do Excel.");
  }

  emitStatus(status: "idle" | "writing" | "error"): void {
    for (const listener of this.#statusListeners) {
      listener(status);
    }
  }
}
