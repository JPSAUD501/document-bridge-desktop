import readline from "node:readline";
import {
  formatLogDetails,
  formatLogTimestamp,
  summarizeManifestItem,
  translateExcelStatus,
  translateLogLevel,
  translatePhase,
  translateStage,
} from "../lib/display";
import type { LogLevel, RuntimeSnapshot } from "../types";
import { AppController } from "../runtime/app-controller";

interface TuiAppProps {
  controller: AppController;
}

const ENTER_ALT_SCREEN = "\u001b[?1049h";
const EXIT_ALT_SCREEN = "\u001b[?1049l";
const CLEAR_SCREEN = "\u001b[2J\u001b[H";
const HIDE_CURSOR = "\u001b[?25l";
const SHOW_CURSOR = "\u001b[?25h";
const RESET = "\u001b[0m";
const DIM = "\u001b[2m";
const CYAN = "\u001b[36m";
const BRIGHT_CYAN = "\u001b[96m";
const YELLOW = "\u001b[33m";
const GREEN = "\u001b[32m";
const RED = "\u001b[31m";
const BLUE = "\u001b[34m";
const WHITE = "\u001b[97m";

export async function runTui({ controller }: TuiAppProps): Promise<void> {
  let active = true;
  let snapshot = controller.snapshot;
  let exiting = false;
  let keypressReady = false;
  let resolveRun: () => void = () => undefined;

  const redraw = () => {
    if (!active) {
      return;
    }

    process.stdout.write(`${HIDE_CURSOR}${CLEAR_SCREEN}`);
    process.stdout.write(renderScreen(snapshot));
  };

  const onSnapshot = (next: RuntimeSnapshot) => {
    snapshot = next;
    redraw();
  };

  const unsubscribe = controller.subscribe(onSnapshot);
  const onResize = () => redraw();
  process.stdout.on("resize", onResize);

  const cleanup = async () => {
    if (!active) {
      return;
    }

    active = false;
    unsubscribe();
    process.stdout.off("resize", onResize);

    if (keypressReady) {
      process.stdin.off("keypress", onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
    }

    process.stdout.write(`${SHOW_CURSOR}${EXIT_ALT_SCREEN}`);
    await controller.shutdown().catch(() => undefined);
  };

  const exitApp = async () => {
    if (exiting) {
      return;
    }

    exiting = true;
    await cleanup();
    resolveRun();
  };

  const onKeypress = (_str: string, key: readline.Key) => {
    if ((key.ctrl && key.name === "c") || key.name === "escape" || key.name === "q") {
      void exitApp();
      return;
    }

    if (key.name === "return" && snapshot.phase === "ready" && snapshot.waitingForStart) {
      controller.requestStart();
    }

    if (key.name === "r" && canRetry(snapshot)) {
      void controller.retryFailedItems();
    }
  };

  readline.emitKeypressEvents(process.stdin);
  keypressReady = true;
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.on("keypress", onKeypress);

  process.stdout.write(`${ENTER_ALT_SCREEN}${HIDE_CURSOR}`);
  redraw();

  void (async () => {
    try {
      await controller.initialize();
      if (!active) {
        return;
      }

      await controller.waitForStartSignal();
      if (!active) {
        return;
      }

      await controller.execute();
      redraw();
    } catch {
      redraw();
    }
  })();

  return new Promise<void>((resolve) => {
    resolveRun = resolve;
  });
}

function renderScreen(snapshot: RuntimeSnapshot): string {
  const width = getScreenWidth();
  const sections = [
    renderPanel(
      `${paint("ERP -> Midas", BRIGHT_CYAN)} ${paint("|", DIM)} Fase: ${paint(translatePhase(snapshot.phase), phaseColor(snapshot.phase))}`,
      [
        `${paint("Atalhos:", DIM)} Enter inicia ${paint("|", DIM)} r faz retry ${paint("|", DIM)} q ou Esc sai`,
        paint(guidanceFor(snapshot), YELLOW),
      ],
      width,
    ),
    renderPanel(
      "Status atual",
      [
        `Pasta da execucao: ${snapshot.runDir ? truncateMiddle(snapshot.runDir, width - 24) : "-"}`,
        `Pasta dos PDFs: ${snapshot.downloadsDir ? truncateMiddle(snapshot.downloadsDir, width - 22) : "-"}`,
        `Navegador: ${snapshot.browserReady ? paint("Pronto", GREEN) : paint("Ainda abrindo", YELLOW)}`,
        `Planilha Excel: ${translateExcelStatus(snapshot.excelStatus)}`,
        `OCs visiveis no ERP: ${snapshot.visibleOcCount ?? "-"}`,
        `OCs encontradas: ${snapshot.discoveredOcCount != null ? String(snapshot.discoveredOcCount) : "-"}`,
        `Nota atual: ${snapshot.currentItem ?? "-"}`,
        `Lote atual: ${snapshot.currentBatch ?? "-"}`,
        "",
        `${paint("Fila:", DIM)} total ${paint(String(snapshot.counts.total), WHITE)} ${paint("|", DIM)} pendentes ${paint(String(snapshot.counts.pending), YELLOW)} ${paint("|", DIM)} baixando ${paint(String(snapshot.counts.downloading), CYAN)} ${paint("|", DIM)} baixados ${paint(String(snapshot.counts.downloaded), GREEN)}`,
        `${paint("Envio:", DIM)} na fila ${paint(String(snapshot.counts.queuedForUpload), YELLOW)} ${paint("|", DIM)} enviando ${paint(String(snapshot.counts.uploading), CYAN)} ${paint("|", DIM)} enviados ${paint(String(snapshot.counts.uploaded), GREEN)}`,
        `${paint("Falhas:", DIM)} download ${paint(String(snapshot.counts.downloadFailed), RED)} ${paint("|", DIM)} envio ${paint(String(snapshot.counts.uploadFailed), RED)}`,
      ],
      width,
    ),
    renderPanel("O que fazer agora", nextActionsFor(snapshot), width),
  ];

  const recentItems = snapshot.manifestItems.slice(Math.max(snapshot.manifestItems.length - 4, 0));
  if (recentItems.length > 0) {
    sections.push(
      renderPanel(
        "Notas recentes",
        recentItems.map((item) => `${item.poNumber} | ${summarizeManifestItem(item)}`),
        width,
      ),
    );
  }

  const recentErrors = snapshot.errors.slice(Math.max(snapshot.errors.length - 3, 0));
  if (recentErrors.length > 0) {
    sections.push(renderPanel("Falhas recentes", recentErrors, width));
  }

  const recentLogs = snapshot.recentLogs.slice(Math.max(snapshot.recentLogs.length - 5, 0));
  sections.push(
    renderPanel(
      "Linha do tempo",
      recentLogs.length > 0
        ? recentLogs.map((entry) => {
            const details = formatLogDetails(entry.details);
            const base = `${paint(formatLogTimestamp(entry.timestamp), DIM)} ${paint(`[${translateLogLevel(entry.level)}]`, levelColor(entry.level))} ${paint(`[${translateStage(entry.stage)}]`, BLUE)} ${entry.message}`;
            return details ? `${base} ${paint("|", DIM)} ${details}` : base;
          })
        : ["Nenhum evento registrado ainda."],
      width,
    ),
  );

  return `${sections.join("\n\n")}\n`;
}

function guidanceFor(snapshot: RuntimeSnapshot): string {
  if (snapshot.phase === "bootstrap") {
    return "Inicializando a execucao e preparando os arquivos locais.";
  }

  if (snapshot.phase === "ready" && snapshot.waitingForStart) {
    return snapshot.visibleOcCount != null
      ? `Ambiente pronto. O ERP mostra ${snapshot.visibleOcCount} OCs visiveis. Pressione Enter para comecar a automacao.`
      : "Ambiente pronto. Pressione Enter para comecar a automacao.";
  }

  if (snapshot.phase === "preflight") {
    return "Abrindo navegador e preparando a execucao.";
  }

  if (snapshot.phase === "discovering") {
    return "Varrendo o ERP por completo antes de iniciar os downloads.";
  }

  if (snapshot.phase === "summary") {
    return canRetry(snapshot)
      ? "Execucao concluida com pendencias. Pressione r para tentar novamente."
      : "Execucao concluida. Revise o resumo e os arquivos gerados.";
  }

  if (snapshot.phase === "error") {
    return "Execucao interrompida. Veja as falhas abaixo e pressione r para tentar novamente.";
  }

  return "Acompanhe o progresso em tempo real pelo painel.";
}

function nextActionsFor(snapshot: RuntimeSnapshot): string[] {
  if (snapshot.phase === "bootstrap") {
    return ["Aguarde a inicializacao do aplicativo."];
  }

  if (snapshot.phase === "ready" && snapshot.waitingForStart) {
    return [
      "Confira ERP e Midas e pressione Enter.",
      "1. Entre no ERP.",
      "2. Aplique o filtro para mostrar so as notas desejadas.",
      "3. Confira a previa de OCs visiveis no status atual.",
      "4. Entre na Midas e deixe a tela de upload aberta.",
    ];
  }

  if (snapshot.phase === "preflight") {
    return ["Aguarde a abertura do navegador e das abas."];
  }

  if (snapshot.phase === "downloading") {
    return ["Deixe o ERP e a Midas abertos enquanto os PDFs sao baixados."];
  }

  if (snapshot.phase === "discovering") {
    return ["Aguarde a varredura completa do ERP para mapear todas as OCs filtradas."];
  }

  if (snapshot.phase === "uploading") {
    return ["Aguarde o envio dos lotes para a Midas."];
  }

  if (snapshot.phase === "summary") {
    return canRetry(snapshot)
      ? ["Pressione r para reprocessar os itens falhos ou pendentes."]
      : ["Revise os arquivos gerados e os status finais."];
  }

  return ["Ajuste a tela se necessario e pressione r para tentar novamente."];
}

function canRetry(snapshot: RuntimeSnapshot): boolean {
  if (snapshot.waitingForStart || !snapshot.browserReady) {
    return false;
  }

  if (snapshot.phase !== "summary" && snapshot.phase !== "error") {
    return false;
  }

  return (
    snapshot.counts.pending > 0 ||
    snapshot.counts.downloading > 0 ||
    snapshot.counts.downloadFailed > 0 ||
    snapshot.counts.queuedForUpload > 0 ||
    snapshot.counts.uploading > 0 ||
    snapshot.counts.uploadFailed > 0
  );
}

function renderPanel(title: string, lines: string[], width: number): string {
  const panelWidth = Math.max(60, width);
  const innerWidth = panelWidth - 4;
  const content = lines
    .flatMap((line) => wrapLine(line, innerWidth))
    .map((line) => `| ${padAnsiRight(line, innerWidth)} |`);

  return [
    `+${"-".repeat(panelWidth - 2)}+`,
    `| ${padAnsiRight(title, innerWidth)} |`,
    ...content,
    `+${"-".repeat(panelWidth - 2)}+`,
  ].join("\n");
}

function wrapLine(line: string, width: number): string[] {
  const plain = stripAnsi(line);
  if (plain.length === 0) {
    return [""];
  }

  if (plain.length <= width) {
    return [line];
  }

  return wrapPlainText(plain, width);
}

function wrapPlainText(value: string, width: number): string[] {
  const words = value.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const token = current.length === 0 ? word : `${current} ${word}`;
    if (token.length <= width) {
      current = token;
      continue;
    }

    if (current.length > 0) {
      lines.push(current);
      current = "";
    }

    if (word.length <= width) {
      current = word;
      continue;
    }

    let remaining = word;
    while (remaining.length > width) {
      lines.push(remaining.slice(0, width));
      remaining = remaining.slice(width);
    }
    current = remaining;
  }

  if (current.length > 0) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [""];
}

function padAnsiRight(value: string, width: number): string {
  const visibleLength = stripAnsi(value).length;
  if (visibleLength >= width) {
    return value;
  }

  return `${value}${" ".repeat(width - visibleLength)}`;
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const sideLength = Math.max(8, Math.floor((maxLength - 3) / 2));
  return `${value.slice(0, sideLength)}...${value.slice(-sideLength)}`;
}

function getScreenWidth(): number {
  const columns = process.stdout.columns ?? 100;
  return Math.max(70, Math.min(columns, 110));
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
}

function paint(value: string, color: string): string {
  return `${color}${value}${RESET}`;
}

function phaseColor(phase: RuntimeSnapshot["phase"]): string {
  if (phase === "error") {
    return RED;
  }

  if (phase === "summary") {
    return GREEN;
  }

  if (phase === "ready") {
    return YELLOW;
  }

  return CYAN;
}

function levelColor(level: LogLevel): string {
  if (level === "ERROR") {
    return RED;
  }

  if (level === "WARN") {
    return YELLOW;
  }

  return CYAN;
}
