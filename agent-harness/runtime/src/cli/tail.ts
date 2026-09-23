/**
 * Reading a trace while it is written: what was appended since the last read,
 * a line cut in half kept for the next one. Shared by the monitor's follow and
 * its dashboard, which both tail files an agent is still appending to.
 */

import { closeSync, openSync, readSync, statSync } from "node:fs";

import type { TraceLine } from "../core/trace.ts";

/** Reads what has been appended to a file since the last call, line by line. */
export class Tail {
  readonly file: string;
  #offset = 0;
  #partial = "";
  constructor(file: string) {
    this.file = file;
  }

  read(): TraceLine[] {
    const size = statSync(this.file).size;
    if (size <= this.#offset) return [];
    const fd = openSync(this.file, "r");
    try {
      const buffer = Buffer.alloc(size - this.#offset);
      readSync(fd, buffer, 0, buffer.length, this.#offset);
      this.#offset = size;
      const text = this.#partial + buffer.toString("utf8");
      const lines = text.split("\n");
      this.#partial = lines.pop() ?? "";
      return lines.filter(Boolean).flatMap((line) => {
        try {
          return [JSON.parse(line) as TraceLine];
        } catch {
          return [];
        }
      });
    } finally {
      closeSync(fd);
    }
  }
}
