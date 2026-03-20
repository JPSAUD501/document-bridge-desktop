import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi } from "../shared/contracts";
import { ipcChannels } from "../shared/contracts";

const desktopApi: DesktopApi = {
  getSnapshot: async () => ipcRenderer.invoke(ipcChannels.runtime.getSnapshot),
  subscribeSnapshot: (listener) => {
    const handler = (_event: unknown, snapshot: Awaited<ReturnType<DesktopApi["getSnapshot"]>>) => {
      listener(snapshot);
    };
    ipcRenderer.on(ipcChannels.runtime.snapshotChanged, handler);
    return () => {
      ipcRenderer.removeListener(ipcChannels.runtime.snapshotChanged, handler);
    };
  },
  requestStart: async () => {
    await ipcRenderer.invoke(ipcChannels.runtime.requestStart);
  },
  retryFailedItems: async () => {
    await ipcRenderer.invoke(ipcChannels.runtime.retryFailedItems);
  },
  shutdownRun: async () => {
    await ipcRenderer.invoke(ipcChannels.runtime.shutdownRun);
  },
  openPath: async (target) => {
    await ipcRenderer.invoke(ipcChannels.runtime.openPath, target);
  },
  getUpdateState: async () => ipcRenderer.invoke(ipcChannels.updates.getState),
  subscribeUpdateState: (listener) => {
    const handler = (_event: unknown, state: Awaited<ReturnType<DesktopApi["getUpdateState"]>>) => {
      listener(state);
    };
    ipcRenderer.on(ipcChannels.updates.stateChanged, handler);
    return () => {
      ipcRenderer.removeListener(ipcChannels.updates.stateChanged, handler);
    };
  },
};

contextBridge.exposeInMainWorld("erpMidas", desktopApi);
