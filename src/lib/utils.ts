import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { ManifestItem, StatusCounts } from "../types";

export interface ErpRowKeyPart {
  field?: string;
  value?: string;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function formatRunId(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = `${date.getMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getDate()}`.padStart(2, "0");
  const hh = `${date.getHours()}`.padStart(2, "0");
  const mi = `${date.getMinutes()}`.padStart(2, "0");
  const ss = `${date.getSeconds()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}-erp-midas-run-${hh}${mi}${ss}`;
}

export function sanitizeFileName(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

export function ensureExtension(fileName: string, extension: string): string {
  return fileName.toLowerCase().endsWith(extension.toLowerCase())
    ? fileName
    : `${fileName}${extension}`;
}

export function normalizePdfFileName(fileName?: string, fallback = "document.pdf"): string {
  const trimmed = fileName?.trim();
  return ensureExtension(trimmed || fallback, ".pdf");
}

export function buildSavedPdfName(index: number, poNumber: string, originalName: string): string {
  const normalizedOriginalName = normalizePdfFileName(originalName);
  const baseOriginal = sanitizeFileName(
    path.basename(normalizedOriginalName, path.extname(normalizedOriginalName)) || "document",
  );
  const po = sanitizeFileName(poNumber) || "unknown-po";
  const prefix = `${index}`.padStart(4, "0");
  return ensureExtension(`${prefix}-${po}-${baseOriginal}`, ".pdf");
}

export function buildManifestItemId(poNumber: string, rowKey?: string): string {
  const po = sanitizeFileName(poNumber) || "unknown-po";
  const stableKey = (rowKey?.trim() || poNumber).normalize("NFKC");
  const digest = createHash("sha1").update(stableKey).digest("hex").slice(0, 12);
  return `${po}-${digest}`;
}

export function normalizeErpRowFieldKey(rawField?: string): string {
  const normalized = (rawField ?? "")
    .trim()
    .replace(/_input$/i, "")
    .replace(/_\d+_\d+_\d+$/i, "");
  return normalized || "field";
}

export function buildErpRowKey(parts: ErpRowKeyPart[], poNumber: string): string {
  const normalizedParts = parts
    .map((part) => ({
      field: normalizeErpRowFieldKey(part.field),
      value: (part.value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim(),
    }))
    .filter((part) => Boolean(part.value));

  if (normalizedParts.length === 0) {
    return poNumber.normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  return normalizedParts.map((part) => `${part.field}=${part.value}`).join("|");
}

export async function ensureDir(target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true });
}

export async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function writeFileAtomic(target: string, content: string | Uint8Array): Promise<void> {
  await ensureDir(path.dirname(target));
  const tempPath = `${target}.${randomUUID()}.tmp`;
  await fs.writeFile(tempPath, content);
  await fs.rm(target, { force: true }).catch(() => undefined);
  await fs.rename(tempPath, target);
}

export function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export function buildCounts(items: ManifestItem[]): StatusCounts {
  const counts: StatusCounts = {
    total: items.length,
    pending: 0,
    downloading: 0,
    downloaded: 0,
    downloadFailed: 0,
    queuedForUpload: 0,
    uploading: 0,
    uploaded: 0,
    uploadFailed: 0,
  };

  for (const item of items) {
    switch (item.downloadStatus) {
      case "pending":
        counts.pending += 1;
        break;
      case "downloading":
        counts.downloading += 1;
        break;
      case "downloaded":
        counts.downloaded += 1;
        break;
      case "download_failed":
        counts.downloadFailed += 1;
        break;
    }

    switch (item.uploadStatus) {
      case "queued_for_upload":
        counts.queuedForUpload += 1;
        break;
      case "uploading":
        counts.uploading += 1;
        break;
      case "uploaded":
        counts.uploaded += 1;
        break;
      case "upload_failed":
        counts.uploadFailed += 1;
        break;
    }
  }

  return counts;
}

export async function findWorkspaceRoot(startDir = process.cwd()): Promise<string> {
  let current = path.resolve(startDir);

  while (true) {
    const agentsPath = path.join(current, "AGENTS.md");
    const outputPath = path.join(current, "output");

    if ((await fileExists(agentsPath)) && (await fileExists(outputPath))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir);
    }

    current = parent;
  }
}

export function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
