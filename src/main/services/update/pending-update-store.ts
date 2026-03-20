import fs from "node:fs/promises";
import path from "node:path";

interface PendingUpdatePayload {
  version: string;
  downloadedAt: string;
}

export class PendingUpdateStore {
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async read(): Promise<PendingUpdatePayload | null> {
    try {
      const raw = await fs.readFile(this.#filePath, "utf8");
      const parsed = JSON.parse(raw) as PendingUpdatePayload;
      if (!parsed.version) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async write(version: string): Promise<void> {
    await fs.mkdir(path.dirname(this.#filePath), { recursive: true });
    await fs.writeFile(
      this.#filePath,
      JSON.stringify(
        {
          version,
          downloadedAt: new Date().toISOString(),
        } satisfies PendingUpdatePayload,
        null,
        2,
      ),
      "utf8",
    );
  }

  async clear(): Promise<void> {
    await fs.rm(this.#filePath, { force: true }).catch(() => undefined);
  }
}
