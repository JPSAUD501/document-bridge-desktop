import { beforeEach, describe, expect, test, vi } from "vitest";

const exposeInMainWorld = vi.fn();
const invoke = vi.fn();
const on = vi.fn();
const removeListener = vi.fn();

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke, on, removeListener },
}));

describe("preload bridge", () => {
  beforeEach(() => {
    vi.resetModules();
    exposeInMainWorld.mockReset();
    invoke.mockReset();
    on.mockReset();
    removeListener.mockReset();
  });

  test("exposes the desktop API and unsubscribes listeners", async () => {
    await import("../src/preload/preload");

    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    const [, api] = exposeInMainWorld.mock.calls[0]!;
    expect(typeof api.getSnapshot).toBe("function");
    expect(typeof api.subscribeSnapshot).toBe("function");
    expect(typeof api.getUpdateState).toBe("function");

    const unsubscribe = api.subscribeSnapshot(() => undefined);
    expect(on).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});
