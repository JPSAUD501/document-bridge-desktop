import type { BrowserWindow, IpcMain } from "electron";
import { ipcChannels } from "../../shared/contracts";
import { DesktopRuntimeService } from "../services/runtime/desktop-runtime-service";
import { UpdateService } from "../services/update/update-service";

interface RegisterIpcOptions {
  ipcMain: IpcMain;
  window: BrowserWindow;
  runtime: DesktopRuntimeService;
  updates: UpdateService;
}

export function registerIpc({
  ipcMain,
  window,
  runtime,
  updates,
}: RegisterIpcOptions): () => void {
  const disposers: Array<() => void> = [];

  ipcMain.handle(ipcChannels.runtime.getSnapshot, async () => runtime.getSnapshot());
  ipcMain.handle(ipcChannels.runtime.inspectErp, async () => runtime.inspectErp());
  ipcMain.handle(ipcChannels.runtime.requestStart, async () => runtime.requestStart());
  ipcMain.handle(ipcChannels.runtime.retryFailedItems, async () => runtime.retryFailedItems());
  ipcMain.handle(ipcChannels.runtime.shutdownRun, async () => runtime.shutdown());
  ipcMain.handle(ipcChannels.runtime.openPath, async (_event, target: string) => runtime.openPath(target));
  ipcMain.handle(ipcChannels.updates.getState, async () => updates.getState());
  ipcMain.handle(ipcChannels.updates.installNow, async () => updates.installDownloadedUpdate());

  const unsubscribeRuntime = runtime.subscribe((snapshot) => {
    window.webContents.send(ipcChannels.runtime.snapshotChanged, snapshot);
  });
  const unsubscribeUpdates = updates.subscribe((state) => {
    window.webContents.send(ipcChannels.updates.stateChanged, state);
  });

  disposers.push(unsubscribeRuntime, unsubscribeUpdates);

  return () => {
    for (const dispose of disposers) {
      dispose();
    }

    ipcMain.removeHandler(ipcChannels.runtime.getSnapshot);
    ipcMain.removeHandler(ipcChannels.runtime.inspectErp);
    ipcMain.removeHandler(ipcChannels.runtime.requestStart);
    ipcMain.removeHandler(ipcChannels.runtime.retryFailedItems);
    ipcMain.removeHandler(ipcChannels.runtime.shutdownRun);
    ipcMain.removeHandler(ipcChannels.runtime.openPath);
    ipcMain.removeHandler(ipcChannels.updates.getState);
    ipcMain.removeHandler(ipcChannels.updates.installNow);
  };
}
