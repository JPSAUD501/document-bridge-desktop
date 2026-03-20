import fs from "node:fs/promises";
import { createHash } from "node:crypto";

export async function calculateSha256(filePath: string): Promise<string> {
  const file = await fs.readFile(filePath);
  return createHash("sha256").update(file).digest("hex");
}

export function parseSha256Sums(content: string): Map<string, string> {
  const sums = new Map<string, string>();

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const [hash, fileName] = trimmed.split(/\s+/, 2);
    if (hash && fileName) {
      sums.set(fileName.replace(/^\*+/, ""), hash.toLowerCase());
    }
  }

  return sums;
}

export async function validateFileChecksum(
  filePath: string,
  expectedHash: string,
): Promise<boolean> {
  const actualHash = await calculateSha256(filePath);
  return actualHash.toLowerCase() === expectedHash.toLowerCase();
}
