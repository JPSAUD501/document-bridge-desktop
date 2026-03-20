import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isCompiledBinary } from "./app-version";
import { runBootstrap } from "./bootstrap/run-bootstrap";
import { parseCliArgs, printHelp } from "./cli";
import { AppController } from "./runtime/app-controller";
import { runTui } from "./tui/app";

const POWERSHELL_RELAUNCH_ENV = "ERP_MIDAS_TUI_RELAUNCHED";

process.on("uncaughtException", (error) => {
  writeBootstrapErrorLog("uncaughtException", error);
});

process.on("unhandledRejection", (reason) => {
  writeBootstrapErrorLog("unhandledRejection", reason);
});

async function main(): Promise<void> {
  writeLauncherLog(`Inicio do processo. argv=${JSON.stringify(process.argv.slice(2))}`);
  const cliOptions = parseCliArgs(process.argv.slice(2));

  if (cliOptions.help) {
    printHelp();
    return;
  }

  const terminalStatus = await ensureInteractiveTerminal();
  writeLauncherLog(`Status do terminal: ${terminalStatus}`);
  if (terminalStatus === "relaunch") {
    return;
  }
  if (terminalStatus === "error") {
    process.exitCode = 1;
    return;
  }

  const bootstrap = await runBootstrap();
  if (bootstrap.mode === "handoff") {
    return;
  }

  const controller = new AppController(cliOptions, bootstrap.notes);
  await runTui({ controller });
}

main().catch((error) => {
  writeBootstrapErrorLog("main.catch", error);
  console.error(error);
  process.exitCode = 1;
});

async function ensureInteractiveTerminal(): Promise<"ready" | "relaunch" | "error"> {
  if (process.stdout.isTTY && process.stdin.isTTY) {
    return "ready";
  }

  if (process.platform === "win32" && isCompiledBinary() && process.env[POWERSHELL_RELAUNCH_ENV] !== "1") {
    relaunchInPowerShell(process.argv.slice(2));
    return "relaunch";
  }

  writeLauncherLog("Terminal interativo nao encontrado.");
  console.error("Este aplicativo precisa ser executado em um terminal interativo.");
  return "error";
}

function relaunchInPowerShell(args: string[]): void {
  const exeInvocation = [`& ${toPowerShellLiteral(process.execPath)}`, ...args.map((arg) => toPowerShellLiteral(arg))].join(" ");
  const command = [`$env:${POWERSHELL_RELAUNCH_ENV}='1'`, exeInvocation].join("; ");
  writeLauncherLog(`Relancando em PowerShell. args=${JSON.stringify(args)}`);

  const child = spawn(
    "powershell.exe",
    ["-NoExit", "-ExecutionPolicy", "Bypass", "-Command", command],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
      env: {
        ...process.env,
        [POWERSHELL_RELAUNCH_ENV]: "1",
      },
    },
  );

  child.unref();
}

function toPowerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function writeLauncherLog(message: string): void {
  if (!isCompiledBinary()) {
    return;
  }

  try {
    const logDir = getLauncherLogDir();
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, "launcher.log"), `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch {
    return;
  }
}

function writeBootstrapErrorLog(source: string, error: unknown): void {
  if (!isCompiledBinary()) {
    return;
  }

  try {
    const logDir = getLauncherLogDir();
    const payload =
      error instanceof Error
        ? error.stack ?? error.message
        : typeof error === "string"
          ? error
          : JSON.stringify(error, null, 2);
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
      path.join(logDir, "startup-error.log"),
      `${new Date().toISOString()} [${source}] ${payload}\n\n`,
      "utf8",
    );
    writeLauncherLog(`Erro registrado em startup-error.log (${source}).`);
  } catch {
    return;
  }
}

function getLauncherLogDir(): string {
  const baseDir = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  return path.join(baseDir, "erp-midas-tui", "logs");
}
