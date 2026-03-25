import "dotenv/config";
import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { registerIpc } from "./bootstrap/register-ipc";
import { DesktopRuntimeService } from "./services/runtime/desktop-runtime-service";
import { PendingUpdateStore } from "./services/update/pending-update-store";
import { UpdateService } from "./services/update/update-service";

const rendererHtmlPath = path.join(__dirname, "..", "..", "dist", "index.html");
const preloadPath = path.join(__dirname, "..", "preload", "index.cjs");

let mainWindow: BrowserWindow | null = null;
let disposeIpc: (() => void) | undefined;

async function bootstrap(): Promise<void> {
  await app.whenReady();

  const pendingStore = new PendingUpdateStore(path.join(app.getPath("userData"), "pending-update.json"));
  const updateService = new UpdateService(pendingStore);
  await updateService.initialize();

  if (updateService.getState().pendingInstallVersion) {
    await updateService.installDownloadedUpdate();
    return;
  }

  const runtime = new DesktopRuntimeService();
  mainWindow = createMainWindow();
  disposeIpc = registerIpc({
    ipcMain,
    window: mainWindow,
    runtime,
    updates: updateService,
  });

  runtime.start();
  void updateService.checkForUpdates();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });

  app.on("before-quit", () => {
    void runtime.shutdown();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1180,
    minHeight: 780,
    backgroundColor: "#efe7da",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(rendererHtmlPath);
  }

  return window;
}

void bootstrap().catch((error) => {
  console.error(error);
  app.exit(1);
});

app.on("quit", () => {
  disposeIpc?.();
});
