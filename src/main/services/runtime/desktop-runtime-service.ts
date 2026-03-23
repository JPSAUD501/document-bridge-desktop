import { EventEmitter } from "node:events";
import { parseCliArgs } from "../../../cli";
import { AppController } from "../../../runtime/app-controller";
import type { RuntimeSnapshot } from "../../../types";

export class DesktopRuntimeService extends EventEmitter {
  #controller?: AppController;
  #started = false;
  #initializationComplete = false;

  constructor() {
    super();
  }

  #getController(): AppController {
    if (!this.#controller) {
      this.#controller = new AppController(parseCliArgs(process.argv.slice(1)), []);
      this.#controller.subscribe((snapshot) => {
        this.emit("snapshot", snapshot);
      });
    }
    return this.#controller;
  }

  getSnapshot(): RuntimeSnapshot {
    return this.#getController().snapshot;
  }

  subscribe(listener: (snapshot: RuntimeSnapshot) => void): () => void {
    const controller = this.#getController();
    const wrapped = (snapshot: RuntimeSnapshot) => listener(snapshot);
    this.on("snapshot", wrapped);
    listener(controller.snapshot);
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
    this.#getController().requestStart();
  }

  async retryFailedItems(): Promise<void> {
    await this.#getController().retryFailedItems();
  }

  async shutdown(): Promise<void> {
    await this.#getController().shutdown();
  }

  async openPath(target: string): Promise<void> {
    const { shell } = await import("electron");
    await shell.openPath(target);
  }

  async run(): Promise<void> {
    try {
      const controller = this.#getController();
      await controller.initialize();
      this.#initializationComplete = true;
      await controller.waitForStartSignal();
      await controller.execute();
    } catch {
      return;
    }
  }

  get initializationComplete(): boolean {
    return this.#initializationComplete;
  }
}
