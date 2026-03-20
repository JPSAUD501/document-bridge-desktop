import { EventEmitter } from "node:events";
import type { CliOptions, RuntimeSnapshot } from "../types";
import { buildCounts, summarizeError } from "../lib/utils";
import { resolveRunPaths } from "./run-context";
import { RunLogger } from "./logger";
import { ManifestStore } from "./manifest-store";
import { ExcelStatusWriter } from "./excel-status-writer";
import { BrowserManager } from "./browser-manager";
import { ErpCollector } from "./erp-collector";
import { MidasUploader } from "./midas-uploader";

const MAX_RECENT_LOGS = 15;

export class AppController extends EventEmitter {
  readonly #cliOptions: CliOptions;
  readonly #bootstrapNotes: string[];
  #runPaths?: Awaited<ReturnType<typeof resolveRunPaths>>;
  #logger?: RunLogger;
  #manifestStore?: ManifestStore;
  #excelWriter?: ExcelStatusWriter;
  #browserManager?: BrowserManager;
  #startResolver?: () => void;
  #executionStarted = false;
  #executionInFlight = false;
  #snapshot: RuntimeSnapshot = {
    phase: "bootstrap",
    runDir: "",
    downloadsDir: "",
    waitingForStart: true,
    canStart: false,
    canRetry: false,
    browserReady: false,
    totalItems: 0,
    counts: buildCounts([]),
    recentLogs: [],
    manifestItems: [],
    excelStatus: "idle",
    errors: [],
    runStatusMessage: "Inicializando o aplicativo.",
  };

  constructor(cliOptions: CliOptions, bootstrapNotes: string[]) {
    super();
    this.#cliOptions = cliOptions;
    this.#bootstrapNotes = bootstrapNotes;
  }

  get snapshot(): RuntimeSnapshot {
    return this.#snapshot;
  }

  subscribe(listener: (snapshot: RuntimeSnapshot) => void): () => void {
    const wrapped = (snapshot: RuntimeSnapshot) => listener(snapshot);
    this.on("snapshot", wrapped);
    listener(this.#snapshot);
    return () => this.off("snapshot", wrapped);
  }

  async initialize(): Promise<void> {
    try {
      this.#runPaths = await resolveRunPaths(this.#cliOptions);
      this.setSnapshot({
        phase: "preflight",
        runDir: this.#runPaths.runDir,
        downloadsDir: this.#runPaths.downloadsDir,
      });

      this.#logger = new RunLogger(this.#runPaths.logPath);
      await this.#logger.initialize();
      this.#logger.onEntry((entry) => {
        this.#snapshot.recentLogs = [...this.#snapshot.recentLogs, entry].slice(-MAX_RECENT_LOGS);
        this.emitSnapshot();
      });

      for (const note of this.#bootstrapNotes) {
        await this.#logger.info("bootstrap", note);
      }

      this.#manifestStore = new ManifestStore(this.#runPaths.manifestPath, this.#runPaths.runId);
      await this.#manifestStore.initialize();

      this.#excelWriter = new ExcelStatusWriter(this.#runPaths.excelPath);
      this.#excelWriter.onStatus((status) => {
        this.setSnapshot({ excelStatus: status });
      });
      this.#excelWriter.onError((error) => {
        void this.#logger?.warn("excel", "Falha ao atualizar o status.xlsx.", { error: error.message });
        this.setSnapshot({
          errors: [...this.#snapshot.errors, `Excel: ${error.message}`].slice(-10),
        });
      });

      await this.refreshSnapshot();
      await this.#logger.info("system", "Abrindo o navegador.");
      this.#browserManager = new BrowserManager({
        authStatePath: this.#runPaths.authStatePath,
        onStatus: async (message) => {
          await this.#logger?.info("browser", message);
        },
      });
      await this.#browserManager.launch();
      await this.#logger.info("system", "Navegador pronto para login no ERP e na Midas.");

      this.setSnapshot({
        phase: "ready",
        browserReady: true,
        waitingForStart: true,
      });
    } catch (error) {
      const message = summarizeError(error);
      await this.#logger?.error("system", "Falha na inicializacao.", { error: message });
      this.setSnapshot({
        phase: "error",
        browserReady: false,
        waitingForStart: false,
        errors: [...this.#snapshot.errors, message].slice(-10),
      });
      throw error;
    }
  }

  requestStart(): void {
    if (this.#executionStarted || !this.#startResolver) {
      return;
    }

    this.#executionStarted = true;
    this.setSnapshot({ waitingForStart: false });
    this.#startResolver();
  }

  async waitForStartSignal(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.#startResolver = resolve;
    });
    await this.#browserManager?.persistStorageState().catch(async (error) => {
      await this.#logger?.warn("browser", "Falha ao salvar a sessao autenticada.", {
        error: summarizeError(error),
      });
    });
  }

  async execute(): Promise<void> {
    if (this.#executionInFlight) {
      return;
    }

    this.#executionInFlight = true;
    const logger = this.requireLogger();
    const manifestStore = this.requireManifestStore();
    const browserManager = this.requireBrowserManager();

    try {
      const erpCollector = new ErpCollector({
        browserManager,
        downloadsDir: this.requireRunPaths().downloadsDir,
        manifestStore,
        logger,
        onCurrentItem: async (value) => this.setSnapshot({ currentItem: value }),
        onManifestChanged: async () => this.refreshSnapshot(),
      });

      this.setSnapshot({ phase: "downloading" });
      await erpCollector.run();
      await this.refreshSnapshot();

      const uploader = new MidasUploader({
        browserManager,
        manifestStore,
        logger,
        onCurrentBatch: async (value) => this.setSnapshot({ currentBatch: value }),
        onCurrentItem: async (value) => this.setSnapshot({ currentItem: value }),
        onManifestChanged: async () => this.refreshSnapshot(),
      });

      this.setSnapshot({ phase: "uploading", currentItem: undefined });
      await uploader.run();
      await this.refreshSnapshot();
      this.setSnapshot({ phase: "summary", currentItem: undefined, currentBatch: undefined });
      await logger.info("system", "Execucao concluida.");
    } catch (error) {
      const message = summarizeError(error);
      await logger.error("system", "Execucao interrompida por erro.", { error: message });
      this.setSnapshot({
        phase: "error",
        errors: [...this.#snapshot.errors, message].slice(-10),
      });
    } finally {
      this.#executionInFlight = false;
    }
  }

  async retryFailedItems(): Promise<void> {
    if (this.#executionInFlight) {
      return;
    }

    const logger = this.requireLogger();
    const manifestStore = this.requireManifestStore();
    let retriedItems = 0;

    for (const item of manifestStore.items) {
      if (
        item.downloadStatus === "download_failed" ||
        item.downloadStatus === "downloading" ||
        (item.downloadStatus === "pending" && item.uploadStatus === "pending")
      ) {
        await manifestStore.updateItem(item.id, {
          originalFileName: undefined,
          savedFileName: undefined,
          downloadPath: undefined,
          downloadStatus: "pending",
          uploadStatus: "pending",
          lastError: undefined,
        });
        retriedItems += 1;
        continue;
      }

      if (
        item.downloadStatus === "downloaded" &&
        item.uploadStatus !== "uploaded" &&
        item.uploadStatus !== "queued_for_upload"
      ) {
        await manifestStore.updateItem(item.id, {
          uploadStatus: "queued_for_upload",
          lastError: undefined,
        });
        retriedItems += 1;
      }
    }

    if (retriedItems === 0) {
      await logger.info("system", "Nenhum item pendente ou com falha para reprocessar.");
      return;
    }

    this.setSnapshot({
      currentBatch: undefined,
      currentItem: undefined,
      errors: [],
    });
    await this.refreshSnapshot();
    await logger.info("system", "Retry solicitado pela interface desktop.", { items: retriedItems });
    await this.execute();
  }

  async shutdown(): Promise<void> {
    await this.#browserManager?.close().catch(() => undefined);
  }

  async refreshSnapshot(): Promise<void> {
    const items = [...this.requireManifestStore().items].sort((left, right) => left.sourceRow - right.sourceRow);
    this.setSnapshot({
      totalItems: items.length,
      manifestItems: items,
      counts: buildCounts(items),
    });

    this.#excelWriter?.schedule({
      items,
      phase: this.#snapshot.phase,
      runDir: this.#snapshot.runDir,
    });
  }

  setSnapshot(partial: Partial<RuntimeSnapshot>): void {
    this.#snapshot = deriveSnapshotState({ ...this.#snapshot, ...partial });
    this.emitSnapshot();
  }

  emitSnapshot(): void {
    this.emit("snapshot", this.#snapshot);
  }

  requireLogger(): RunLogger {
    if (!this.#logger) {
      throw new Error("Logger not initialized.");
    }
    return this.#logger;
  }

  requireManifestStore(): ManifestStore {
    if (!this.#manifestStore) {
      throw new Error("Manifest store not initialized.");
    }
    return this.#manifestStore;
  }

  requireBrowserManager(): BrowserManager {
    if (!this.#browserManager) {
      throw new Error("Browser manager not initialized.");
    }
    return this.#browserManager;
  }

  requireRunPaths(): Awaited<ReturnType<typeof resolveRunPaths>> {
    if (!this.#runPaths) {
      throw new Error("Run paths not initialized.");
    }
    return this.#runPaths;
  }
}

