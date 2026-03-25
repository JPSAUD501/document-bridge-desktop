export type DownloadStatus =
  | "pending"
  | "downloading"
  | "downloaded"
  | "download_failed";

export type UploadStatus =
  | "pending"
  | "queued_for_upload"
  | "uploading"
  | "uploaded"
  | "upload_failed";

export type UiPhase =
  | "bootstrap"
  | "preflight"
  | "ready"
  | "downloading"
  | "uploading"
  | "summary"
  | "error";

export type LogLevel = "INFO" | "WARN" | "ERROR";

export interface ManifestItem {
  id: string;
  poNumber: string;
  sourceRow: number;
  originalFileName?: string;
  savedFileName?: string;
  downloadPath?: string;
  downloadStatus: DownloadStatus;
  uploadStatus: UploadStatus;
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ManifestData {
  runId: string;
  createdAt: string;
  updatedAt: string;
  items: ManifestItem[];
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  stage: string;
  message: string;
  details?: Record<string, string | number | boolean | null | undefined>;
}

export interface StatusCounts {
  total: number;
  pending: number;
  downloading: number;
  downloaded: number;
  downloadFailed: number;
  queuedForUpload: number;
  uploading: number;
  uploaded: number;
  uploadFailed: number;
}

export interface RuntimeSnapshot {
  phase: UiPhase;
  outputRootDir: string;
  runDir: string;
  downloadsDir: string;
  waitingForStart: boolean;
  canStart: boolean;
  canRetry: boolean;
  browserReady: boolean;
  currentItem?: string;
  currentBatch?: string;
  totalItems: number;
  counts: StatusCounts;
  recentLogs: LogEntry[];
  manifestItems: ManifestItem[];
  excelStatus: "idle" | "writing" | "error";
  errors: string[];
  runStatusMessage: string;
}

export interface CliOptions {
  resumePath?: string;
  outputRootPath?: string;
  help: boolean;
}

export interface RunPaths {
  workspaceRoot: string;
  runId: string;
  runDir: string;
  downloadsDir: string;
  authStatePath: string;
  manifestPath: string;
  logPath: string;
  excelPath: string;
}

export interface BootstrapResult {
  mode: "continue" | "handoff";
  notes: string[];
}
