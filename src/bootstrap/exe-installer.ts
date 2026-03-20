import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

interface ScheduleExecutableSwapOptions {
  currentExePath: string;
  stagedExePath: string;
  logPath: string;
}

export async function scheduleExecutableSwap(
  options: ScheduleExecutableSwapOptions,
): Promise<void> {
  const helperDir = path.join(os.tmpdir(), "erp-midas-tui-updater");
  await fs.mkdir(helperDir, { recursive: true });
  const helperPath = path.join(helperDir, `${randomUUID()}.ps1`);
  const backupExePath = `${options.currentExePath}.bak`;

  const script = [
    "param(",
    "  [int]$ParentPid,",
    "  [string]$CurrentExe,",
    "  [string]$DownloadedExe,",
    "  [string]$BackupExe,",
    "  [string]$LogPath",
    ")",
    "",
    "function Write-Log([string]$Message) {",
    "  Add-Content -Path $LogPath -Value ((Get-Date -Format o) + ' ' + $Message)",
    "}",
    "",
    "try {",
    "  while (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 500 }",
    "  Write-Log 'Iniciando a troca do executavel.'",
    "  if (Test-Path $BackupExe) { Remove-Item $BackupExe -Force }",
    "  Rename-Item -Path $CurrentExe -NewName ([IO.Path]::GetFileName($BackupExe)) -Force",
    "  Move-Item -Path $DownloadedExe -Destination $CurrentExe -Force",
    "  Write-Log 'Troca concluida. Reiniciando o aplicativo.'",
    "  Start-Process -FilePath $CurrentExe",
    "  Start-Sleep -Milliseconds 500",
    "  if (Test-Path $BackupExe) { Remove-Item $BackupExe -Force }",
    "} catch {",
    "  Write-Log ('Falha na troca do executavel: ' + $_.Exception.Message)",
    "  if ((Test-Path $BackupExe) -and !(Test-Path $CurrentExe)) {",
    "    Move-Item -Path $BackupExe -Destination $CurrentExe -Force",
    "  }",
    "  if (Test-Path $CurrentExe) {",
    "    Start-Process -FilePath $CurrentExe",
    "  }",
    "} finally {",
    "  if (Test-Path $PSCommandPath) { Remove-Item $PSCommandPath -Force }",
    "}",
  ].join("\r\n");

  await fs.writeFile(helperPath, script, "utf8");
  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      helperPath,
      "-ParentPid",
      `${process.pid}`,
      "-CurrentExe",
      options.currentExePath,
      "-DownloadedExe",
      options.stagedExePath,
      "-BackupExe",
      backupExePath,
      "-LogPath",
      options.logPath,
    ],
    {
      detached: true,
      stdio: "ignore",
    },
  );

  child.unref();
}
