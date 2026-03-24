import type { RuntimeSnapshot } from "../types";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error"
  | "disabled"
  | "unsupported";

export interface UpdateState {
  enabled: boolean;
  channel: "latest";
  status: UpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  pendingInstallVersion: string | null;
  downloadProgress: number | null;
  lastCheckedAt: string | null;
}

export interface DesktopApi {
  getSnapshot: () => Promise<RuntimeSnapshot>;
  subscribeSnapshot: (listener: (snapshot: RuntimeSnapshot) => void) => () => void;
  requestStart: () => Promise<void>;
  retryFailedItems: () => Promise<void>;
  shutdownRun: () => Promise<void>;
  openPath: (target: string) => Promise<void>;
  getUpdateState: () => Promise<UpdateState>;
  subscribeUpdateState: (listener: (state: UpdateState) => void) => () => void;
  installUpdate: () => Promise<void>;
}

export const ipcChannels = {
  runtime: {
    getSnapshot: "runtime:getSnapshot",
    snapshotChanged: "runtime:snapshotChanged",
    requestStart: "runtime:requestStart",
    retryFailedItems: "runtime:retryFailedItems",
    shutdownRun: "runtime:shutdownRun",
    openPath: "runtime:openPath",
  },
  updates: {
    getState: "updates:getState",
    stateChanged: "updates:stateChanged",
    installNow: "updates:installNow",
  },
} as const;
