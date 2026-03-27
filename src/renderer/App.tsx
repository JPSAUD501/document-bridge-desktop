import { useEffect, useMemo, useState, useRef, type ReactElement } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from "motion/react";
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
  ChevronRight,
  ChevronLeft,
  X,
  Zap,
  BarChart3,
  ListFilter,
  Rocket,
  HelpCircle,
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
  visibleOcCountIsPreview: true,
  isDiscoveryComplete: false,
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
   PEGASUS LOGO — animated inline SVG
   ============================================================ */

function PegasusLogo(): ReactElement {
  return (
    <motion.div
      className="header__brand-logo"
      animate={{
        y: [0, -3, 0, -1.5, 0],
        filter: [
          "drop-shadow(0 0 5px rgba(212, 160, 32, 0.35))",
          "drop-shadow(0 0 14px rgba(212, 160, 32, 0.70))",
          "drop-shadow(0 0 5px rgba(212, 160, 32, 0.35))",
        ],
      }}
      transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
    >
      <svg
        width="42"
        height="42"
        viewBox="0 0 200 200"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Pegasus logo"
      >
        <defs>
          <radialGradient id="bgG" cx="35%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#1a2845" />
            <stop offset="100%" stopColor="#090d1a" />
          </radialGradient>
          <linearGradient id="goldG" x1="20%" y1="100%" x2="80%" y2="0%">
            <stop offset="0%" stopColor="#b8720a" />
            <stop offset="45%" stopColor="#d4a020" />
            <stop offset="100%" stopColor="#f0cc50" />
          </linearGradient>
          <linearGradient id="goldL" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#d4a020" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#f5d860" stopOpacity="0.7" />
          </linearGradient>
          <filter id="gw" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="1.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <clipPath id="cc">
            <circle cx="100" cy="100" r="88" />
          </clipPath>
        </defs>

        <circle cx="100" cy="100" r="97" fill="url(#bgG)" />
        <circle cx="100" cy="100" r="97" fill="none" stroke="url(#goldG)" strokeWidth="1.5" opacity="0.4" />
        <circle cx="100" cy="100" r="88" fill="none" stroke="url(#goldG)" strokeWidth="0.5" opacity="0.18" />

        <g clipPath="url(#cc)" filter="url(#gw)">
          {/* Main wing */}
          <path
            d="M 88,115 C 76,98 58,74 50,50 C 44,31 54,18 68,20 C 84,23 108,44 118,60 C 123,70 120,86 112,96 Z"
            fill="url(#goldG)"
          />
          {/* Wing depth */}
          <path
            d="M 88,115 C 72,94 52,66 52,44 C 52,27 66,15 82,19 C 98,23 120,44 126,62 L 112,70 C 104,55 88,42 74,43 C 64,44 58,54 62,66 C 66,80 80,98 90,108 Z"
            fill="url(#goldL)"
            opacity="0.5"
          />
          {/* Feather tips */}
          <path d="M 50,50 C 46,38 48,26 56,22 C 50,30 50,40 55,48 Z" fill="url(#goldG)" opacity="0.5" />
          <path d="M 62,35 C 60,25 64,18 72,18 C 67,24 64,30 65,36 Z" fill="url(#goldG)" opacity="0.4" />
          <path d="M 78,27 C 78,19 84,16 90,18 C 86,22 82,26 82,31 Z" fill="url(#goldG)" opacity="0.35" />
          {/* Body */}
          <ellipse cx="116" cy="124" rx="29" ry="18" transform="rotate(-12, 116, 124)" fill="url(#goldG)" />
          {/* Neck */}
          <path
            d="M 128,108 C 132,93 138,78 144,68 C 147,62 144,55 139,58 C 133,62 127,79 125,94 Z"
            fill="url(#goldG)"
          />
          {/* Head */}
          <ellipse cx="144" cy="65" rx="13" ry="9" transform="rotate(-28, 144, 65)" fill="url(#goldG)" />
          {/* Muzzle */}
          <path d="M 150,60 C 157,56 163,59 162,66 C 161,73 155,75 150,73 Z" fill="url(#goldG)" opacity="0.9" />
          {/* Ear */}
          <path d="M 138,56 C 138,48 143,44 147,48 C 145,53 141,57 138,56 Z" fill="url(#goldG)" />
          {/* Eye */}
          <circle cx="148" cy="63" r="2.5" fill="#090d1a" opacity="0.9" />
          <circle cx="148" cy="63" r="1.1" fill="#f0cc50" opacity="0.5" />
          {/* Mane */}
          <path d="M 128,108 C 122,100 114,96 108,100 C 100,104 98,115 103,122 Z" fill="url(#goldL)" opacity="0.65" />
          {/* Tail */}
          <path
            d="M 87,122 C 74,128 60,134 52,127 C 46,121 50,112 58,112 C 66,112 78,118 87,120 Z"
            fill="url(#goldG)"
            opacity="0.72"
          />
          {/* Legs */}
          <path d="M 106,138 C 102,148 98,157 96,162 C 95,166 98,167 101,163 C 105,157 109,148 111,140 Z" fill="url(#goldG)" opacity="0.78" />
          <path d="M 114,136 C 112,146 110,154 110,159 C 110,163 113,163 115,159 C 116,154 117,145 118,137 Z" fill="url(#goldG)" opacity="0.62" />
          <path d="M 130,138 C 134,148 136,157 134,162 C 133,165 131,165 130,162 C 128,157 125,148 125,140 Z" fill="url(#goldG)" opacity="0.75" />
          {/* Speed lines */}
          <line x1="157" y1="116" x2="177" y2="112" stroke="url(#goldG)" strokeWidth="1.5" opacity="0.4" strokeLinecap="round" />
          <line x1="159" y1="124" x2="181" y2="122" stroke="url(#goldG)" strokeWidth="1" opacity="0.3" strokeLinecap="round" />
          <line x1="155" y1="108" x2="172" y2="101" stroke="url(#goldG)" strokeWidth="1" opacity="0.28" strokeLinecap="round" />
          {/* Stars */}
          <circle cx="38" cy="76" r="1.2" fill="#f0cc50" opacity="0.5" />
          <circle cx="44" cy="60" r="0.8" fill="#f0cc50" opacity="0.4" />
          <circle cx="32" cy="64" r="0.7" fill="#f0cc50" opacity="0.35" />
          <circle cx="170" cy="80" r="0.9" fill="#f0cc50" opacity="0.35" />
          <circle cx="175" cy="68" r="0.6" fill="#f0cc50" opacity="0.28" />
        </g>
      </svg>
    </motion.div>
  );
}

