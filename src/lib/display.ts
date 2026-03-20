import type {
  DownloadStatus,
  LogEntry,
  LogLevel,
  ManifestItem,
  RuntimeSnapshot,
  UiPhase,
  UploadStatus,
} from "../types";

const phaseLabels: Record<UiPhase, string> = {
  bootstrap: "Inicializacao",
  preflight: "Preparacao",
  ready: "Pronto para iniciar",
  downloading: "Baixando PDFs",
  uploading: "Enviando para Midas",
  summary: "Concluido",
  error: "Erro",
};

const excelStatusLabels: Record<RuntimeSnapshot["excelStatus"], string> = {
  idle: "Em dia",
  writing: "Atualizando",
  error: "Com erro",
};

const downloadStatusLabels: Record<DownloadStatus, string> = {
  pending: "Pendente",
  downloading: "Baixando",
  downloaded: "PDF baixado",
  download_failed: "Falha no download",
};

const uploadStatusLabels: Record<UploadStatus, string> = {
  pending: "Pendente",
  queued_for_upload: "Na fila de envio",
  uploading: "Enviando",
  uploaded: "Enviado",
  upload_failed: "Falha no envio",
};

const logLevelLabels: Record<LogLevel, string> = {
  INFO: "INFO",
  WARN: "AVISO",
  ERROR: "ERRO",
};

const stageLabels: Record<string, string> = {
  bootstrap: "inicializacao",
  system: "sistema",
  browser: "navegador",
  excel: "excel",
  erp: "erp",
  midas: "midas",
};

export function translatePhase(phase: UiPhase): string {
  return phaseLabels[phase];
}

export function translateExcelStatus(status: RuntimeSnapshot["excelStatus"]): string {
  return excelStatusLabels[status];
}

export function translateDownloadStatus(status: DownloadStatus): string {
  return downloadStatusLabels[status];
}

export function translateUploadStatus(status: UploadStatus): string {
  return uploadStatusLabels[status];
}

export function translateLogLevel(level: LogLevel): string {
  return logLevelLabels[level];
}

export function translateStage(stage: string): string {
  return stageLabels[stage] ?? stage;
}

export function formatLogTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleTimeString("pt-BR", { hour12: false });
}

export function formatLogDetails(details?: LogEntry["details"]): string {
  if (!details) {
    return "";
  }

  const entries = Object.entries(details).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (entries.length === 0) {
    return "";
  }

  return entries.map(([key, value]) => `${translateDetailKey(key)}=${String(value)}`).join(" | ");
}

export function summarizeManifestItem(item: ManifestItem): string {
  return `${translateDownloadStatus(item.downloadStatus)} | ${translateUploadStatus(item.uploadStatus)}`;
}

function translateDetailKey(key: string): string {
  switch (key) {
    case "poNumber":
      return "oc";
    case "downloadPath":
      return "arquivo";
    case "pending":
      return "pendentes";
    case "batches":
      return "lotes";
    case "batch":
      return "lote";
    case "count":
      return "quantidade";
    case "error":
      return "erro";
    case "total":
      return "total";
    default:
      return key;
  }
}
