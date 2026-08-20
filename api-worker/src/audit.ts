import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import { AuditEventSchema, type AuditEvent } from "./contract.js";

export interface AuditSink {
  write(event: AuditEvent): Promise<void>;
}

export class JsonlAuditSink implements AuditSink {
  constructor(private readonly path: string) {}

  async write(event: AuditEvent): Promise<void> {
    const sanitized = AuditEventSchema.parse(event);
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await appendFile(this.path, `${JSON.stringify(sanitized)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }
}

export class MemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];

  async write(event: AuditEvent): Promise<void> {
    this.events.push(AuditEventSchema.parse(event));
  }
}

export async function readAuditJsonl(path: string): Promise<AuditEvent[]> {
  const content = await readFile(path, "utf8");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => AuditEventSchema.parse(JSON.parse(line)));
}