/* ============================================================
   APP ROOT
   ============================================================ */

export function App(): ReactElement {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(emptySnapshot);
  const [updateState, setUpdateState] = useState<UpdateState>(defaultUpdateState);
  const [busyAction, setBusyAction] = useState<"start" | "retry" | "folder" | "update" | null>(null);
  const inspectInFlightRef = useRef(false);

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

  useEffect(() => {
    if (!snapshot.browserReady || !snapshot.waitingForStart || snapshot.phase !== "ready") {
      return;
    }

    let cancelled = false;

    const refreshPreview = async () => {
      if (inspectInFlightRef.current || cancelled) {
        return;
      }

      inspectInFlightRef.current = true;
      try {
        await window.erpMidas.inspectErp();
      } finally {
        inspectInFlightRef.current = false;
      }
    };

    void refreshPreview();
    const intervalId = window.setInterval(() => {
      void refreshPreview();
    }, 5_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [snapshot.browserReady, snapshot.waitingForStart, snapshot.phase]);

  return (
    <div className="app-shell">
      <AppHeader
        snapshot={snapshot}
        updateState={updateState}
        updateBusy={busyAction === "update"}
        onInstallUpdate={() => void installUpdate()}
      />
      <motion.main
        className="app-content"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.35, ease: "easeOut" }}
        >
          <ActionBar
            snapshot={snapshot}
            busyAction={busyAction}
            onStart={() => void startRun()}
            onRetry={() => void retryRun()}
            onFolder={() => void openRunFolder()}
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.35, ease: "easeOut" }}
        >
          <MetricsSection snapshot={snapshot} />
        </motion.div>

        <motion.div
          className="content-grid"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.20, duration: 0.38, ease: "easeOut" }}
        >
          <OperationPanel snapshot={snapshot} />
          <div className="content-grid__right">
            <ItemsPanel items={recentItems} total={snapshot.totalItems} />
            <ErrorsPanel errors={snapshot.errors} />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28, duration: 0.40, ease: "easeOut" }}
        >
          <TimelinePanel logs={recentLogs} />
        </motion.div>
      </motion.main>
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
    <motion.header
      className="header"
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="header__brand">
        <PegasusLogo />
        <div>
          <div className="header__eyebrow">ERP → MIDAS · Automação de Documentos</div>
          <h1 className="header__title">Pegasus</h1>
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
          <motion.button
            className="btn btn--primary"
            onClick={onInstallUpdate}
            disabled={updateBusy}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            {updateBusy ? (
              <Loader2 size={15} className="btn__icon btn__icon--spin" />
            ) : (
              <Download size={15} className="btn__icon" />
            )}
            {updateBusy ? "Atualizando..." : "Atualizar"}
          </motion.button>
        )}
      </div>
    </motion.header>
  );
}

