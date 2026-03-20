import { EventEmitter } from "node:events";
import { parseCliArgs } from "../../../cli";
import { AppController } from "../../../runtime/app-controller";
import type { RuntimeSnapshot } from "../../../types";

export class DesktopRuntimeService extends EventEmitter {
  readonly #controller = new AppController(parseCliArgs(process.argv.slice(1)), []);
  #started = false;
  #initializationComplete = false;

  constructor() {
    super();
    this.#controller.subscribe((snapshot) => {
      this.emit("snapshot", snapshot);
    });
  }

  getSnapshot(): RuntimeSnapshot {
    return this.#controller.snapshot;
  }

  subscribe(listener: (snapshot: RuntimeSnapshot) => void): () => void {
    const wrapped = (snapshot: RuntimeSnapshot) => listener(snapshot);
    this.on("snapshot", wrapped);
    listener(this.#controller.snapshot);
    return () => this.off("snapshot", wrapped);
  }

  start(): void {
    if (this.#started) {
      return;
    }

    this.#started = true;
    void this.run();
  }

  requestStart(): void {
    this.#controller.requestStart();
  }

  async retryFailedItems(): Promise<void> {
    await this.#controller.retryFailedItems();
  }

  async shutdown(): Promise<void> {
    await this.#controller.shutdown();
  }

  async openPath(target: string): Promise<void> {
    const { shell } = await import("electron");
    await shell.openPath(target);
  }

  async run(): Promise<void> {
    try {
      await this.#controller.initialize();
      this.#initializationComplete = true;
      await this.#controller.waitForStartSignal();
      await this.#controller.execute();
    } catch {
      return;
    }
  }

  get initializationComplete(): boolean {
    return this.#initializationComplete;
  }
}
