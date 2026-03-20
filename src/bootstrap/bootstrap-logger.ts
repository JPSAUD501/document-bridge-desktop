import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { APP_NAME } from "../app-version";

export class BootstrapLogger {
  readonly #logPath: string;

  constructor() {
    const localAppData =
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
    this.#logPath = path.join(localAppData, APP_NAME, "logs", "updater.log");
  }

  get logPath(): string {
    return this.#logPath;
  }

  async log(message: string): Promise<void> {
    await fs.mkdir(path.dirname(this.#logPath), { recursive: true });
    await fs.appendFile(this.#logPath, `${new Date().toISOString()} ${message}\n`, "utf8");
  }
}
