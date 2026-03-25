import { useEffect, useMemo, useState, type ReactElement } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Play,
  RefreshCw,
  FolderOpen,
  Download,
  Upload,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRightCircle,
  FileText,
  Globe,
  Loader2,
  AlertTriangle,
  Activity,
} from "lucide-react";
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
import type { LogEntry, ManifestItem, RuntimeSnapshot, UiPhase } from "../types";

/* ============================================================
   ESTADO VAZIO INICIAL
   ============================================================ */

const emptySnapshot: RuntimeSnapshot = {
  phase: "bootstrap",
  outputRootDir: "",
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

/* ============================================================
   APP ROOT
   ============================================================ */

export function App(): ReactElement {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(emptySnapshot);
  const [updateState, setUpdateState] = useState<UpdateState>(defaultUpdateState);
  const [busyAction, setBusyAction] = useState<"start" | "retry" | "folder" | "update" | null>(null);

  useEffect(() => {
    let mounted = true;

    void window.erpMidas.getSnapshot().then((v) => { if (mounted) setSnapshot(v); });
    void window.erpMidas.getUpdateState().then((v) => { if (mounted) setUpdateState(v); });

    const unsubSnap = window.erpMidas.subscribeSnapshot((v) => { if (mounted) setSnapshot(v); });
    const unsubUpd  = window.erpMidas.subscribeUpdateState((v) => { if (mounted) setUpdateState(v); });

    return () => { mounted = false; unsubSnap(); unsubUpd(); };
  }, []);

  const recentItems = useMemo(
    () => snapshot.manifestItems.slice(Math.max(snapshot.manifestItems.length - 8, 0)).reverse(),
    [snapshot.manifestItems],
  );

  const recentLogs = useMemo(
    () => snapshot.recentLogs.slice(Math.max(snapshot.recentLogs.length - 10, 0)).reverse(),
    [snapshot.recentLogs],
  );

  const startRun = async () => {
    setBusyAction("start");
    try { await window.erpMidas.requestStart(); } finally { setBusyAction(null); }
  };

  const retryRun = async () => {
    setBusyAction("retry");
    try { await window.erpMidas.retryFailedItems(); } finally { setBusyAction(null); }
  };

  const openRunFolder = async () => {
    if (!snapshot.runDir) return;
    setBusyAction("folder");
    try { await window.erpMidas.openPath(snapshot.runDir); } finally { setBusyAction(null); }
  };

  const installUpdate = async () => {
    setBusyAction("update");
    try { await window.erpMidas.installUpdate(); } finally { setBusyAction(null); }
  };

  return (
    <div className="app-shell">
      <AppHeader
        snapshot={snapshot}
        updateState={updateState}
        updateBusy={busyAction === "update"}
        onInstallUpdate={() => void installUpdate()}
      />
      <main className="app-content">
        <ActionBar
          snapshot={snapshot}
          busyAction={busyAction}
          onStart={() => void startRun()}
          onRetry={() => void retryRun()}
          onFolder={() => void openRunFolder()}
        />
        <MetricsSection snapshot={snapshot} />
        <div className="content-grid">
          <OperationPanel snapshot={snapshot} />
          <div className="content-grid__right">
            <ItemsPanel items={recentItems} total={snapshot.totalItems} />
            <ErrorsPanel errors={snapshot.errors} />
          </div>
        </div>
        <TimelinePanel logs={recentLogs} />
      </main>
    </div>
  );
}

/* ============================================================
   HEADER
   ============================================================ */

function AppHeader({
  snapshot,
  updateState,
  updateBusy,
  onInstallUpdate,
}: {
  snapshot: RuntimeSnapshot;
  updateState: UpdateState;
  updateBusy: boolean;
  onInstallUpdate: () => void;
}): ReactElement {
  const updateLabel = buildUpdateLabel(updateState);
  const canInstallUpdate = updateState.status === "downloaded" && Boolean(updateState.pendingInstallVersion);

  return (
    <header className="header">
      <div className="header__brand">
        <Activity size={19} className="header__brand-icon" />
        <div>
          <div className="header__eyebrow">ERP → MIDAS ORCHESTRATOR</div>
          <h1 className="header__title">Document Bridge</h1>
        </div>
      </div>

      <div className="header__status-cluster">
        <PhaseBadge phase={snapshot.phase} />
        <StatusPill
          icon={<Globe size={12} />}
          label="Navegador"
          value={snapshot.browserReady ? "Pronto" : "Iniciando"}
          active={snapshot.browserReady}
        />
        <StatusPill
          icon={<Download size={12} />}
          label="Updater"
          value={updateLabel}
        />
        {canInstallUpdate && (
          <button className="btn btn--primary" onClick={onInstallUpdate} disabled={updateBusy}>
            {updateBusy ? (
              <Loader2 size={15} className="btn__icon btn__icon--spin" />
            ) : (
              <Download size={15} className="btn__icon" />
            )}
            {updateBusy ? "Atualizando..." : "Atualizar"}
          </button>
        )}
      </div>
    </header>
  );
}

function PhaseBadge({ phase }: { phase: UiPhase }): ReactElement {
  const isActive = phase === "downloading" || phase === "uploading";

  return (
    <div className={`phase-badge phase-badge--${phase}`}>
      {isActive ? (
        <motion.span
          className="phase-badge__dot"
          animate={{ opacity: [1, 0.25, 1] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
        />
      ) : (
        <span className="phase-badge__dot" style={{ opacity: 0.5 }} />
      )}
      {translatePhase(phase)}
    </div>
  );
}

function StatusPill({
  icon,
  label,
  value,
  active,
}: {
  icon: ReactElement;
  label: string;
  value: string;
  active?: boolean;
}): ReactElement {
  return (
    <div className="status-pill">
      {icon}
      <span>{label}</span>
      <span className="status-pill__sep">·</span>
      <span className={`status-pill__value${active ? " status-pill__value--active" : ""}`}>
        {value}
      </span>
    </div>
  );
}

/* ============================================================
   ACTION BAR
   ============================================================ */

function ActionBar({
  snapshot,
  busyAction,
  onStart,
  onRetry,
  onFolder,
}: {
  snapshot: RuntimeSnapshot;
  busyAction: "start" | "retry" | "folder" | "update" | null;
  onStart: () => void;
  onRetry: () => void;
  onFolder: () => void;
}): ReactElement {
  return (
    <section className="action-bar">
      <div className="action-bar__buttons">
        <button
          className="btn btn--primary"
          onClick={onStart}
          disabled={!snapshot.canStart || busyAction !== null}
        >
          {busyAction === "start" ? (
            <Loader2 size={15} className="btn__icon btn__icon--spin" />
          ) : (
            <Play size={15} className="btn__icon" />
          )}
          {busyAction === "start" ? "Iniciando..." : "Iniciar automação"}
        </button>

        <button
          className="btn btn--secondary"
          onClick={onRetry}
          disabled={!snapshot.canRetry || busyAction !== null}
        >
          {busyAction === "retry" ? (
            <Loader2 size={15} className="btn__icon btn__icon--spin" />
          ) : (
            <RefreshCw size={15} className="btn__icon" />
          )}
          {busyAction === "retry" ? "Reprocessando..." : "Retry dos pendentes"}
        </button>

        <button
          className="btn btn--ghost"
          onClick={onFolder}
          disabled={!snapshot.runDir || busyAction !== null}
        >
          {busyAction === "folder" ? (
            <Loader2 size={15} className="btn__icon btn__icon--spin" />
          ) : (
            <FolderOpen size={15} className="btn__icon" />
          )}
          {busyAction === "folder" ? "Abrindo..." : "Abrir pasta da execução"}
        </button>
      </div>

      <div className="action-bar__message">
        <span className="action-bar__message-text">{snapshot.runStatusMessage}</span>
        <span className="excel-tag">{translateExcelStatus(snapshot.excelStatus)}</span>
      </div>
    </section>
  );
}

/* ============================================================
   METRICS
   ============================================================ */

type MetricTone = "dark" | "amber" | "blue" | "green" | "red";

interface MetricDef {
  label: string;
  value: number;
  tone: MetricTone;
  icon: ReactElement;
  subtitle?: string;
  pulse?: boolean;
}

function MetricsSection({ snapshot }: { snapshot: RuntimeSnapshot }): ReactElement {
  const { counts } = snapshot;
  const total = counts.total;

  const dlPct  = total > 0 ? Math.round((counts.downloaded / total) * 100) : 0;
  const ulPct  = total > 0 ? Math.round((counts.uploaded / total) * 100)   : 0;

  const metrics: MetricDef[] = [
    {
      label: "Total",
      value: counts.total,
      tone: "dark",
      icon: <FileText size={16} />,
    },
    {
      label: "Pendentes",
      value: counts.pending,
      tone: "amber",
      icon: <Clock size={16} />,
      pulse: counts.pending > 0,
    },
    {
      label: "Baixando",
      value: counts.downloading,
      tone: "blue",
      icon: <Download size={16} />,
      pulse: counts.downloading > 0,
    },
    {
      label: "Baixados",
      value: counts.downloaded,
      tone: "green",
      icon: <CheckCircle2 size={16} />,
      subtitle: total > 0 ? `${dlPct}%` : undefined,
    },
    {
      label: "Fila de envio",
      value: counts.queuedForUpload,
      tone: "amber",
      icon: <ArrowRightCircle size={16} />,
      pulse: counts.queuedForUpload > 0,
    },
    {
      label: "Enviando",
      value: counts.uploading,
      tone: "blue",
      icon: <Upload size={16} />,
      pulse: counts.uploading > 0,
    },
    {
      label: "Enviados",
      value: counts.uploaded,
      tone: "green",
      icon: <CheckCircle2 size={16} />,
      subtitle: total > 0 ? `${ulPct}%` : undefined,
    },
    {
      label: "Falhas",
      value: counts.downloadFailed + counts.uploadFailed,
      tone: "red",
      icon: <XCircle size={16} />,
    },
  ];

  return (
    <section className="metrics-section">
      <div className="metrics-grid">
        {metrics.map((m, i) => (
          <MetricCard key={m.label} metric={m} index={i} />
        ))}
      </div>

      {total > 0 && (
        <div className="progress-section">
          <ProgressBar
            label="Downloads"
            current={counts.downloaded}
            total={total}
            pct={dlPct}
            tone="green"
          />
          <ProgressBar
            label="Uploads"
            current={counts.uploaded}
            total={total}
            pct={ulPct}
            tone="blue"
          />
        </div>
      )}
    </section>
  );
}

function MetricCard({ metric, index }: { metric: MetricDef; index: number }): ReactElement {
  return (
    <motion.div
      className={`metric-card metric-card--${metric.tone}${metric.pulse && metric.value > 0 ? " metric-card--active-pulse" : ""}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.28, ease: "easeOut" }}
    >
      <div className="metric-card__top">
        <span className="metric-card__label">{metric.label}</span>
        <span className="metric-card__icon">{metric.icon}</span>
      </div>
      <div className="metric-card__bottom">
        <strong className="metric-card__value">{metric.value}</strong>
        {metric.subtitle && (
          <span className="metric-card__subtitle">{metric.subtitle}</span>
        )}
      </div>
    </motion.div>
  );
}

function ProgressBar({
  label,
  current,
  total,
  pct,
  tone,
}: {
  label: string;
  current: number;
  total: number;
  pct: number;
  tone: "green" | "blue";
}): ReactElement {
  return (
    <div className="progress-bar">
      <div className="progress-bar__header">
        <span className="progress-bar__label">{label}</span>
        <div className="progress-bar__stats">
          <span className={`progress-bar__count progress-bar__count--${tone}`}>
            {current}/{total}
          </span>
          <span className="progress-bar__pct">{pct}%</span>
        </div>
      </div>
      <div className="progress-bar__track">
        <motion.div
          className={`progress-bar__fill progress-bar__fill--${tone}`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.55, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

/* ============================================================
   OPERATION PANEL
   ============================================================ */

function OperationPanel({ snapshot }: { snapshot: RuntimeSnapshot }): ReactElement {
  return (
    <div className="panel">
      <div className="panel__header">
        <div>
          <div className="panel__kicker">Operação</div>
          <h2 className="panel__title">Preparação e contexto</h2>
        </div>
        <div className="panel__header-right">
          <span className="excel-pill">{translateExcelStatus(snapshot.excelStatus)}</span>
        </div>
      </div>

      <dl className="detail-grid">
        <DetailRow label="Pasta de execução" value={snapshot.runDir || "Será criada ao iniciar o fluxo."} />
        <DetailRow label="Pasta dos PDFs"    value={snapshot.downloadsDir || "Aguardando inicialização."} />
        <DetailRow label="Pasta raiz das runs" value={snapshot.outputRootDir || "Sera escolhida ao iniciar o fluxo."} />
        <DetailRow label="Nota atual"         value={snapshot.currentItem  || "Nenhuma nota ativa no momento."} />
        <DetailRow label="Lote atual"         value={snapshot.currentBatch || "Nenhum lote em processamento."} />
      </dl>

      <div className="steps-guide">
        <div className="steps-guide__title">Fluxo recomendado</div>
        <ol className="steps-guide__list">
          <li>Entre no ERP e aplique o filtro com as notas desejadas.</li>
          <li>Entre na Midas e deixe a tela de upload aberta.</li>
          <li>Quando o navegador estiver pronto, use o botão de início.</li>
        </ol>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="detail-row">
      <dt className="detail-row__label">{label}</dt>
      <dd className="detail-row__value">{value}</dd>
    </div>
  );
}

/* ============================================================
   ITEMS PANEL
   ============================================================ */

function ItemsPanel({
  items,
  total,
}: {
  items: ManifestItem[];
  total: number;
}): ReactElement {
  return (
    <div className="panel">
      <div className="panel__header">
        <div>
          <div className="panel__kicker">Itens</div>
          <h2 className="panel__title">Últimas notas processadas</h2>
        </div>
        <div className="panel__header-right">
          <span className="count-badge count-badge--neutral">{total}</span>
        </div>
      </div>

      <div className="items-table">
        <div className="items-table__head">
          <span>OC</span>
          <span>Situação</span>
        </div>

        <AnimatePresence initial={false}>
          {items.length > 0 ? (
            items.map((item, i) => (
              <motion.div
                key={item.id}
                className="items-table__row"
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ delay: i * 0.03, duration: 0.22 }}
              >
                <span className="items-table__po">{item.poNumber}</span>
                <ItemStatusTag item={item} />
              </motion.div>
            ))
          ) : (
            <div className="empty-state">
              As notas aparecerão aqui conforme a leitura do ERP avançar.
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ItemStatusTag({ item }: { item: ManifestItem }): ReactElement {
  const summary = summarizeManifestItem(item);
  const hasFail   = item.downloadStatus === "download_failed" || item.uploadStatus === "upload_failed";
  const isDone    = item.uploadStatus === "uploaded";
  const isActive  = item.downloadStatus === "downloading" || item.uploadStatus === "uploading";
  const isQueued  = item.uploadStatus === "queued_for_upload";

  let tone = "default";
  if (hasFail)  tone = "red";
  else if (isDone)   tone = "green";
  else if (isActive) tone = "blue";
  else if (isQueued) tone = "amber";

  return <span className={`status-tag status-tag--${tone}`}>{summary}</span>;
}

/* ============================================================
   ERRORS PANEL
   ============================================================ */

function ErrorsPanel({ errors }: { errors: string[] }): ReactElement {
  const recent = errors.slice(-5).reverse();

  return (
    <div className="panel">
      <div className="panel__header">
        <div>
          <div className="panel__kicker">Falhas</div>
          <h2 className="panel__title">Pontos de atenção</h2>
        </div>
        {errors.length > 0 && (
          <div className="panel__header-right">
            <span className="count-badge count-badge--danger">{errors.length}</span>
          </div>
        )}
      </div>

      <div className="errors-section">
        <AnimatePresence initial={false}>
          {recent.length > 0 ? (
            <ul className="error-list">
              {recent.map((err, i) => (
                <motion.li
                  key={err + String(i)}
                  className="error-item"
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.22 }}
                >
                  <AlertTriangle size={13} className="error-item__icon" />
                  <span>{err}</span>
                </motion.li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">Nenhuma falha recente registrada.</div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ============================================================
   TIMELINE PANEL
   ============================================================ */

function TimelinePanel({ logs }: { logs: LogEntry[] }): ReactElement {
  return (
    <div className="panel">
      <div className="panel__header">
        <div>
          <div className="panel__kicker">Logs</div>
          <h2 className="panel__title">Linha do tempo operacional</h2>
        </div>
      </div>

      <div className="timeline">
        <div className="timeline__line" aria-hidden />

        <AnimatePresence initial={false}>
          {logs.length > 0 ? (
            logs.map((entry, i) => (
              <TimelineEntry key={`${entry.timestamp}-${entry.message}`} entry={entry} index={i} />
            ))
          ) : (
            <div className="empty-state">
              A linha do tempo será preenchida assim que a execução começar.
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function TimelineEntry({ entry, index }: { entry: LogEntry; index: number }): ReactElement {
  const level = entry.level.toLowerCase() as "info" | "warn" | "error";
  const details = formatLogDetails(entry.details);

  return (
    <motion.div
      className={`timeline-entry timeline-entry--${level}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ delay: index * 0.035, duration: 0.20 }}
    >
      <div className="timeline-entry__dot-col">
        <span className="timeline-entry__dot" />
      </div>
      <div className="timeline-entry__body">
        <div className="timeline-entry__meta">
          <span className="timeline-entry__time">{formatLogTimestamp(entry.timestamp)}</span>
          <span className={`level-badge level-badge--${level}`}>{translateLogLevel(entry.level)}</span>
          <span className="timeline-entry__stage">{translateStage(entry.stage)}</span>
        </div>
        <div className="timeline-entry__message">{entry.message}</div>
        {details && (
          <div className="timeline-entry__details">{details}</div>
        )}
      </div>
    </motion.div>
  );
}

/* ============================================================
   HELPERS
   ============================================================ */

function buildUpdateLabel(state: UpdateState): string {
  switch (state.status) {
    case "checking":
      return "Verificando...";
    case "available":
    case "downloading":
      return state.availableVersion
        ? `Baixando ${state.availableVersion}${state.downloadProgress != null ? ` (${state.downloadProgress}%)` : ""}`
        : "Baixando atualização";
    case "downloaded":
      return state.pendingInstallVersion
        ? `Pronto — ${state.pendingInstallVersion}`
        : "Pronto para instalar";
    case "installing":
      return "Instalando...";
    case "error":
      return "Falha ao verificar";
    case "unsupported":
      return "Dev mode";
    case "disabled":
      return "Desativado";
    default:
      return state.lastCheckedAt ? "Atualizado" : "Aguardando";
  }
}
