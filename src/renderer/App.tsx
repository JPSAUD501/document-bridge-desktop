import { useEffect, useMemo, useState, type ReactElement } from "react";
import {
  formatLogDetails,
  formatLogTimestamp,
  summarizeManifestItem,
  translateExcelStatus,
  translateLogLevel,
  translatePhase,
  translateStage,
} from "../lib/display";
import type { UpdateState } from "../shared/contracts";
import { defaultUpdateState } from "../shared/defaults";
import type { RuntimeSnapshot } from "../types";

const emptySnapshot: RuntimeSnapshot = {
  phase: "bootstrap",
  runDir: "",
  downloadsDir: "",
  waitingForStart: true,
  canStart: false,
  canRetry: false,
  browserReady: false,
  totalItems: 0,
  counts: {
    total: 0,
    pending: 0,
    downloading: 0,
    downloaded: 0,
    downloadFailed: 0,
    queuedForUpload: 0,
    uploading: 0,
    uploaded: 0,
    uploadFailed: 0,
  },
  recentLogs: [],
  manifestItems: [],
  excelStatus: "idle",
  errors: [],
  runStatusMessage: "Inicializando o painel desktop.",
};

export function App(): ReactElement {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(emptySnapshot);
  const [updateState, setUpdateState] = useState<UpdateState>(defaultUpdateState);
  const [busyAction, setBusyAction] = useState<"start" | "retry" | "folder" | null>(null);

  useEffect(() => {
    let mounted = true;

    void window.erpMidas.getSnapshot().then((value) => {
      if (mounted) {
        setSnapshot(value);
      }
    });
    void window.erpMidas.getUpdateState().then((value) => {
      if (mounted) {
        setUpdateState(value);
      }
    });

    const unsubscribeSnapshot = window.erpMidas.subscribeSnapshot((value) => {
      if (mounted) {
        setSnapshot(value);
      }
    });
    const unsubscribeUpdate = window.erpMidas.subscribeUpdateState((value) => {
      if (mounted) {
        setUpdateState(value);
      }
    });

    return () => {
      mounted = false;
      unsubscribeSnapshot();
      unsubscribeUpdate();
    };
  }, []);

  const recentItems = useMemo(
    () => snapshot.manifestItems.slice(Math.max(snapshot.manifestItems.length - 6, 0)).reverse(),
    [snapshot.manifestItems],
  );

  const recentLogs = useMemo(
    () => snapshot.recentLogs.slice(Math.max(snapshot.recentLogs.length - 8, 0)).reverse(),
    [snapshot.recentLogs],
  );

  const updateLabel = buildUpdateLabel(updateState);

  const startRun = async () => {
    setBusyAction("start");
    try {
      await window.erpMidas.requestStart();
    } finally {
      setBusyAction(null);
    }
  };

  const retryRun = async () => {
    setBusyAction("retry");
    try {
      await window.erpMidas.retryFailedItems();
    } finally {
      setBusyAction(null);
    }
  };

  const openRunFolder = async () => {
    if (!snapshot.runDir) {
      return;
    }

    setBusyAction("folder");
    try {
      await window.erpMidas.openPath(snapshot.runDir);
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <main className="shell">
      <section className="hero">
        <div className="hero__eyebrow">ERP MIDAS / DESKTOP ORCHESTRATOR</div>
        <div className="hero__grid">
          <div>
            <h1>Automação visual, com navegador externo e controle explícito.</h1>
            <p className="hero__summary">{snapshot.runStatusMessage}</p>
          </div>

          <aside className="hero__status">
            <span className={`phase-chip phase-chip--${snapshot.phase}`}>{translatePhase(snapshot.phase)}</span>
            <div className="hero__status-line">
              <span>Updater</span>
              <strong>{updateLabel}</strong>
            </div>
            <div className="hero__status-line">
              <span>Navegador</span>
              <strong>{snapshot.browserReady ? "Pronto" : "Abrindo"}</strong>
            </div>
          </aside>
        </div>
      </section>

      <section className="command-bar">
        <button
          className="button button--primary"
          onClick={() => void startRun()}
          disabled={!snapshot.canStart || busyAction !== null}
        >
          {busyAction === "start" ? "Iniciando..." : "Iniciar automação"}
        </button>
        <button
          className="button button--secondary"
          onClick={() => void retryRun()}
          disabled={!snapshot.canRetry || busyAction !== null}
        >
          {busyAction === "retry" ? "Reprocessando..." : "Retry dos itens pendentes"}
        </button>
        <button
          className="button button--ghost"
          onClick={() => void openRunFolder()}
          disabled={!snapshot.runDir || busyAction !== null}
        >
          {busyAction === "folder" ? "Abrindo..." : "Abrir pasta da execução"}
        </button>
      </section>

      <section className="metrics-strip">
        <Metric label="Total" value={snapshot.counts.total} tone="dark" />
        <Metric label="Pendentes" value={snapshot.counts.pending} tone="amber" />
        <Metric label="Baixando" value={snapshot.counts.downloading} tone="blue" />
        <Metric label="Baixados" value={snapshot.counts.downloaded} tone="green" />
        <Metric label="Fila envio" value={snapshot.counts.queuedForUpload} tone="amber" />
        <Metric label="Enviando" value={snapshot.counts.uploading} tone="blue" />
        <Metric label="Enviados" value={snapshot.counts.uploaded} tone="green" />
        <Metric label="Falhas" value={snapshot.counts.downloadFailed + snapshot.counts.uploadFailed} tone="red" />
      </section>

      <section className="content-grid">
        <article className="panel panel--lead">
          <header className="panel__header">
            <div>
              <div className="panel__kicker">Operação</div>
              <h2>Preparação e contexto</h2>
            </div>
            <div className="excel-pill">{translateExcelStatus(snapshot.excelStatus)}</div>
          </header>

          <dl className="detail-list">
            <div>
              <dt>Pasta da execução</dt>
              <dd>{snapshot.runDir || "Será criada ao iniciar o fluxo."}</dd>
            </div>
            <div>
              <dt>Pasta dos PDFs</dt>
              <dd>{snapshot.downloadsDir || "Aguardando inicialização."}</dd>
            </div>
            <div>
              <dt>Nota atual</dt>
              <dd>{snapshot.currentItem || "Nenhuma nota ativa no momento."}</dd>
            </div>
            <div>
              <dt>Lote atual</dt>
              <dd>{snapshot.currentBatch || "Nenhum lote em processamento."}</dd>
            </div>
          </dl>

          <div className="steps">
            <div className="steps__title">Fluxo recomendado</div>
            <ol>
              <li>Entre no ERP e aplique o filtro com as notas desejadas.</li>
              <li>Entre na Midas e deixe a tela de upload aberta.</li>
              <li>Quando o navegador estiver pronto, use o botão de início.</li>
            </ol>
          </div>
        </article>

        <article className="panel">
          <header className="panel__header">
            <div>
              <div className="panel__kicker">Itens</div>
              <h2>Últimas notas processadas</h2>
            </div>
            <strong>{snapshot.totalItems}</strong>
          </header>

          <div className="table">
            <div className="table__head">
              <span>OC</span>
              <span>Situação</span>
            </div>
            {recentItems.length > 0 ? (
              recentItems.map((item) => (
                <div className="table__row" key={item.id}>
                  <span>{item.poNumber}</span>
                  <span>{summarizeManifestItem(item)}</span>
                </div>
              ))
            ) : (
              <div className="empty-state">As notas aparecerão aqui conforme a leitura do ERP avançar.</div>
            )}
          </div>
        </article>

        <article className="panel">
          <header className="panel__header">
            <div>
              <div className="panel__kicker">Falhas</div>
              <h2>Pontos de atenção</h2>
            </div>
          </header>

          {snapshot.errors.length > 0 ? (
            <ul className="error-list">
              {snapshot.errors.slice(-5).reverse().map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">Nenhuma falha recente registrada.</div>
          )}
        </article>

        <article className="panel panel--timeline">
          <header className="panel__header">
            <div>
              <div className="panel__kicker">Logs</div>
              <h2>Linha do tempo operacional</h2>
            </div>
          </header>

          <div className="timeline">
            {recentLogs.length > 0 ? (
              recentLogs.map((entry) => (
                <div className="timeline__entry" key={`${entry.timestamp}-${entry.message}`}>
                  <div className="timeline__meta">
                    <span>{formatLogTimestamp(entry.timestamp)}</span>
                    <strong>{translateLogLevel(entry.level)}</strong>
                    <span>{translateStage(entry.stage)}</span>
                  </div>
                  <div className="timeline__body">{entry.message}</div>
                  {formatLogDetails(entry.details) ? (
                    <div className="timeline__details">{formatLogDetails(entry.details)}</div>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="empty-state">A linha do tempo será preenchida assim que a execução começar.</div>
            )}
          </div>
        </article>
      </section>
    </main>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "dark" | "amber" | "blue" | "green" | "red";
}): ReactElement {
  return (
    <div className={`metric metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function buildUpdateLabel(updateState: UpdateState): string {
  switch (updateState.status) {
    case "checking":
      return "Verificando atualização";
    case "available":
    case "downloading":
      return updateState.availableVersion
        ? `Baixando ${updateState.availableVersion}${updateState.downloadProgress != null ? ` (${updateState.downloadProgress}%)` : ""}`
        : "Baixando atualização";
    case "downloaded":
      return updateState.pendingInstallVersion
        ? `Pronto para instalar no próximo início (${updateState.pendingInstallVersion})`
        : "Pronto para instalar no próximo início";
    case "installing":
      return "Instalando atualização pendente";
    case "error":
      return "Falha ao verificar";
    case "unsupported":
      return "Desativado no modo de desenvolvimento";
    case "disabled":
      return "Desativado";
    case "idle":
    default:
      return updateState.lastCheckedAt ? "Atualizado" : "Aguardando verificação";
  }
}
