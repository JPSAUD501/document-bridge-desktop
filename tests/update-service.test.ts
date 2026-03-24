import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AppUpdater } from "electron-updater";
import { PendingUpdateStore } from "../src/main/services/update/pending-update-store";
import { UpdateService } from "../src/main/services/update/update-service";

class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowPrerelease = false;
  channel?: string;
  readonly checkForUpdates = vi.fn(async () => undefined);
  readonly quitAndInstall = vi.fn();
}

describe("UpdateService", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("returns unsupported in development mode", async () => {
    const store = new PendingUpdateStore(path.join(await fs.mkdtemp(path.join(os.tmpdir(), "erp-midas-dev-")), "pending.json"));
    const updater = new FakeUpdater();
    const service = new UpdateService(store, updater as unknown as AppUpdater, false, "1.0.0");

    await service.initialize();
    const state = await service.checkForUpdates();

    expect(state.status).toBe("unsupported");
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  test("downloads update and marks it for next startup", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "erp-midas-update-"));
    const store = new PendingUpdateStore(path.join(tempDir, "pending.json"));
    const updater = new FakeUpdater();
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit("checking-for-update");
      updater.emit("update-available", { version: "1.1.0" });
      updater.emit("download-progress", { percent: 64 });
      updater.emit("update-downloaded", { version: "1.1.0" });
    });

    const service = new UpdateService(store, updater as unknown as AppUpdater, true, "1.0.0");
    await service.initialize();
    await service.checkForUpdates();

    await vi.waitFor(() => {
      expect(service.getState().status).toBe("downloaded");
    });
    expect(service.getState().pendingInstallVersion).toBe("1.1.0");
    expect((await store.read())?.version).toBe("1.1.0");
  });

  test("keeps a downloaded update pending until the user asks to install", async () => {
    vi.useFakeTimers();
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "erp-midas-install-"));
    const store = new PendingUpdateStore(path.join(tempDir, "pending.json"));
    await store.write("1.1.0");
    const updater = new FakeUpdater();
    const service = new UpdateService(store, updater as unknown as AppUpdater, true, "1.0.0");

    await service.initialize();
    expect(service.getState().status).toBe("downloaded");
    expect(service.getState().pendingInstallVersion).toBe("1.1.0");
    expect(updater.quitAndInstall).not.toHaveBeenCalled();

    await expect(service.installDownloadedUpdate()).resolves.toBeUndefined();

    await vi.runAllTimersAsync();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });
});
