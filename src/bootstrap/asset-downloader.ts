import fs from "node:fs/promises";
import path from "node:path";
import { APP_TIMEOUTS } from "../config";

export async function downloadAsset(url: string, destinationPath: string, token?: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), APP_TIMEOUTS.download);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/octet-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Falha no download do asset. Status HTTP ${response.status}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.writeFile(destinationPath, bytes);
  } finally {
    clearTimeout(timeout);
  }
}
