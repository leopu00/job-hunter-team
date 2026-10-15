import { deflateSync } from "node:zlib";
import type { DesktopReply, DesktopRequest } from "../lib/closer-desktop";

// Actual inert PNG bytes, not a data URL that only resembles an image header.
export function png(width = 1440, height = 1000) {
  const chunk = (kind: string, data: Buffer) => {
    const payload = Buffer.concat([Buffer.from(kind), data]);
    let crc = 0xffffffff;
    for (const byte of payload) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4), tail = Buffer.alloc(4);
    size.writeUInt32BE(data.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, payload, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc(height * (width * 3 + 1)))), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}
export const image = png();
export const binding = { mission_id: "a".repeat(32), position_id: 41, owner_id: "b".repeat(32), generation: 1 as const };
export function descriptor(overrides: Record<string, unknown> = {}): DesktopReply {
  return { ok: true, ...binding, phase: "handoff", review_id: "c".repeat(32), display_id: "d".repeat(32),
    frame_sequence: 0, width: 1440, height: 1000, input_ready: true, stream_available: true,
    allowed_actions: ["frame", "input", "observe", "finish", "abandon"], ...overrides };
}
export function frame(sequence: number): DesktopReply {
  return { ok: true, ...binding, display_id: "d".repeat(32), frame_sequence: sequence,
    width: 1440, height: 1000, png_base64: image };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
export function rig() {
  let now = 1000, sequence = 0;
  let state = descriptor();
  const requests: DesktopRequest[] = [];
  const transport = async (request: DesktopRequest) => {
    requests.push(request);
    if (request.op === "descriptor") return { ...state, frame_sequence: sequence };
    if (request.op === "frame") return frame(++sequence);
    if (request.op === "input") return { ok: true, accepted: true };
    if (request.op === "snapshot") return { ok: true, ...binding, event_id: request.event_id, png_base64: png(1, 1) };
    if (request.op === "delete_snapshot") return { ok: true, deleted: true };
    return { ...state, queued: true };
  };
  return { transport, requests, clock: () => now, advance: (n: number) => { now += n; },
    setState: (next: DesktopReply) => { state = next; } };
}
