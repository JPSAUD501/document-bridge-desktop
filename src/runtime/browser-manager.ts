import fs from "node:fs/promises";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { registry } from "playwright-core/lib/server/registry/index";
import { APP_TIMEOUTS, ERP_SELECTORS, ERP_URL, MIDAS_SELECTORS, MIDAS_URL } from "../config";
import { buildErpRowKey, normalizePdfFileName } from "../lib/utils";

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

interface ErpRowCandidate {
  index: number;
  row: Locator;
  snapshot?: { poNumber: string; rowKey: string; isSelected: boolean };
  inViewport: boolean;
  interactable: boolean;
}

const ERP_GRID_STABLE_SAMPLES = 3;
const ERP_GRID_SAMPLE_INTERVAL_MS = 200;
const ERP_GRID_SETTLE_TIMEOUT_MS = 3_000;
const ERP_GRID_SELECTION_RETRIES = 3;

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
    await this.getErpRowInputs().first().waitFor({ state: "attached", timeout: timeoutMs });
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
    const candidates = await this.collectErpRowCandidates();
    return candidates
      .filter((candidate) => candidate.inViewport && candidate.snapshot)
      .map((candidate) => ({
        poNumber: candidate.snapshot!.poNumber,
        rowKey: candidate.snapshot!.rowKey,
      }));
  }

  async openErpPurchaseOrder(poNumber: string, rowKey?: string): Promise<void> {
    await this.erpPage.bringToFront().catch(() => undefined);
    const candidates = (await this.collectErpRowCandidates()).filter((candidate) => candidate.inViewport);

    const targetCandidate = candidates.find(
      (candidate) =>
        candidate.snapshot?.poNumber === poNumber && (!rowKey || candidate.snapshot.rowKey === rowKey),
    );

    if (!targetCandidate) {
      throw new Error(`Nao foi possivel localizar a OC ${poNumber} na grade atual do ERP.`);
    }

    const focusCandidate =
      this.resolveNearestInteractableErpRow(candidates, targetCandidate.index) ?? targetCandidate;
    const moveSteps = targetCandidate.index - focusCandidate.index;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await focusCandidate.row.scrollIntoViewIfNeeded().catch(() => undefined);
        await focusCandidate.row.click({ timeout: APP_TIMEOUTS.medium });
        await sleep(APP_TIMEOUTS.keyboardSettle);

        const navigationKey = moveSteps < 0 ? "ArrowUp" : "ArrowDown";
        for (let step = 0; step < Math.abs(moveSteps); step += 1) {
          await this.pressErpKey(navigationKey);
        }

        await this.pressErpKey("Enter");
      } catch {
        await sleep(APP_TIMEOUTS.keyboardSettle);
        await focusCandidate.row.click({ timeout: APP_TIMEOUTS.medium }).catch(() => undefined);
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
    let baseline = await this.ensureErpGridSelection(previousState ?? (await this.getErpGridState()), {
      preferLastVisible: true,
      forceFocus: true,
    });

    for (let attempt = 1; attempt <= ERP_GRID_SELECTION_RETRIES; attempt += 1) {
      const selectionAdvance = await this.tryAdvanceErpGridSelection(baseline);
      if (selectionAdvance.advanced) {
        return {
          state: selectionAdvance.state,
          advanced: true,
          selectionAdvanced: selectionAdvance.selectionAdvanced,
          usedFallback: false,
          reachedEnd: false,
        };
      }
      baseline = selectionAdvance.state;
      baseline = await this.ensureErpGridSelection(baseline, {
        preferLastVisible: true,
        forceFocus: true,
      });
    }

    return {
      state: baseline,
      advanced: false,
      selectionAdvanced: false,
      usedFallback: false,
      reachedEnd: isErpGridSelectionOnLastVisible(baseline),
    };
  }

  async scrollErpGrid(): Promise<void> {
    await this.advanceErpGrid().catch(() => undefined);
  }

  async resetErpGridToTop(): Promise<ErpGridState> {
    await this.erpPage.bringToFront().catch(() => undefined);
    const rows = this.getErpRowInputs();
    if ((await rows.count()) === 0) {
      return this.getErpGridState();
    }

    const baseline = await this.ensureErpGridSelection(await this.waitForErpGridStabilized(), {
      preferFirstVisible: true,
      forceFocus: true,
    });

    let currentState = baseline;
    let stagnantAttempts = 0;

    for (let attempt = 0; attempt < 150; attempt += 1) {
      await this.pressErpKey("ArrowUp").catch(() => undefined);
      const latest = await this.waitForErpGridStabilized();

      if (didErpGridAdvance(currentState, latest)) {
        currentState = latest;
        stagnantAttempts = 0;
        continue;
      }

      stagnantAttempts += 1;
      if (stagnantAttempts >= 5) {
        break;
      }
    }

    return this.ensureErpGridSelection(currentState, {
      preferFirstVisible: true,
      forceFocus: true,
    });
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

  getErpRowInputs() {
    return this.erpPage.locator(ERP_SELECTORS.rowInputs);
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
    const visibleItems: Array<{ poNumber: string; rowKey: string }> = [];
    let selectedItem: ErpGridState["selectedItem"];
    const visiblePoNumbers: string[] = [];
    const candidates = await this.collectErpRowCandidates();

    if (candidates.length === 0) {
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

    for (const candidate of candidates) {
      if (!candidate.snapshot) {
        continue;
      }

      if (candidate.inViewport) {
        visibleItems.push({ poNumber: candidate.snapshot.poNumber, rowKey: candidate.snapshot.rowKey });
        visiblePoNumbers.push(candidate.snapshot.poNumber);
      }

      if (candidate.snapshot.isSelected && !selectedItem) {
        selectedItem = { poNumber: candidate.snapshot.poNumber, rowKey: candidate.snapshot.rowKey };
      }
    }

    const metrics = await candidates[0]!.row.evaluate((input) => {
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
    const snapshot = await row.evaluate((input) => {
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

      let rowRoot = input.closest('[role="row"], tr') as HTMLElement | null;
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

      return {
        poNumber,
        isSelected,
        rowCells: Array.from(rowRoot?.querySelectorAll("input") ?? [])
          .map((control) => {
            const field =
              control.getAttribute("id") ||
              control.getAttribute("name") ||
              control.getAttribute("data-dyn-controlname") ||
              control.getAttribute("aria-label") ||
              undefined;
            const value = normalize(
              (control as HTMLInputElement).value ||
                control.getAttribute("title") ||
                control.getAttribute("aria-label"),
            );

            return { field, value };
          })
          .filter((cell) => Boolean(cell.value)),
      };
    });

    if (!snapshot) {
      return undefined;
    }

    return {
      poNumber: snapshot.poNumber,
      rowKey: buildErpRowKey(snapshot.rowCells, snapshot.poNumber),
      isSelected: snapshot.isSelected,
    };
  }

  async ensureErpGridSelection(
    state?: ErpGridState,
    options: {
      preferredRowKey?: string;
      preferFirstVisible?: boolean;
      preferLastVisible?: boolean;
      forceFocus?: boolean;
    } = {},
  ): Promise<ErpGridState> {
    let currentState = state ?? (await this.getErpGridState());
    const candidates = (await this.collectErpRowCandidates()).filter((candidate) => candidate.inViewport);
    if (candidates.length === 0) {
      return currentState;
    }

    if (currentState.selectedItem && !options.forceFocus && !options.preferredRowKey) {
      return currentState;
    }

    let targetIndex = this.resolveErpGridSelectionTargetIndex(candidates, currentState, options);

    if (targetIndex === undefined) {
      targetIndex = candidates[0]!.index;
    }

    const targetCandidate = candidates.find((candidate) => candidate.index === targetIndex) ?? candidates[0]!;
    const targetRow = targetCandidate.row;
    const targetSnapshot = targetCandidate.snapshot;
    if (
      currentState.selectedItem &&
      targetSnapshot?.rowKey === currentState.selectedItem.rowKey &&
      !options.forceFocus
    ) {
      return currentState;
    }

    await targetRow.click({ timeout: APP_TIMEOUTS.medium }).catch(() => undefined);
    currentState = await this.waitForErpGridStabilized();
    return currentState;
  }

  async tryAdvanceErpGridSelection(
    baseline: ErpGridState,
  ): Promise<{ state: ErpGridState; advanced: boolean; selectionAdvanced: boolean }> {
    const preparedBaseline = await this.ensureErpGridSelection(baseline, {
      preferredRowKey: baseline.selectedItem?.rowKey,
      preferLastVisible: true,
      forceFocus: !baseline.selectedItem,
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

  resolveErpGridSelectionTargetIndex(
    candidates: Array<{
      index: number;
      snapshot?: { poNumber: string; rowKey: string; isSelected: boolean };
      inViewport: boolean;
      interactable: boolean;
    }>,
    currentState: ErpGridState,
    options: {
      preferredRowKey?: string;
      preferFirstVisible?: boolean;
      preferLastVisible?: boolean;
      forceFocus?: boolean;
    },
  ): number | undefined {
    const interactableCandidates = candidates.filter((candidate) => candidate.inViewport && candidate.interactable);

    if (options.preferredRowKey) {
      const preferredCandidate = interactableCandidates.find(
        (candidate) => candidate.snapshot?.rowKey === options.preferredRowKey,
      );
      if (preferredCandidate) {
        return preferredCandidate.index;
      }
    }

    if (options.preferLastVisible) {
      return interactableCandidates.at(-1)?.index ?? candidates.at(-1)?.index;
    }

    if (options.preferFirstVisible) {
      return interactableCandidates[0]?.index ?? candidates[0]?.index;
    }

    if (currentState.selectedItem) {
      const selectedCandidate = interactableCandidates.find(
        (candidate) => candidate.snapshot?.rowKey === currentState.selectedItem?.rowKey,
      );
      if (selectedCandidate) {
        return selectedCandidate.index;
      }
    }

    return interactableCandidates[0]?.index ?? candidates[0]?.index;
  }

  async collectErpRowCandidates(): Promise<ErpRowCandidate[]> {
    const rows = this.getErpRowInputs();
    const count = await rows.count();
    if (count === 0) {
      return [];
    }

    const layout = await this.erpPage.evaluate((selector) => {
      return Array.from(document.querySelectorAll(selector)).map((input, index) => {
        const rect = input.getBoundingClientRect();
        const inViewport = rect.bottom > 0 && rect.top < window.innerHeight;
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        const rowGridCell = input.closest('[role="gridcell"]');
        const hitGridCell = hit instanceof HTMLElement ? hit.closest('[role="gridcell"]') : null;
        const interactable =
          hit === input ||
          input.contains(hit) ||
          (rowGridCell !== null && rowGridCell === hitGridCell);

        return { index, inViewport, interactable };
      });
    }, ERP_SELECTORS.rowInputs);

    const candidates: ErpRowCandidate[] = [];
    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index);
      const snapshot = await this.readErpRowSnapshot(row);
      const metadata = layout[index];
      candidates.push({
        index,
        row,
        snapshot,
        inViewport: metadata?.inViewport ?? false,
        interactable: metadata?.interactable ?? false,
      });
    }

    return candidates;
  }

  async isErpRowInteractable(row: Locator): Promise<boolean> {
    return row.evaluate((input) => {
      const rect = input.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return false;
      }

      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (!(hit instanceof Node)) {
        return false;
      }

      const rowGridCell = input.closest('[role="gridcell"]');
      const hitGridCell = hit instanceof HTMLElement ? hit.closest('[role="gridcell"]') : null;
      return hit === input || input.contains(hit) || (rowGridCell !== null && rowGridCell === hitGridCell);
    });
  }

  resolveNearestInteractableErpRow<T extends { index: number; interactable: boolean }>(
    candidates: T[],
    targetIndex: number,
  ): T | undefined {
    const interactableCandidates = candidates.filter((candidate) => candidate.interactable);
    if (interactableCandidates.length === 0) {
      return undefined;
    }

    return interactableCandidates.reduce<T | undefined>((best, candidate) => {
      if (!best) {
        return candidate;
      }

      const bestDistance = Math.abs(best.index - targetIndex);
      const candidateDistance = Math.abs(candidate.index - targetIndex);
      return candidateDistance < bestDistance ? candidate : best;
    }, undefined);
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
    nextState.visibleSignature !== previousState.visibleSignature
  );
}

function areErpGridStatesStable(previousState: ErpGridState, nextState: ErpGridState): boolean {
  return (
    nextState.selectedSignature === previousState.selectedSignature &&
    nextState.visibleSignature === previousState.visibleSignature
  );
}

function isErpGridSelectionOnLastVisible(state: ErpGridState): boolean {
  const lastVisible = state.visibleItems[state.visibleItems.length - 1];
  return Boolean(lastVisible && state.selectedItem && lastVisible.rowKey === state.selectedItem.rowKey);
}
