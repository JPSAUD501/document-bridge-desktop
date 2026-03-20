import type { UpdateState } from "./contracts";

export const defaultUpdateState: UpdateState = {
  enabled: true,
  channel: "latest",
  status: "idle",
  currentVersion: "0.0.0-dev",
  availableVersion: null,
  pendingInstallVersion: null,
  downloadProgress: null,
  lastCheckedAt: null,
};
