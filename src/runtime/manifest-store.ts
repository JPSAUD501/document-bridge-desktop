import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ManifestData, ManifestItem } from "../types";
import { fileExists, nowIso, writeFileAtomic } from "../lib/utils";

const manifestItemSchema = z.object({
  id: z.string(),
  poNumber: z.string(),
  sourceRow: z.number(),
  originalFileName: z.string().optional(),
  savedFileName: z.string().optional(),
  downloadPath: z.string().optional(),
  downloadStatus: z.enum(["pending", "downloading", "downloaded", "download_failed"]),
  uploadStatus: z.enum(["pending", "queued_for_upload", "uploading", "uploaded", "upload_failed"]),
  attempts: z.number(),
  lastError: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const manifestSchema = z.object({
  runId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  items: z.array(manifestItemSchema),
});

export class ManifestStore {
  readonly #manifestPath: string;
  #data: ManifestData;

  constructor(manifestPath: string, runId: string) {
    this.#manifestPath = manifestPath;
    this.#data = {
      runId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      items: [],
    };
  }

  async initialize(): Promise<void> {
    await fs.mkdir(path.dirname(this.#manifestPath), { recursive: true });
    if (await fileExists(this.#manifestPath)) {
      const raw = await fs.readFile(this.#manifestPath, "utf8");
      this.#data = manifestSchema.parse(JSON.parse(raw));
      return;
    }

    await this.persist();
  }

  get manifest(): ManifestData {
    return this.#data;
  }

  get items(): ManifestItem[] {
    return this.#data.items;
  }

  findById(id: string): ManifestItem | undefined {
    return this.#data.items.find((item) => item.id === id);
  }

  ensureItem(partial: Pick<ManifestItem, "id" | "poNumber" | "sourceRow">): ManifestItem {
    const existing = this.findById(partial.id);
    if (existing) {
      return existing;
    }

    const now = nowIso();
    const item: ManifestItem = {
      id: partial.id,
      poNumber: partial.poNumber,
      sourceRow: partial.sourceRow,
      downloadStatus: "pending",
      uploadStatus: "pending",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.#data.items.push(item);
    this.#data.updatedAt = now;
    return item;
  }

  async updateItem(id: string, patch: Partial<ManifestItem>): Promise<ManifestItem> {
    const item = this.findById(id);
    if (!item) {
      throw new Error(`Manifest item not found: ${id}`);
    }

    Object.assign(item, patch, { updatedAt: nowIso() });
    this.#data.updatedAt = nowIso();
    await this.persist();
    return item;
  }

  async persist(): Promise<void> {
    this.#data.updatedAt = nowIso();
    await writeFileAtomic(this.#manifestPath, JSON.stringify(this.#data, null, 2));
  }
}
