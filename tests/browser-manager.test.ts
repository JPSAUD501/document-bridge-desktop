import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  findInstalledBrowserByChannel,
  resolveCorporateBrowserChannel,
  resolveCorporateBrowserExecutable,
} from "../src/runtime/browser-manager";

const originalEnv = { ...process.env };
const tempDirs: string[] = [];

beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.ERP_MIDAS_BROWSER_PATH;
  delete process.env.ERP_MIDAS_BROWSER_CHANNEL;
  process.env.PROGRAMFILES = "";
  process.env["PROGRAMFILES(X86)"] = "";
  process.env.LOCALAPPDATA = "";
});

afterEach(async () => {
  process.env = { ...originalEnv };
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
});

async function createFakeExecutable(...segments: string[]): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "browser-resolver-"));
  tempDirs.push(root);
  const executablePath = path.join(root, ...segments);
  await fs.mkdir(path.dirname(executablePath), { recursive: true });
  await fs.writeFile(executablePath, "");
  return executablePath;
}

describe("corporate browser resolver", () => {
  test("uses ERP_MIDAS_BROWSER_PATH when it points to an executable", async () => {
    const executablePath = await createFakeExecutable("Custom", "browser.exe");
    process.env.ERP_MIDAS_BROWSER_PATH = executablePath;

    await expect(resolveCorporateBrowserExecutable()).resolves.toMatchObject({
      path: executablePath,
      source: "env-path",
    });
  });

  test("defaults to Microsoft Edge", () => {
    expect(resolveCorporateBrowserChannel()).toBe("msedge");
  });

  test("finds Microsoft Edge from the default channel", async () => {
    const executablePath = await createFakeExecutable("Microsoft", "Edge", "Application", "msedge.exe");
    process.env.PROGRAMFILES = path.dirname(path.dirname(path.dirname(path.dirname(executablePath))));

    await expect(resolveCorporateBrowserExecutable()).resolves.toMatchObject({
      path: executablePath,
      source: "channel",
    });
  });

  test("finds Google Chrome when ERP_MIDAS_BROWSER_CHANNEL is chrome", async () => {
    const executablePath = await createFakeExecutable("Google", "Chrome", "Application", "chrome.exe");
    process.env.PROGRAMFILES = path.dirname(path.dirname(path.dirname(path.dirname(executablePath))));
    process.env.ERP_MIDAS_BROWSER_CHANNEL = "chrome";

    await expect(findInstalledBrowserByChannel("chrome")).resolves.toBe(executablePath);
    await expect(resolveCorporateBrowserExecutable()).resolves.toMatchObject({
      path: executablePath,
      source: "channel",
    });
  });

  test("falls back to Playwright when the configured corporate browser is not installed", async () => {
    process.env.ERP_MIDAS_BROWSER_CHANNEL = "chrome";

    await expect(resolveCorporateBrowserExecutable()).resolves.toMatchObject({
      source: "playwright",
    });
  });
});
