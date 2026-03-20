import fs from "node:fs/promises";
import path from "node:path";
import type { LogEntry, LogLevel } from "../types";

export class RunLogger {
  readonly #logPath: string;
  readonly #listeners = new Set<(entry: LogEntry) => void>();

  constructor(logPath: string) {
    this.#logPath = logPath;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(path.dirname(this.#logPath), { recursive: true });
    await fs.appendFile(this.#logPath, "");
  }

  onEntry(listener: (entry: LogEntry) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async info(stage: string, message: string, details?: LogEntry["details"]): Promise<void> {
    await this.log("INFO", stage, message, details);
  }

  async warn(stage: string, message: string, details?: LogEntry["details"]): Promise<void> {
    await this.log("WARN", stage, message, details);
  }

  async error(stage: string, message: string, details?: LogEntry["details"]): Promise<void> {
    await this.log("ERROR", stage, message, details);
  }

  async log(
    level: LogLevel,
    stage: string,
    message: string,
    details?: LogEntry["details"],
  ): Promise<void> {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      stage,
      message,
      details,
    };

    const suffix = details ? ` ${JSON.stringify(details)}` : "";
    const line = `${entry.timestamp} [${entry.level}] [${entry.stage}] ${entry.message}${suffix}\n`;
    await fs.appendFile(this.#logPath, line, "utf8");

    for (const listener of this.#listeners) {
      listener(entry);
    }
  }
}
