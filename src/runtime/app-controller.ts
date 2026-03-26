import { EventEmitter } from "node:events";
import path from "node:path";
import type { CliOptions, RuntimeSnapshot } from "../types";
import { buildCounts, findWorkspaceRoot, summarizeError } from "../lib/utils";
import { resolveAuthStatePath, resolveRunPaths } from "./run-context";
import { RunLogger } from "./logger";
import { ManifestStore } from "./manifest-store";
import { ExcelStatusWriter } from "./excel-status-writer";
import { BrowserManager } from "./browser-manager";
import { ErpCollector } from "./erp-collector";
import { MidasUploader } from "./midas-uploader";
import { validateAutomationTargets } from "../config";

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
    outputRootDir: "",
    runDir: "",
    downloadsDir: "",
    waitingForStart: true,
    canStart: false,
    canRetry: false,
    browserReady: false,
    visibleOcCountIsPreview: true,
    isDiscoveryComplete: false,
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
      validateAutomationTargets();
      const workspaceRoot = await findWorkspaceRoot();
      const authStatePath = await resolveAuthStatePath(workspaceRoot);

      this.setSnapshot({ phase: "preflight" });
      this.#browserManager = new BrowserManager({
        authStatePath,
        onStatus: async (message) => {
          await this.#logger?.info("browser", message);
        },
      });

      await this.#browserManager.launch();

      this.setSnapshot({
        phase: "ready",
        browserReady: true,
        waitingForStart: true,
      });
      await this.inspectErpVisibleCount({ silent: true });
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

  async requestStart(outputRootPath?: string): Promise<void> {
    if (this.#executionStarted || !this.#startResolver) {
      return;
    }

    try {
      if (!this.#runPaths) {
        await this.prepareRun(outputRootPath);
      }
    } catch (error) {
      this.setSnapshot({
        errors: [...this.#snapshot.errors, summarizeError(error)].slice(-10),
      });
      throw error;
    }

    this.#executionStarted = true;
    this.setSnapshot({ waitingForStart: false });
    this.#startResolver();
  }

  async inspectErpVisibleCount(options: { silent?: boolean } = { silent: true }): Promise<void> {
    if (!this.#browserManager || this.#executionStarted || this.#executionInFlight) {
      return;
    }

    try {
      const visiblePoNumbers = await this.#browserManager.inspectVisiblePoNumbers();
      this.setSnapshot({
        visibleOcCount: visiblePoNumbers.length,
        visibleOcCountIsPreview: true,
      });
      if (!options.silent) {
        await this.#logger?.info("erp", "Previa do ERP atualizada.", {
          visible: visiblePoNumbers.length,
        });
      }
    } catch (error) {
      if (!options.silent) {
        await this.#logger?.warn("erp", "Falha ao atualizar a previa do ERP.", {
          error: summarizeError(error),
        });
      }
    }
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

      this.setSnapshot({
        phase: "discovering",
        currentItem: undefined,
        currentBatch: undefined,
        discoveredOcCount: manifestStore.items.length,
        visibleOcCountIsPreview: true,
        isDiscoveryComplete: false,
      });
      await erpCollector.discover();
      await this.refreshSnapshot();
      this.setSnapshot({
        phase: "downloading",
        currentItem: undefined,
        discoveredOcCount: manifestStore.items.length,
        visibleOcCountIsPreview: true,
        isDiscoveryComplete: true,
      });
      await erpCollector.downloadDiscovered();
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
      discoveredOcCount:
        items.length > 0 || this.#snapshot.phase === "discovering" || this.#snapshot.isDiscoveryComplete
          ? items.length
          : this.#snapshot.discoveredOcCount,
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

  async prepareRun(outputRootPath?: string): Promise<void> {
    const runPaths = await resolveRunPaths({
      ...this.#cliOptions,
      outputRootPath: outputRootPath ?? this.#cliOptions.outputRootPath,
    });

    try {
      this.setSnapshot({
        outputRootDir: path.dirname(runPaths.runDir),
        runDir: runPaths.runDir,
        downloadsDir: runPaths.downloadsDir,
        visibleOcCountIsPreview: true,
        discoveredOcCount: 0,
        isDiscoveryComplete: false,
      });

      const logger = new RunLogger(runPaths.logPath);
      await logger.initialize();
      logger.onEntry((entry) => {
        this.#snapshot.recentLogs = [...this.#snapshot.recentLogs, entry].slice(-MAX_RECENT_LOGS);
        this.emitSnapshot();
      });

      for (const note of this.#bootstrapNotes) {
        await logger.info("bootstrap", note);
      }

      const manifestStore = new ManifestStore(runPaths.manifestPath, runPaths.runId);
      await manifestStore.initialize();

      const excelWriter = new ExcelStatusWriter(runPaths.excelPath);
      excelWriter.onStatus((status) => {
        this.setSnapshot({ excelStatus: status });
      });
      excelWriter.onError((error) => {
        void this.#logger?.warn("excel", "Falha ao atualizar o status.xlsx.", { error: error.message });
        this.setSnapshot({
          errors: [...this.#snapshot.errors, `Excel: ${error.message}`].slice(-10),
        });
      });

      this.#runPaths = runPaths;
      this.#logger = logger;
      this.#manifestStore = manifestStore;
      this.#excelWriter = excelWriter;

      await this.refreshSnapshot();
    } catch (error) {
      this.#runPaths = undefined;
      this.#logger = undefined;
      this.#manifestStore = undefined;
      this.#excelWriter = undefined;
      throw error;
    }
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
    return "Inicializando o aplicativo e restaurando o contexto local.";
  }

  if (snapshot.phase === "preflight") {
    return "Abrindo o navegador externo e preparando ERP e Midas para a automacao.";
  }

  if (snapshot.phase === "ready" && snapshot.waitingForStart) {
    return snapshot.visibleOcCount != null
      ? `ERP e Midas devem estar prontos. Previa atual: ${snapshot.visibleOcCount} OCs visiveis na janela atual do ERP. Ao iniciar, voce vai escolher a pasta raiz onde as runs serao salvas.`
      : "ERP e Midas devem estar prontos. Ao iniciar, voce vai escolher a pasta raiz onde as runs serao salvas.";
  }

  if (snapshot.phase === "discovering") {
    return snapshot.discoveredOcCount != null && snapshot.discoveredOcCount > 0
      ? `Varrendo o ERP para mapear todas as OCs filtradas. ${snapshot.discoveredOcCount} OCs ja foram encontradas.`
      : "Varrendo o ERP para mapear todas as OCs filtradas antes dos downloads.";
  }

  if (snapshot.phase === "downloading") {
    return snapshot.discoveredOcCount != null && snapshot.discoveredOcCount > 0
      ? `Baixando os PDFs do ERP para ${snapshot.discoveredOcCount} OCs descobertas. Mantenha o navegador aberto ate o lote terminar.`
      : "Baixando os PDFs do ERP. Mantenha o navegador aberto ate o lote terminar.";
  }

  if (snapshot.phase === "uploading") {
    return "Enviando os arquivos processados para a Midas.";
  }

  if (snapshot.phase === "summary") {
    return canRetry
      ? "A execucao terminou com pendencias. Voce pode tentar novamente apenas os itens restantes."
      : "Execucao concluida. Revise o resumo e os arquivos gerados.";
  }

  if (snapshot.phase === "error") {
    return canRetry
      ? "A execucao parou com erro, mas ha itens elegiveis para novo processamento."
      : "A execucao falhou. Revise os detalhes e reinicie o fluxo se necessario.";
  }

  return "Acompanhe o andamento em tempo real pela interface.";
}