function deriveSnapshotState(snapshot: RuntimeSnapshot): RuntimeSnapshot {
  const canRetry =
    snapshot.browserReady &&
    !snapshot.waitingForStart &&
    (snapshot.phase === "summary" || snapshot.phase === "error") &&
    (snapshot.counts.pending > 0 ||
      snapshot.counts.downloading > 0 ||
      snapshot.counts.downloadFailed > 0 ||
      snapshot.counts.queuedForUpload > 0 ||
      snapshot.counts.uploading > 0 ||
      snapshot.counts.uploadFailed > 0);

  const canStart = snapshot.phase === "ready" && snapshot.waitingForStart && snapshot.browserReady;

  return {
    ...snapshot,
    canStart,
    canRetry,
    runStatusMessage: buildRunStatusMessage(snapshot, canRetry),
  };
}

function buildRunStatusMessage(snapshot: RuntimeSnapshot, canRetry: boolean): string {
  if (snapshot.phase === "bootstrap") {
    return "Preparando os diretórios da execução e restaurando o contexto local.";
  }

  if (snapshot.phase === "preflight") {
    return "Abrindo o navegador externo e preparando ERP e Midas para a automação.";
  }

  if (snapshot.phase === "ready" && snapshot.waitingForStart) {
    return "ERP e Midas devem estar prontos. Use o botão de início quando as duas páginas estiverem posicionadas.";
  }

  if (snapshot.phase === "downloading") {
    return "Baixando os PDFs do ERP. Mantenha o navegador aberto até o lote terminar.";
  }

  if (snapshot.phase === "uploading") {
    return "Enviando os arquivos processados para a Midas.";
  }

  if (snapshot.phase === "summary") {
    return canRetry
      ? "A execução terminou com pendências. Você pode tentar novamente apenas os itens restantes."
      : "Execução concluída. Revise o resumo e os arquivos gerados.";
  }

  if (snapshot.phase === "error") {
    return canRetry
      ? "A execução parou com erro, mas há itens elegíveis para novo processamento."
      : "A execução falhou. Revise os detalhes e reinicie o fluxo se necessário.";
  }

  return "Acompanhe o andamento em tempo real pela interface.";
}