function PhaseBadge({ phase }: { phase: UiPhase }): ReactElement {
  const isActive = phase === "discovering" || phase === "downloading" || phase === "uploading";

  return (
    <div className={`phase-badge phase-badge--${phase}`}>
      {isActive ? (
        <motion.span
          className="phase-badge__dot"
          animate={{ opacity: [1, 0.25, 1], scale: [1, 0.8, 1] }}
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
        <motion.button
          className="btn btn--primary"
          onClick={onStart}
          disabled={!snapshot.canStart || busyAction !== null}
          whileHover={snapshot.canStart && busyAction === null ? { scale: 1.02 } : {}}
          whileTap={snapshot.canStart && busyAction === null ? { scale: 0.97 } : {}}
        >
          {busyAction === "start" ? (
            <Loader2 size={15} className="btn__icon btn__icon--spin" />
          ) : (
            <Play size={15} className="btn__icon" />
          )}
          {busyAction === "start" ? "Iniciando..." : "Iniciar automação"}
        </motion.button>

        <motion.button
          className="btn btn--secondary"
          onClick={onRetry}
          disabled={!snapshot.canRetry || busyAction !== null}
          whileHover={snapshot.canRetry && busyAction === null ? { scale: 1.02 } : {}}
          whileTap={snapshot.canRetry && busyAction === null ? { scale: 0.97 } : {}}
        >
          {busyAction === "retry" ? (
            <Loader2 size={15} className="btn__icon btn__icon--spin" />
          ) : (
            <RefreshCw size={15} className="btn__icon" />
          )}
          {busyAction === "retry" ? "Reprocessando..." : "Retry dos pendentes"}
        </motion.button>

        <motion.button
          className="btn btn--ghost"
          onClick={onFolder}
          disabled={!snapshot.runDir || busyAction !== null}
          whileHover={snapshot.runDir && busyAction === null ? { scale: 1.01 } : {}}
          whileTap={snapshot.runDir && busyAction === null ? { scale: 0.98 } : {}}
        >
          {busyAction === "folder" ? (
            <Loader2 size={15} className="btn__icon btn__icon--spin" />
          ) : (
            <FolderOpen size={15} className="btn__icon" />
          )}
          {busyAction === "folder" ? "Abrindo..." : "Abrir pasta da execução"}
        </motion.button>
      </div>

      <div className="action-bar__message">
        <AnimatePresence mode="wait">
          <motion.span
            key={snapshot.runStatusMessage}
            className="action-bar__message-text"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22 }}
          >
            {snapshot.runStatusMessage}
          </motion.span>
        </AnimatePresence>
        <span className="excel-tag">{translateExcelStatus(snapshot.excelStatus)}</span>
      </div>
    </section>
  );
}

/* ============================================================
   ANIMATED NUMBER (counter animation for metric values)
   ============================================================ */

function AnimatedValue({ value, className }: { value: number; className?: string }): ReactElement {
  const mv = useMotionValue(0);
  const display = useTransform(mv, (v) => String(Math.round(v)));

  useEffect(() => {
    const controls = animate(mv, value, {
      duration: value === 0 ? 0.2 : 0.55,
      ease: [0.16, 1, 0.3, 1],
    });
    return () => controls.stop();
  }, [value, mv]);

  return <motion.strong className={className}>{display}</motion.strong>;
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
      label: "Total encontrado",
      value: snapshot.discoveredOcCount ?? 0,
      tone: snapshot.isDiscoveryComplete ? "green" : "blue",
      icon: <ArrowRightCircle size={16} />,
      subtitle:
        snapshot.discoveredOcCount != null
          ? snapshot.isDiscoveryComplete
            ? "Varredura concluida"
            : "Varredura em andamento"
          : "Aguardando varredura",
    },
    { label: "Total",        value: counts.total,                             tone: "dark",  icon: <FileText size={16} /> },
    { label: "Pendentes",    value: counts.pending,                           tone: "amber", icon: <Clock size={16} />,          pulse: counts.pending > 0 },
    { label: "Baixando",     value: counts.downloading,                       tone: "blue",  icon: <Download size={16} />,        pulse: counts.downloading > 0 },
    { label: "Baixados",     value: counts.downloaded,                        tone: "green", icon: <CheckCircle2 size={16} />,    subtitle: total > 0 ? `${dlPct}%` : undefined },
    { label: "Fila de envio",value: counts.queuedForUpload,                   tone: "amber", icon: <ArrowRightCircle size={16} />,pulse: counts.queuedForUpload > 0 },
    { label: "Enviando",     value: counts.uploading,                         tone: "blue",  icon: <Upload size={16} />,          pulse: counts.uploading > 0 },
    { label: "Enviados",     value: counts.uploaded,                          tone: "green", icon: <CheckCircle2 size={16} />,    subtitle: total > 0 ? `${ulPct}%` : undefined },
    { label: "Falhas",       value: counts.downloadFailed + counts.uploadFailed, tone: "red", icon: <XCircle size={16} /> },
  ];

  return (
    <section className="metrics-section">
      <div className="metrics-grid">
        {metrics.map((m, i) => (
          <MetricCard key={m.label} metric={m} index={i} />
        ))}
      </div>

      {total > 0 && (
        <motion.div
          className="progress-section"
          initial={{ opacity: 0, scaleX: 0.97 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          style={{ transformOrigin: "left" }}
        >
          <ProgressBar label="Downloads" current={counts.downloaded} total={total} pct={dlPct} tone="green" />
          <ProgressBar label="Uploads"   current={counts.uploaded}   total={total} pct={ulPct} tone="blue" />
        </motion.div>
      )}
    </section>
  );
}

function MetricCard({ metric, index }: { metric: MetricDef; index: number }): ReactElement {
  return (
    <motion.div
      className={`metric-card metric-card--${metric.tone}${metric.pulse && metric.value > 0 ? " metric-card--active-pulse" : ""}`}
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.045, duration: 0.30, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -2 }}
    >
      <div className="metric-card__top">
        <span className="metric-card__label">{metric.label}</span>
        <span className="metric-card__icon">{metric.icon}</span>
      </div>
      <div className="metric-card__bottom">
        <AnimatedValue value={metric.value} className="metric-card__value" />
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
          transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
    </div>
  );
}

