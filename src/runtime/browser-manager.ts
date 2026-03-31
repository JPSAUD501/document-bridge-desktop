import fs from "node:fs/promises";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { registry } from "playwright-core/lib/server/registry/index";
import { APP_TIMEOUTS, ERP_SELECTORS, ERP_URL, MIDAS_SELECTORS, MIDAS_URL } from "../config";
import { normalizePdfFileName } from "../lib/utils";

interface BrowserManagerOptions {
  authStatePath?: string;
  onStatus?: (message: string) => Promise<void>;
}

export interface ErpGridState {
  visibleItems: Array<{
    poNumber: string;
    rowKey: string;
  }>;
  selectedItem?: {
    poNumber: string;
    rowKey: string;
  };
  selectedSignature?: string;
  visiblePoNumbers: string[];
  visibleSignature: string;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface ErpGridAdvanceResult {
  state: ErpGridState;
  advanced: boolean;
  selectionAdvanced: boolean;
  usedFallback: boolean;
  reachedEnd: boolean;
}

const ERP_GRID_STABLE_SAMPLES = 3;
const ERP_GRID_SAMPLE_INTERVAL_MS = 200;
const ERP_GRID_SETTLE_TIMEOUT_MS = 3_000;
const ERP_GRID_SELECTION_RETRIES = 2;
const ERP_GRID_SCROLL_RETRIES = 3;
const ERP_GRID_END_TOLERANCE_PX = 12;

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

  async waitForErpGrid(timeoutMs = APP_TIMEOUTS.long): Promise<void> {
    await this.getVisibleErpRows().first().waitFor({ timeout: timeoutMs });
  }

  async inspectVisiblePoNumbers(timeoutMs = APP_TIMEOUTS.medium): Promise<string[]> {
    await this.waitForErpGrid(timeoutMs);
    return (await this.waitForErpGridStabilized()).visiblePoNumbers;
  }

  async getErpGridState(): Promise<ErpGridState> {
    await this.waitForErpGrid();
    return this.waitForErpGridStabilized();
  }

  async getVisiblePoNumbers(): Promise<string[]> {
    return (await this.getVisibleErpItems()).map((item) => item.poNumber);
  }

