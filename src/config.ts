export const ERP_URL =
  process.env.ERP_URL ??
  "https://erp.example.com/?cmp=sample&mi=DocumentWorkspace";

export const MIDAS_URL =
  process.env.MIDAS_URL ??
  "https://destination.example.com/internal/upload-document/new";

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