/* ============================================================
   OPERATION PANEL
   ============================================================ */

function OperationPanel({ snapshot }: { snapshot: RuntimeSnapshot }): ReactElement {
  const discoveredLabel =
    snapshot.discoveredOcCount != null
      ? snapshot.isDiscoveryComplete
        ? `${snapshot.discoveredOcCount} (varredura concluida)`
        : `${snapshot.discoveredOcCount} (varredura em andamento)`
      : "Aguardando inicio da varredura completa.";

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
        <DetailRow label="Pasta de execução"    value={snapshot.runDir        || "Será criada ao iniciar o fluxo."} />
        <DetailRow label="Pasta dos PDFs"       value={snapshot.downloadsDir  || "Aguardando inicialização."} />
        <DetailRow label="Pasta raiz das runs"  value={snapshot.outputRootDir || "Será escolhida ao iniciar o fluxo."} />
        <DetailRow label="Nota atual"           value={snapshot.currentItem   || "Nenhuma nota ativa no momento."} />
        <DetailRow label="Lote atual"           value={snapshot.currentBatch  || "Nenhum lote em processamento."} />
      </dl>

      <div className="steps-guide">
        <div className="steps-guide__title">Resumo do ERP</div>
        <ol className="steps-guide__list">
          <li>OCs encontradas na varredura: {discoveredLabel}</li>
        </ol>
      </div>

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

function ItemsPanel({ items, total }: { items: ManifestItem[]; total: number }): ReactElement {
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
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ delay: i * 0.03, duration: 0.22, ease: "easeOut" }}
              >
                <span className="items-table__po">{item.poNumber}</span>
                <ItemStatusTag item={item} />
              </motion.div>
            ))
          ) : (
            <motion.div
              className="empty-state"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              As notas aparecerão aqui conforme a leitura do ERP avançar.
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ItemStatusTag({ item }: { item: ManifestItem }): ReactElement {
  const summary = summarizeManifestItem(item);
  const hasFail  = item.downloadStatus === "download_failed" || item.uploadStatus === "upload_failed";
  const isDone   = item.uploadStatus === "uploaded";
  const isActive = item.downloadStatus === "downloading" || item.uploadStatus === "uploading";
  const isQueued = item.uploadStatus === "queued_for_upload";

  let tone = "default";
  if (hasFail)   tone = "red";
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
            <motion.span
              className="count-badge count-badge--danger"
              key={errors.length}
              initial={{ scale: 1.35, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              {errors.length}
            </motion.span>
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
                  initial={{ opacity: 0, x: -8, height: 0 }}
                  animate={{ opacity: 1, x: 0, height: "auto" }}
                  exit={{ opacity: 0, x: 8, height: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.25 }}
                >
                  <AlertTriangle size={13} className="error-item__icon" />
                  <span>{err}</span>
                </motion.li>
              ))}
            </ul>
          ) : (
            <motion.div
              className="empty-state"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              Nenhuma falha recente registrada.
            </motion.div>
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
            <motion.div
              className="empty-state"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              A linha do tempo será preenchida assim que a execução começar.
            </motion.div>
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
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      transition={{ delay: index * 0.030, duration: 0.22, ease: "easeOut" }}
    >
      <div className="timeline-entry__dot-col">
        <motion.span
          className="timeline-entry__dot"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: index * 0.030 + 0.08, duration: 0.18, ease: "backOut" }}
        />
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
