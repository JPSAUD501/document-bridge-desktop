import type { DesktopApi } from "../shared/contracts";

declare global {
  interface Window {
    erpMidas: DesktopApi;
  }
}

export {};
