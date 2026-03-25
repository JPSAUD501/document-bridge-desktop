import fs from "node:fs/promises";
import path from "node:path";
import type { CliOptions, RunPaths } from "../types";
import { fileExists, findWorkspaceRoot, formatRunId } from "../lib/utils";

export async function resolveRunPaths(cliOptions: CliOptions): Promise<RunPaths> {
  if (cliOptions.resumePath) {
    const runDir = path.resolve(cliOptions.resumePath);
    const exists = await fileExists(runDir);
    if (!exists) {
      throw new Error(`Resume folder not found: ${runDir}`);
    }

    const workspaceRoot = await findWorkspaceRoot();
    const downloadsDir = path.join(runDir, "downloads");
    const authStatePath = await resolveAuthStatePath(workspaceRoot);
    await fs.mkdir(downloadsDir, { recursive: true });
    await fs.mkdir(path.dirname(authStatePath), { recursive: true });

    return {
      workspaceRoot,
      runId: path.basename(runDir),
      runDir,
      downloadsDir,
      authStatePath,
      manifestPath: path.join(runDir, "manifest.json"),
      logPath: path.join(runDir, "run.log"),
      excelPath: path.join(runDir, "status.xlsx"),
    };
  }

  const workspaceRoot = await findWorkspaceRoot();
  const runId = formatRunId();
  const outputRootPath = cliOptions.outputRootPath
    ? path.resolve(cliOptions.outputRootPath)
    : path.join(workspaceRoot, "output");
  const runDir = path.join(outputRootPath, runId);
  const downloadsDir = path.join(runDir, "downloads");
  const authStatePath = await resolveAuthStatePath(workspaceRoot);
  await fs.mkdir(downloadsDir, { recursive: true });
  await fs.mkdir(path.dirname(authStatePath), { recursive: true });

  return {
    workspaceRoot,
    runId,
    runDir,
    downloadsDir,
    authStatePath,
    manifestPath: path.join(runDir, "manifest.json"),
    logPath: path.join(runDir, "run.log"),
    excelPath: path.join(runDir, "status.xlsx"),
  };
}

export async function resolveAuthStatePath(workspaceRoot: string): Promise<string> {
  const preferredDir = path.join(workspaceRoot, "tmp", "erp-midas-desktop");
  const legacyPath = path.join(workspaceRoot, "tmp", "erp-midas-tui", "auth-state.json");
  const preferredPath = path.join(preferredDir, "auth-state.json");

  await fs.mkdir(preferredDir, { recursive: true });

  if (!(await fileExists(preferredPath)) && (await fileExists(legacyPath))) {
    await fs.copyFile(legacyPath, preferredPath).catch(() => undefined);
  }

  return preferredPath;
}
