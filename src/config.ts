export const ERP_URL =
  process.env.ERP_URL ??
  "https://erp.example.com/?cmp=sample&mi=DocumentWorkspace";

export const MIDAS_URL =
  process.env.MIDAS_URL ??
  "https://destination.example.com/internal/upload-document/new";

export function validateAutomationTargets(): void {
  const errors = [
    validateTargetUrl("ERP_URL", ERP_URL),
    validateTargetUrl("MIDAS_URL", MIDAS_URL),
  ].filter((value): value is string => Boolean(value));

  if (errors.length > 0) {
    throw new Error(errors.join(" "));
  }
}

export const APP_TIMEOUTS = {
  short: 1_500,
  medium: 5_000,
  long: 15_000,
  orderOpen: 30_000,
  download: 45_000,
  upload: 20_000,
  keyboardSettle: 350,
  gridSettle: 500,
  excelRetryBase: 400,
};

export const ERP_SELECTORS = {
  rowInputs: 'input[id^="VendInvoiceProdReceiptNotInvoicedView_ComputedPurchIdString_"]',
  attachmentsButton: 'button[id*="SystemDefinedAttachButton"]',
  openAttachmentButton:
    'button[id^="DocuView_"][id$="_Open"][data-dyn-controlname="Open"]:has(.Go-symbol)',
  closeAttachmentButton: 'button[id*="DocuView_"][id$="SystemDefinedCloseButton"]',
  closePurchaseButton: 'button[id*="PurchTable_"][id$="SystemDefinedCloseButton"]',
};

export const MIDAS_SELECTORS = {
  fileInput: "div.col-4 input[type='file']",
  uploadButton: "button",
  alertContainers:
    "[role='alert'], .mat-mdc-snack-bar-container, .mat-snack-bar-container, simple-snack-bar, .toast, .toast-message",
};

function validateTargetUrl(envName: "ERP_URL" | "MIDAS_URL", rawUrl: string): string | undefined {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    return `${envName} nao e uma URL valida: ${rawUrl}`;
  }

  if (parsed.hostname.endsWith(".example.com") || parsed.hostname === "example.com") {
    return `${envName} ainda aponta para o placeholder ${rawUrl}. Configure a variavel de ambiente com o endereco real antes de iniciar o app.`;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return `${envName} deve usar http ou https: ${rawUrl}`;
  }

  return undefined;
}
