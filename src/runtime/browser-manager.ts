import fs from "node:fs/promises";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { registry } from "playwright-core/lib/server/registry/index";
import { APP_TIMEOUTS, ERP_SELECTORS, ERP_URL, MIDAS_SELECTORS, MIDAS_URL } from "../config";

interface BrowserManagerOptions {
  authStatePath?: string;
  onStatus?: (message: string) => Promise<void>;
}

export class BrowserManager {
  #browser?: Browser;
  #context?: BrowserContext;
  #erpPage?: Page;
  #midasPage?: Page;
  readonly #authStatePath?: string;
  readonly #onStatus?: (message: string) => Promise<void>;

  constructor(options: BrowserManagerOptions = {}) {
    this.#authStatePath = options.authStatePath;
    this.#onStatus = options.onStatus;
  }

  async launch(): Promise<void> {
    await this.#onStatus?.("Resolvendo um navegador Chromium compativel.");
    const chromeExecutablePath = await resolveChromiumExecutable(this.#onStatus);
    await this.#onStatus?.(`Abrindo o navegador Chromium em ${chromeExecutablePath}.`);
    this.#browser = await chromium.launch({
      headless: false,
      executablePath: chromeExecutablePath,
      args: ["--disable-pdf-viewer"],
    });

    const storageState = await this.resolveStorageState();
    this.#context = await this.#browser.newContext({
      acceptDownloads: true,
      storageState,
      viewport: { width: 1373, height: 776 },
    });
    this.#context.setDefaultNavigationTimeout(APP_TIMEOUTS.long);
    this.#context.setDefaultTimeout(APP_TIMEOUTS.long);

    this.#erpPage = await this.#context.newPage();
    this.#midasPage = await this.#context.newPage();
    this.#context.on("page", (page) => {
      void this.handleUnexpectedPage(page);
    });

    await this.#onStatus?.("Abrindo as abas do ERP e da Midas.");
    await Promise.allSettled([
      navigateForHandoff(this.erpPage, ERP_URL, "ERP", this.#onStatus),
      navigateForHandoff(this.midasPage, MIDAS_URL, "Midas", this.#onStatus),
    ]);

    await this.erpPage.bringToFront().catch(() => undefined);
  }

  get erpPage(): Page {
    if (!this.#erpPage) {
      throw new Error("A aba do ERP nao esta disponivel.");
    }

    return this.#erpPage;
  }

  get midasPage(): Page {
    if (!this.#midasPage) {
      throw new Error("A aba da Midas nao esta disponivel.");
    }

    return this.#midasPage;
  }

  async waitForErpGrid(): Promise<void> {
    await this.erpPage.locator(ERP_SELECTORS.rowInputs).first().waitFor({ timeout: APP_TIMEOUTS.long });
  }

  async getVisiblePoNumbers(): Promise<string[]> {
    const rows = this.erpPage.locator(ERP_SELECTORS.rowInputs);
    const count = await rows.count();
    const poNumbers: string[] = [];

    for (let index = 0; index < count; index += 1) {
      const value = (await rows.nth(index).inputValue()).trim();
      if (value) {
        poNumbers.push(value);
      }
    }

    return [...new Set(poNumbers)];
  }

  async openErpPurchaseOrder(poNumber: string): Promise<void> {
    await this.erpPage.bringToFront().catch(() => undefined);
    const rows = this.erpPage.locator(ERP_SELECTORS.rowInputs);
    const count = await rows.count();

    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index);
      if ((await row.inputValue()).trim() !== poNumber) {
        continue;
      }

      await row.scrollIntoViewIfNeeded().catch(() => undefined);

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          if (attempt === 1) {
            await row.dblclick({ timeout: APP_TIMEOUTS.medium });
            await sleep(APP_TIMEOUTS.gridSettle);
            await this.pressErpKey("Enter");
          } else {
            await row.click({ timeout: APP_TIMEOUTS.medium });
            await sleep(APP_TIMEOUTS.keyboardSettle);
            await this.pressErpKey("Enter");
          }
        } catch {
          await sleep(APP_TIMEOUTS.keyboardSettle);
          await row.click({ timeout: APP_TIMEOUTS.medium }).catch(() => undefined);
          await sleep(APP_TIMEOUTS.keyboardSettle);
          await this.pressErpKey("Enter").catch(() => undefined);
        }

        if (await this.waitForErpPurchaseOrderReady()) {
          return;
        }

        await this.#onStatus?.(
          `A OC ${poNumber} ainda nao abriu completamente apos a tentativa ${attempt}; tentando novamente.`,
        );
        await this.pressErpKey("Escape").catch(() => undefined);
        await this.closeErpDialogs().catch(() => undefined);
        await sleep(APP_TIMEOUTS.gridSettle);
      }

      break;
    }

    throw new Error(`Nao foi possivel abrir a OC ${poNumber} no ERP para acessar os anexos.`);
  }

  async downloadErpAttachment(downloadPath: string): Promise<{ originalFileName: string }> {
    await this.erpPage.locator(ERP_SELECTORS.attachmentsButton).last().waitFor({
      state: "visible",
      timeout: APP_TIMEOUTS.orderOpen,
    });
    await this.erpPage.locator(ERP_SELECTORS.attachmentsButton).last().click({
      timeout: APP_TIMEOUTS.medium,
    });
    await this.erpPage.locator(ERP_SELECTORS.openAttachmentButton).last().waitFor({
      timeout: APP_TIMEOUTS.long,
    });

    const openButton = this.erpPage.locator(ERP_SELECTORS.openAttachmentButton).last();
    const downloadPromise = this.erpPage.waitForEvent("download", { timeout: APP_TIMEOUTS.download });
    await openButton.click({ timeout: APP_TIMEOUTS.medium });

    const download = await downloadPromise;
    const originalFileName = download.suggestedFilename();
    await download.saveAs(downloadPath);
    return { originalFileName };
  }

  async closeErpDialogs(): Promise<void> {
    const closeAttachmentButton = this.erpPage.locator(ERP_SELECTORS.closeAttachmentButton).last();
    if ((await closeAttachmentButton.count()) > 0) {
      await closeAttachmentButton.click().catch(() => undefined);
    }

    const closePurchaseButton = this.erpPage.locator(ERP_SELECTORS.closePurchaseButton).last();
    if ((await closePurchaseButton.count()) > 0) {
      await closePurchaseButton.click().catch(() => undefined);
    }
  }

  async scrollErpGrid(): Promise<void> {
    await this.erpPage.mouse.wheel(0, 700);
    await sleep(APP_TIMEOUTS.gridSettle + 250);
  }

  async getMidasSupportsMultiple(): Promise<boolean> {
    const input = this.midasPage.locator(MIDAS_SELECTORS.fileInput).first();
    await input.waitFor({ state: "attached", timeout: APP_TIMEOUTS.long });
    return (await input.getAttribute("multiple")) !== null;
  }

  async uploadMidasFiles(filePaths: string[]): Promise<{ toastText?: string }> {
    const input = this.midasPage.locator(MIDAS_SELECTORS.fileInput).first();
    await input.waitFor({ state: "attached", timeout: APP_TIMEOUTS.long });

    try {
      await input.setInputFiles(filePaths);
      await this.midasPage.getByRole("button", { name: /enviar/i }).first().click({
        timeout: APP_TIMEOUTS.medium,
      });
      return { toastText: await this.waitForMidasSuccessToast() };
    } finally {
      await input.setInputFiles([]).catch(() => undefined);
    }
  }

  async waitForMidasSuccessToast(): Promise<string> {
    const alerts = this.midasPage.locator(MIDAS_SELECTORS.alertContainers);

    try {
      await alerts.first().waitFor({ timeout: APP_TIMEOUTS.upload });
      const text = (await alerts.first().innerText()).toLowerCase();
      if (/(erro|falha)/i.test(text)) {
        throw new Error(`O portal retornou erro: ${text}`);
      }
      return text;
    } catch (error) {
      await sleep(3_000);
      if (error instanceof Error && /O portal retornou erro/i.test(error.message)) {
        throw error;
      }
      return "";
    }
  }

  async close(): Promise<void> {
    await this.persistStorageState().catch(() => undefined);
    await this.#context?.close().catch(() => undefined);
    await this.#browser?.close().catch(() => undefined);
    this.#context = undefined;
    this.#browser = undefined;
    this.#erpPage = undefined;
    this.#midasPage = undefined;
  }

  async handleUnexpectedPage(page: Page): Promise<void> {
    if (page === this.#erpPage || page === this.#midasPage) {
      return;
    }

    const opener = await page.opener();
    const origin =
      opener === this.#erpPage ? "ERP" : opener === this.#midasPage ? "Midas" : "desconhecida";

    await this.#onStatus?.(`Uma aba extra foi aberta pela origem ${origin}; fechando para preservar a automacao.`);
    await page.close().catch(() => undefined);
    if (origin === "ERP") {
      await this.#erpPage?.bringToFront().catch(() => undefined);
    }
    if (origin === "Midas") {
      await this.#midasPage?.bringToFront().catch(() => undefined);
    }
  }

  async persistStorageState(): Promise<void> {
    if (!this.#context || !this.#authStatePath) {
      return;
    }

    await this.#context.storageState({ path: this.#authStatePath });
    await this.#onStatus?.(`Sessao do navegador salva em ${this.#authStatePath}.`);
  }

  async resolveStorageState(): Promise<string | undefined> {
    if (!this.#authStatePath) {
      return undefined;
    }

    if (!(await fileExists(this.#authStatePath))) {
      return undefined;
    }

    await this.#onStatus?.(`Reutilizando sessao salva em ${this.#authStatePath}.`);
    return this.#authStatePath;
  }

  async waitForErpPurchaseOrderReady(): Promise<boolean> {
    const purchaseCloseButton = this.erpPage.locator(ERP_SELECTORS.closePurchaseButton).last();
    const attachmentsButton = this.erpPage.locator(ERP_SELECTORS.attachmentsButton).last();

    try {
      await Promise.any([
        purchaseCloseButton.waitFor({ state: "visible", timeout: APP_TIMEOUTS.orderOpen }),
        attachmentsButton.waitFor({ state: "visible", timeout: APP_TIMEOUTS.orderOpen }),
      ]);
      await attachmentsButton.waitFor({ state: "visible", timeout: APP_TIMEOUTS.long });
      return true;
    } catch {
      return false;
    }
  }

  async pressErpKey(key: string): Promise<void> {
    await sleep(APP_TIMEOUTS.keyboardSettle);
    await this.erpPage.keyboard.press(key);
    await sleep(APP_TIMEOUTS.keyboardSettle);
  }
}

async function resolveChromiumExecutable(
  onStatus?: (message: string) => Promise<void>,
): Promise<string> {
  const preferredBrowserPath = process.env.ERP_MIDAS_BROWSER_PATH;
  if (preferredBrowserPath && (await fileExists(preferredBrowserPath))) {
    await onStatus?.(`Usando o navegador configurado em ERP_MIDAS_BROWSER_PATH: ${preferredBrowserPath}.`);
    return preferredBrowserPath;
  }

  const playwrightBrowserPath = await resolvePlaywrightChromium(onStatus);
  if (playwrightBrowserPath) {
    return playwrightBrowserPath;
  }

  const localBrowserPath = await findInstalledChromiumBrowser();
  if (localBrowserPath) {
    await onStatus?.(`Usando o navegador instalado localmente como fallback: ${localBrowserPath}.`);
    return localBrowserPath;
  }

  throw new Error(
    "Nenhum navegador Chromium compativel foi encontrado. Defina ERP_MIDAS_BROWSER_PATH ou reinstale o Playwright.",
  );
}

async function resolvePlaywrightChromium(
  onStatus?: (message: string) => Promise<void>,
): Promise<string | undefined> {
  const managedPath = safeChromiumExecutablePath();
  if (managedPath && (await fileExists(managedPath))) {
    await onStatus?.(`Usando o Chromium gerenciado pelo Playwright: ${managedPath}.`);
    return managedPath;
  }

  const chromiumExecutable = registry.findExecutable("chromium");
  const existingPath = chromiumExecutable.executablePath("javascript");
  if (existingPath && (await fileExists(existingPath))) {
    await onStatus?.(`Usando o Chromium do registro interno do Playwright: ${existingPath}.`);
    return existingPath;
  }

  await onStatus?.("Chromium do Playwright nao encontrado. Instalando automaticamente.");
  const executables = registry.resolveBrowsers(["chromium"], { shell: "all" });
  await registry.install(executables, {});
  const installedPath =
    chromiumExecutable.executablePath("javascript") ??
    chromiumExecutable.executablePathOrDie("javascript");
  if (await fileExists(installedPath)) {
    await onStatus?.(`Usando o Chromium instalado automaticamente pelo Playwright: ${installedPath}.`);
    return installedPath;
  }

  return undefined;
}

function safeChromiumExecutablePath(): string | undefined {
  try {
    return chromium.executablePath();
  } catch {
    return undefined;
  }
}

async function findInstalledChromiumBrowser(): Promise<string | undefined> {
  const candidates = [
    process.env["PROGRAMFILES"]
      ? `${process.env["PROGRAMFILES"]}\\Google\\Chrome\\Application\\chrome.exe`
      : undefined,
    process.env["PROGRAMFILES(X86)"]
      ? `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`
      : undefined,
    process.env.LOCALAPPDATA
      ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
      : undefined,
    process.env["PROGRAMFILES"]
      ? `${process.env["PROGRAMFILES"]}\\Microsoft\\Edge\\Application\\msedge.exe`
      : undefined,
    process.env["PROGRAMFILES(X86)"]
      ? `${process.env["PROGRAMFILES(X86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`
      : undefined,
    process.env.LOCALAPPDATA
      ? `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`
      : undefined,
  ];

  for (const candidate of candidates) {
    if (candidate && (await fileExists(candidate))) {
      return candidate;
    }
  }

  return undefined;
}

async function navigateForHandoff(
  page: Page,
  url: string,
  label: string,
  onStatus?: (message: string) => Promise<void>,
): Promise<void> {
  try {
    await page.goto(url, {
      waitUntil: "commit",
      timeout: APP_TIMEOUTS.long,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await onStatus?.(`A navegacao da aba ${label} nao terminou de forma limpa: ${message}`);
  }
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
