import { open, mkdir, unlink, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";

import { WorkerFault } from "./errors.js";

export class ExclusiveRunLock {
  private handle?: FileHandle;

  constructor(private readonly path: string) {}

  async acquire(runId: string): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    try {
      this.handle = await open(this.path, "wx", 0o600);
      await this.handle.writeFile(
        JSON.stringify({ runId, acquiredAt: new Date().toISOString() }),
        "utf8",
      );
    } catch (error) {
      if (isAlreadyExists(error)) {
        throw new WorkerFault("CONCURRENT_RUN", {
          retryable: true,
          limit: "concurrency",
          cause: error,
        });
      }
      throw error;
    }
  }

  async release(): Promise<void> {
    if (!this.handle) return;
    await this.handle.close();
    this.handle = undefined;
    try {
      await unlink(this.path);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
