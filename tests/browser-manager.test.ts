import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  findInstalledBrowserByChannel,
  resolveCorporateBrowserChannel,
  resolveCorporateBrowserExecutable,
} from "../src/runtime/browser-manager";

const tempDirs: string[] = [];

afterEach(async () => {
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

function buildEnv(values: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...values,
    PROGRAMFILES: values.PROGRAMFILES ?? "",
    "PROGRAMFILES(X86)": values["PROGRAMFILES(X86)"] ?? "",
    LOCALAPPDATA: values.LOCALAPPDATA ?? "",
  };
}

describe("corporate browser resolver", () => {
  test("uses ERP_MIDAS_BROWSER_PATH when it points to an executable", async () => {
    const executablePath = await createFakeExecutable("Custom", "browser.exe");

    await expect(
      resolveCorporateBrowserExecutable(undefined, {
        env: buildEnv({ ERP_MIDAS_BROWSER_PATH: executablePath }),
      }),
    ).resolves.toMatchObject({
      path: executablePath,
      source: "env-path",
    });
  });

  test("defaults to Microsoft Edge", () => {
    expect(resolveCorporateBrowserChannel(buildEnv())).toBe("msedge");
  });

  test("finds Microsoft Edge from the default channel", async () => {
    const executablePath = await createFakeExecutable("Microsoft", "Edge", "Application", "msedge.exe");
    const env = buildEnv({
      PROGRAMFILES: path.dirname(path.dirname(path.dirname(path.dirname(executablePath)))),
    });

    await expect(resolveCorporateBrowserExecutable(undefined, { env })).resolves.toMatchObject({
      path: executablePath,
      source: "channel",
    });
  });

  test("finds Google Chrome when ERP_MIDAS_BROWSER_CHANNEL is chrome", async () => {
    const executablePath = await createFakeExecutable("Google", "Chrome", "Application", "chrome.exe");
    const env = buildEnv({
      ERP_MIDAS_BROWSER_CHANNEL: "chrome",
      PROGRAMFILES: path.dirname(path.dirname(path.dirname(path.dirname(executablePath)))),
    });

    await expect(findInstalledBrowserByChannel("chrome", env)).resolves.toBe(executablePath);
    await expect(resolveCorporateBrowserExecutable(undefined, { env })).resolves.toMatchObject({
      path: executablePath,
      source: "channel",
    });
  });

  test("falls back to Playwright when the configured corporate browser is not installed", async () => {
    const playwrightPath = await createFakeExecutable("Playwright", "chrome.exe");

    await expect(
      resolveCorporateBrowserExecutable(undefined, {
        env: buildEnv({ ERP_MIDAS_BROWSER_CHANNEL: "chrome" }),
        resolvePlaywrightBrowser: async () => playwrightPath,
      }),
    ).resolves.toMatchObject({
      path: playwrightPath,
      source: "playwright",
    });
  });
});
