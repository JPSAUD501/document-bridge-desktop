import { EventEmitter } from "node:events";
import semver from "semver";
import { app } from "electron";
import electronUpdater, { type AppUpdater, type UpdateInfo } from "electron-updater";
import type { UpdateState } from "../../../shared/contracts";
import { defaultUpdateState } from "../../../shared/defaults";
import { PendingUpdateStore } from "./pending-update-store";

type StateListener = (state: UpdateState) => void;

const getDefaultUpdater = (): AppUpdater => electronUpdater.autoUpdater;

export class UpdateService extends EventEmitter {
  #state: UpdateState;
  #initialized = false;
  readonly #listeners = new Set<StateListener>();

  constructor(
    private readonly pendingStore: PendingUpdateStore,
    private readonly updater: AppUpdater = getDefaultUpdater(),
    private readonly isPackaged: boolean = app.isPackaged,
    private readonly appVersion: string = app.getVersion(),
  ) {
    super();
    this.#state = {
      ...defaultUpdateState,
      currentVersion: appVersion,
    };
  }

  async initialize(): Promise<void> {
    if (this.#initialized) {
      return;
    }

    this.#initialized = true;
    this.bindUpdaterEvents();

    const pending = await this.pendingStore.read();
    if (pending && isVersionFulfilled(pending.version, this.appVersion)) {
      await this.pendingStore.clear();
    }

    const refreshedPending = await this.pendingStore.read();
    this.setState({
      enabled: true,
      channel: "latest",
      status: this.isPackaged ? "idle" : "unsupported",
      pendingInstallVersion: refreshedPending?.version ?? null,
      currentVersion: this.appVersion,
    });

    this.updater.autoDownload = true;
    this.updater.autoInstallOnAppQuit = false;
    (this.updater as AppUpdater & { channel?: string }).channel = "latest";
    this.updater.allowPrerelease = false;
  }

  getState(): UpdateState {
    return this.#state;
  }

  subscribe(listener: StateListener): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  async checkForUpdates(): Promise<UpdateState> {
    if (!this.#initialized) {
      await this.initialize();
    }

    if (!this.isPackaged) {
      this.setState({ status: "unsupported" });
      return this.#state;
    }

    if (this.#state.status === "checking" || this.#state.status === "downloading") {
      return this.#state;
    }

    try {
      await this.updater.checkForUpdates();
    } catch {
      this.setState({
        status: "error",
        lastCheckedAt: new Date().toISOString(),
      });
    }

    return this.#state;
  }

  async installPendingUpdateIfPresent(): Promise<boolean> {
    if (!this.isPackaged) {
      return false;
    }

    if (!this.#initialized) {
      await this.initialize();
    }

    const pending = await this.pendingStore.read();
    if (!pending || isVersionFulfilled(pending.version, this.appVersion)) {
      if (pending) {
        await this.pendingStore.clear();
      }
      return false;
    }

    this.setState({
      status: "installing",
      pendingInstallVersion: pending.version,
    });

    setTimeout(() => {
      this.updater.quitAndInstall(true, true);
    }, 120);

    return true;
  }

  private bindUpdaterEvents(): void {
    this.updater.on("checking-for-update", () => {
      this.setState({
        status: "checking",
        lastCheckedAt: new Date().toISOString(),
      });
    });

    this.updater.on("update-available", (info: UpdateInfo) => {
      this.setState({
        status: "available",
        availableVersion: info.version,
        lastCheckedAt: new Date().toISOString(),
      });
    });

    this.updater.on("update-not-available", () => {
      this.setState({
        status: "idle",
        availableVersion: null,
        lastCheckedAt: new Date().toISOString(),
      });
    });

    this.updater.on("download-progress", (progress) => {
      this.setState({
        status: "downloading",
        downloadProgress: progress.percent != null ? Math.round(progress.percent) : null,
      });
    });

    this.updater.on("update-downloaded", async (info: UpdateInfo) => {
      await this.pendingStore.write(info.version);
      this.setState({
        status: "downloaded",
        availableVersion: info.version,
        pendingInstallVersion: info.version,
        downloadProgress: null,
        lastCheckedAt: new Date().toISOString(),
      });
    });

    this.updater.on("error", () => {
      this.setState({
        status: "error",
        downloadProgress: null,
        lastCheckedAt: new Date().toISOString(),
      });
    });
  }

  private setState(patch: Partial<UpdateState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}

function isVersionFulfilled(targetVersion: string, currentVersion: string): boolean {
  const target = semver.valid(targetVersion) ?? semver.coerce(targetVersion)?.version;
  const current = semver.valid(currentVersion) ?? semver.coerce(currentVersion)?.version;
  return Boolean(target && current && semver.gte(current, target));
}