  async getVisibleErpItems(): Promise<Array<{ poNumber: string; rowKey: string }>> {
    const rows = this.getVisibleErpRows();
    const count = await rows.count();
    const items: Array<{ poNumber: string; rowKey: string }> = [];

    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index);
      const snapshot = await this.readErpRowSnapshot(row);
      if (snapshot) {
        items.push({ poNumber: snapshot.poNumber, rowKey: snapshot.rowKey });
      }
    }

    return items;
  }

  async openErpPurchaseOrder(poNumber: string, rowKey?: string): Promise<void> {
    await this.erpPage.bringToFront().catch(() => undefined);
    const rows = this.getVisibleErpRows();
    const count = await rows.count();

    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index);
      if ((await row.inputValue()).trim() !== poNumber) {
        continue;
      }

      if (rowKey) {
        const snapshot = await this.readErpRowSnapshot(row);
        if (!snapshot || snapshot.rowKey !== rowKey) {
          continue;
        }
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
    const originalFileName = normalizePdfFileName(download.suggestedFilename());
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

  async advanceErpGrid(previousState?: ErpGridState): Promise<ErpGridAdvanceResult> {
    await this.erpPage.bringToFront().catch(() => undefined);
    let baseline = await this.ensureErpGridSelection(previousState ?? (await this.getErpGridState()));

    for (let attempt = 1; attempt <= ERP_GRID_SELECTION_RETRIES; attempt += 1) {
      const selectionAdvance = await this.tryAdvanceErpGridSelection(baseline);
      if (selectionAdvance.advanced) {
        return {
          state: selectionAdvance.state,
          advanced: true,
          selectionAdvanced: selectionAdvance.selectionAdvanced,
          usedFallback: false,
          reachedEnd: isErpGridAtEnd(selectionAdvance.state),
        };
      }
      baseline = selectionAdvance.state;
    }

    await this.#onStatus?.("A selecao da grade do ERP travou; aplicando fallback de scroll.");

    let latest = baseline;
    for (let attempt = 1; attempt <= ERP_GRID_SCROLL_RETRIES; attempt += 1) {
      latest = await this.ensureErpGridSelection(latest, {
        preferredRowKey: latest.selectedItem?.rowKey,
      });
      await this.performErpGridFallbackAdvanceAttempt();
      latest = await this.waitForErpGridStabilized();

      if (!didErpGridAdvance(baseline, latest)) {
        baseline = latest;
        continue;
      }

      const resumedState = await this.ensureErpGridSelection(latest);
      const resumedAdvance = await this.tryAdvanceErpGridSelection(resumedState);
      if (resumedAdvance.advanced) {
        return {
          state: resumedAdvance.state,
          advanced: true,
          selectionAdvanced: true,
          usedFallback: true,
          reachedEnd: isErpGridAtEnd(resumedAdvance.state),
        };
      }

      return {
        state: resumedAdvance.state,
        advanced: true,
        selectionAdvanced: false,
        usedFallback: true,
        reachedEnd: isErpGridAtEnd(resumedAdvance.state),
      };
    }

    return {
      state: latest,
      advanced: false,
      selectionAdvanced: false,
      usedFallback: true,
      reachedEnd: isErpGridAtEnd(latest),
    };
  }

  async scrollErpGrid(): Promise<void> {
    await this.advanceErpGrid().catch(() => undefined);
  }

  async performErpGridFallbackAdvanceAttempt(): Promise<void> {
    await this.erpPage.bringToFront().catch(() => undefined);
    const rows = this.getVisibleErpRows();
    if ((await rows.count()) > 0) {
      const currentState = await this.getErpGridState().catch(() => undefined);
      let anchorRow = rows.first();

      if (currentState?.selectedItem?.rowKey) {
        const count = await rows.count();
        for (let index = 0; index < count; index += 1) {
          const candidate = rows.nth(index);
          const snapshot = await this.readErpRowSnapshot(candidate);
          if (snapshot?.rowKey === currentState.selectedItem.rowKey) {
            anchorRow = candidate;
            break;
          }
        }
      }

      await anchorRow.click({ timeout: APP_TIMEOUTS.medium }).catch(() => undefined);
      await anchorRow
        .evaluate((input) => {
          const resolveScrollableMetrics = (start: HTMLElement) => {
            const candidates: HTMLElement[] = [];
            let node: HTMLElement | null = start;
            while (node) {
              const style = window.getComputedStyle(node);
              const overflowY = style.overflowY.toLowerCase();
              const canScroll =
                node.scrollHeight > node.clientHeight + 8 &&
                (overflowY.includes("auto") || overflowY.includes("scroll") || overflowY.includes("overlay"));
              if (canScroll) {
                candidates.push(node);
              }
              node = node.parentElement;
            }

            if (candidates.length > 0) {
              return candidates.sort((left, right) => right.scrollHeight - left.scrollHeight)[0] ?? null;
            }

            return null;
          };

          const container = resolveScrollableMetrics(input as HTMLElement);
          if (container) {
            const delta = Math.max(container.clientHeight * 0.9, 600);
            container.scrollTo({
              top: Math.min(container.scrollTop + delta, container.scrollHeight),
              behavior: "auto",
            });
            return;
          }

          window.scrollBy({ top: 900, behavior: "auto" });
        })
        .catch(() => undefined);
      await sleep(APP_TIMEOUTS.keyboardSettle);
      await this.erpPage.keyboard.press("PageDown").catch(() => undefined);
      await sleep(APP_TIMEOUTS.gridSettle);
    }

    await this.erpPage.mouse.wheel(0, 1200);
    await sleep(APP_TIMEOUTS.gridSettle + 250);
  }

  async resetErpGridToTop(): Promise<ErpGridState> {
    await this.erpPage.bringToFront().catch(() => undefined);
    const rows = this.getVisibleErpRows();
    if ((await rows.count()) === 0) {
      return this.getErpGridState();
    }

    const firstRow = rows.first();
    await firstRow.click({ timeout: APP_TIMEOUTS.medium }).catch(() => undefined);
    await firstRow
      .evaluate((input) => {
        const resolveScrollableMetrics = (start: HTMLElement) => {
          const candidates: HTMLElement[] = [];
          let node: HTMLElement | null = start;
          while (node) {
            const style = window.getComputedStyle(node);
            const overflowY = style.overflowY.toLowerCase();
            const canScroll =
              node.scrollHeight > node.clientHeight + 8 &&
              (overflowY.includes("auto") || overflowY.includes("scroll") || overflowY.includes("overlay"));
            if (canScroll) {
              candidates.push(node);
            }
            node = node.parentElement;
          }

          if (candidates.length > 0) {
            return candidates.sort((left, right) => right.scrollHeight - left.scrollHeight)[0] ?? null;
          }

          return null;
        };

        const container = resolveScrollableMetrics(input as HTMLElement);
        if (container) {
          container.scrollTo({ top: 0, behavior: "auto" });
          return;
        }

        window.scrollTo({ top: 0, behavior: "auto" });
      })
      .catch(() => undefined);

    await sleep(APP_TIMEOUTS.keyboardSettle);
    await this.erpPage.keyboard.press("Control+Home").catch(() => undefined);
    await sleep(APP_TIMEOUTS.gridSettle + 250);
    return this.ensureErpGridSelection(await this.waitForErpGridStabilized(), { preferFirstVisible: true });
  }

  async getMidasSupportsMultiple(): Promise<boolean> {
    await this.ensureMidasReadyForUpload();
    const input = this.midasPage.locator(MIDAS_SELECTORS.fileInput).first();
    await input.waitFor({ state: "attached", timeout: APP_TIMEOUTS.long });
    return (await input.getAttribute("multiple")) !== null;
  }

  async uploadMidasFiles(filePaths: string[]): Promise<{ toastText?: string }> {
    await this.ensureMidasReadyForUpload();
    const input = this.midasPage.locator(MIDAS_SELECTORS.fileInput).first();
    await input.waitFor({ state: "attached", timeout: APP_TIMEOUTS.long });

    try {
      await input.setInputFiles(filePaths);
      const uploadButton = this.midasPage.getByRole("button", { name: /enviar/i }).first();
      await uploadButton.waitFor({ state: "visible", timeout: APP_TIMEOUTS.long });
      await uploadButton.scrollIntoViewIfNeeded().catch(() => undefined);
      await this.waitForMidasUploadButtonEnabled(uploadButton, filePaths.length);
      await uploadButton.click({ timeout: APP_TIMEOUTS.upload });
      return { toastText: await this.waitForMidasSuccessToast() };
    } finally {
      await input.setInputFiles([]).catch(() => undefined);
    }
  }

  async waitForMidasUploadButtonEnabled(
    uploadButton: ReturnType<Page["getByRole"]>,
    fileCount: number,
  ): Promise<void> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < APP_TIMEOUTS.upload) {
      if (await uploadButton.isEnabled().catch(() => false)) {
        return;
      }

      await sleep(250);
    }

    throw new Error(
      `O botao Enviar permaneceu desabilitado apos anexar ${fileCount} arquivo(s) na Midas.`,
    );
  }

  async ensureMidasReadyForUpload(): Promise<void> {
    const newDocumentButton = this.midasPage.getByRole("button", { name: /enviar novo documento/i }).first();
    if (await newDocumentButton.isVisible().catch(() => false)) {
      await this.#onStatus?.("Retornando da tela de sucesso da Midas para um novo envio.");
      await newDocumentButton.scrollIntoViewIfNeeded().catch(() => undefined);
      await newDocumentButton.click({ timeout: APP_TIMEOUTS.long });
    }

    const input = this.midasPage.locator(MIDAS_SELECTORS.fileInput).first();
    await input.waitFor({ state: "attached", timeout: APP_TIMEOUTS.long });
    await this.ensureMidasDocumentType("Nfse");
  }

  async ensureMidasDocumentType(documentType: string): Promise<void> {
    const combo = this.midasPage.getByRole("combobox").first();
    await combo.waitFor({ state: "visible", timeout: APP_TIMEOUTS.long });

    const currentValue = ((await combo.inputValue().catch(() => "")) || (await combo.textContent()) || "")
      .trim()
      .toLowerCase();

    if (currentValue.includes(documentType.toLowerCase())) {
      return;
    }

    await this.#onStatus?.(`Selecionando o tipo de documento ${documentType} na Midas.`);
    await combo.click({ timeout: APP_TIMEOUTS.medium });

    const option = this.midasPage.getByRole("option", { name: new RegExp(documentType, "i") }).first();
    await option.waitFor({ state: "visible", timeout: APP_TIMEOUTS.long });
    await option.click({ timeout: APP_TIMEOUTS.medium });
  }

  async waitForMidasSuccessToast(): Promise<string> {
    const alerts = this.midasPage.locator(MIDAS_SELECTORS.alertContainers);
    const successHeading = this.midasPage.getByText(/documentos foram enviados com sucesso/i).first();
    const newDocumentButton = this.midasPage.getByRole("button", { name: /enviar novo documento/i }).first();
    const startedAt = Date.now();

    while (Date.now() - startedAt < APP_TIMEOUTS.upload) {
      if (
        (await successHeading.isVisible().catch(() => false)) ||
        (await newDocumentButton.isVisible().catch(() => false))
      ) {
        return "success-page";
      }

      if (await alerts.first().isVisible().catch(() => false)) {
        const text = (await alerts.first().innerText()).toLowerCase();
        if (/(erro|falha)/i.test(text)) {
          throw new Error(`O portal retornou erro: ${text}`);
        }
        return text;
      }

      await sleep(250);
    }

    return "";
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

  getVisibleErpRows() {
    return this.erpPage.locator(`${ERP_SELECTORS.rowInputs}:visible`);
  }

  async waitForErpGridStabilized(timeoutMs = ERP_GRID_SETTLE_TIMEOUT_MS): Promise<ErpGridState> {
    await this.waitForErpGrid();
    let previousState = await this.readErpGridState();
    let stableSamples = 0;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await sleep(ERP_GRID_SAMPLE_INTERVAL_MS);
      const nextState = await this.readErpGridState();
      if (areErpGridStatesStable(previousState, nextState)) {
        stableSamples += 1;
        if (stableSamples >= ERP_GRID_STABLE_SAMPLES) {
          return nextState;
        }
      } else {
        stableSamples = 0;
      }

      previousState = nextState;
    }

    return previousState;
  }

  async readErpGridState(): Promise<ErpGridState> {
    const rows = this.getVisibleErpRows();
    const count = await rows.count();
    const visibleItems: Array<{ poNumber: string; rowKey: string }> = [];
    let selectedItem: ErpGridState["selectedItem"];
    const visiblePoNumbers: string[] = [];

    if (count === 0) {
      return {
        visibleItems,
        selectedItem,
        selectedSignature: undefined,
        visiblePoNumbers,
        visibleSignature: visibleItems.map((item) => item.rowKey).join("|"),
        scrollTop: 0,
        scrollHeight: 0,
        clientHeight: 0,
      };
    }

    for (let index = 0; index < count; index += 1) {
      const snapshot = await this.readErpRowSnapshot(rows.nth(index));
      if (!snapshot) {
        continue;
      }

      visibleItems.push({ poNumber: snapshot.poNumber, rowKey: snapshot.rowKey });
      visiblePoNumbers.push(snapshot.poNumber);
      if (snapshot.isSelected && !selectedItem) {
        selectedItem = { poNumber: snapshot.poNumber, rowKey: snapshot.rowKey };
      }
    }

    const metrics = await rows.first().evaluate((input) => {
      const resolveScrollableMetrics = (start: HTMLElement | null) => {
        const candidates: HTMLElement[] = [];
        let node = start;
        while (node) {
          const style = window.getComputedStyle(node);
          const overflowY = style.overflowY.toLowerCase();
          const canScroll =
            node.scrollHeight > node.clientHeight + 8 &&
            (overflowY.includes("auto") || overflowY.includes("scroll") || overflowY.includes("overlay"));
          if (canScroll) {
            candidates.push(node);
          }
          node = node.parentElement;
        }

        if (candidates.length > 0) {
          return candidates.sort((left, right) => right.scrollHeight - left.scrollHeight)[0] ?? null;
        }

        return null;
      };

      const container = resolveScrollableMetrics(input as HTMLElement);
      if (container) {
        return {
          scrollTop: container.scrollTop,
          scrollHeight: container.scrollHeight,
          clientHeight: container.clientHeight,
        };
      }

      const root = document.scrollingElement ?? document.documentElement;
      return {
        scrollTop: root.scrollTop,
        scrollHeight: root.scrollHeight,
        clientHeight: window.innerHeight,
      };
    });

    return {
      visibleItems,
      selectedItem,
      selectedSignature: selectedItem?.rowKey,
      visiblePoNumbers,
      visibleSignature: visibleItems.map((item) => item.rowKey).join("|"),
      ...metrics,
    };
  }

  async readErpRowSnapshot(
    row: Locator,
  ): Promise<{ poNumber: string; rowKey: string; isSelected: boolean } | undefined> {
    return row.evaluate((input) => {
      const normalize = (raw: string | null | undefined) => (raw ?? "").replace(/\s+/g, " ").trim();
      const looksLikeSingleGridRow = (node: HTMLElement) => {
        const role = node.getAttribute("role")?.toLowerCase() ?? "";
        const tag = node.tagName.toLowerCase();
        const rect = node.getBoundingClientRect();
        const childCount = node.children.length;
        const text = normalize(node.innerText || node.textContent);

        if ((role === "row" || tag === "tr") && text) {
          return true;
        }

        return (
          rect.height >= 20 &&
          rect.height <= 90 &&
          childCount >= 2 &&
          childCount <= 20 &&
          Boolean(text)
        );
      };
      const matchesSelectedClass = (node: HTMLElement) => {
        const className = typeof node.className === "string" ? node.className : "";
        return /\b(selected|active|current|focused)\b/i.test(className);
      };

      const poNumber = normalize((input as HTMLInputElement).value || input.getAttribute("title"));
      if (!poNumber) {
        return undefined;
      }

      let rowRoot: HTMLElement | null = null;
      let current: HTMLElement | null = input as HTMLElement;
      let isSelected = false;
      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

      while (current) {
        if (!rowRoot && looksLikeSingleGridRow(current)) {
          rowRoot = current;
        }

        if (
          current.getAttribute("aria-selected") === "true" ||
          current.getAttribute("data-dyn-selected") === "true" ||
          matchesSelectedClass(current) ||
          (activeElement !== null && (activeElement === current || current.contains(activeElement)))
        ) {
          isSelected = true;
        }

        current = current.parentElement;
      }

      const rowKey = normalize(rowRoot?.innerText || rowRoot?.textContent) || poNumber;

      return {
        poNumber,
        rowKey,
        isSelected,
      };
    });
  }

  async ensureErpGridSelection(
    state?: ErpGridState,
    options: { preferredRowKey?: string; preferFirstVisible?: boolean; preferLastVisible?: boolean } = {},
  ): Promise<ErpGridState> {
    let currentState = state ?? (await this.getErpGridState());
    if (currentState.selectedItem) {
      return currentState;
    }

    const rows = this.getVisibleErpRows();
    const count = await rows.count();
    if (count === 0) {
      return currentState;
    }

    let targetIndex = options.preferLastVisible ? count - 1 : 0;

    if (options.preferredRowKey) {
      for (let index = 0; index < count; index += 1) {
        const snapshot = await this.readErpRowSnapshot(rows.nth(index));
        if (snapshot?.rowKey === options.preferredRowKey) {
          targetIndex = index;
          break;
        }
      }
    }

    await rows.nth(targetIndex).click({ timeout: APP_TIMEOUTS.medium }).catch(() => undefined);
    currentState = await this.waitForErpGridStabilized();
    return currentState;
  }

  async tryAdvanceErpGridSelection(
    baseline: ErpGridState,
  ): Promise<{ state: ErpGridState; advanced: boolean; selectionAdvanced: boolean }> {
    const preparedBaseline = await this.ensureErpGridSelection(baseline, {
      preferredRowKey: baseline.selectedItem?.rowKey,
    });

    await this.pressErpKey("ArrowDown").catch(() => undefined);
    const latest = await this.waitForErpGridStabilized();
    return {
      state: latest,
      advanced: didErpGridAdvance(preparedBaseline, latest),
      selectionAdvanced:
        Boolean(preparedBaseline.selectedSignature) &&
        Boolean(latest.selectedSignature) &&
        preparedBaseline.selectedSignature !== latest.selectedSignature,
    };
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

function didErpGridAdvance(previousState: ErpGridState, nextState: ErpGridState): boolean {
  return (
    nextState.selectedSignature !== previousState.selectedSignature ||
    nextState.visibleSignature !== previousState.visibleSignature ||
    nextState.scrollTop > previousState.scrollTop + 1 ||
    nextState.scrollHeight > previousState.scrollHeight + 1
  );
}

function areErpGridStatesStable(previousState: ErpGridState, nextState: ErpGridState): boolean {
  return (
    nextState.selectedSignature === previousState.selectedSignature &&
    nextState.visibleSignature === previousState.visibleSignature &&
    Math.abs(nextState.scrollTop - previousState.scrollTop) <= 1 &&
    Math.abs(nextState.scrollHeight - previousState.scrollHeight) <= 1
  );
}

function isErpGridAtEnd(state: ErpGridState): boolean {
  return state.scrollTop + state.clientHeight >= state.scrollHeight - ERP_GRID_END_TOLERANCE_PX;
}
