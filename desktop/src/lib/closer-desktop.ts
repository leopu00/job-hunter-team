import { invoke } from "@tauri-apps/api/core";

export interface MissionBinding {
  mission_id: string;
  position_id: number;
  owner_id: string;
  generation: 1;
}
export interface DisplayBinding extends MissionBinding {
  display_id: string;
  frame_sequence: number;
}
export type Control = "confirm" | "handoff" | "observe" | "finish" | "abandon";
export type InputEvent =
  | { kind: "pointer"; x: number; y: number; button: number; pressed: boolean }
  | { kind: "key"; key: string; pressed: boolean };
export type DesktopRequest =
  | { op: "descriptor" }
  | (MissionBinding & { op: "confirm" | "handoff"; review_id: string | null })
  | (MissionBinding & { op: "observe" | "finish" | "abandon" })
  | (MissionBinding & { op: "snapshot" | "delete_snapshot"; event_id: string })
  | (DisplayBinding & { op: "frame" })
  | (DisplayBinding & { op: "input" } & InputEvent);

export type DesktopReply = Record<string, unknown> & { ok: boolean };
export type DesktopTransport = (request: DesktopRequest) => Promise<DesktopReply>;

/** Only the native bridge resolves the account, host and exact runtime pins. */
export const closerDesktopRequest: DesktopTransport = async (request) => {
  try {
    const reply: unknown = await invoke("closer_desktop_request", { request });
    if (!reply || typeof reply !== "object" || Array.isArray(reply) ||
        typeof (reply as DesktopReply).ok !== "boolean") {
      return { ok: false, error: "desktop_bad_reply" };
    }
    return reply as DesktopReply;
  } catch {
    // Native exceptions may contain transport details. Never put them in the UI/log.
    return { ok: false, error: "desktop_transport_unavailable" };
  }
};

export const isId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
export const isSequence = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
type BindingFields = { mission_id?: unknown; position_id?: unknown; owner_id?: unknown; generation?: unknown };
export function mission(value: BindingFields | Record<string, unknown>): MissionBinding | null {
  return isId(value.mission_id) && isId(value.owner_id) && value.generation === 1 &&
    isSequence(value.position_id) && value.position_id > 0
    ? { mission_id: value.mission_id, position_id: value.position_id,
        owner_id: value.owner_id, generation: 1 } : null;
}
export function sameMission(a: MissionBinding, b: BindingFields | Record<string, unknown>): boolean {
  return a.mission_id === b.mission_id && a.position_id === b.position_id &&
    a.owner_id === b.owner_id && a.generation === b.generation;
}
export function errorCode(reply: DesktopReply): string {
  return typeof reply.error === "string" && /^[a-z0-9_]{1,80}$/.test(reply.error)
    ? reply.error : "desktop_request_denied";
}

/** Bound decoding before an image allocation; image decode failure is handled separately. */
export function pngUrl(value: unknown, width?: number, height?: number): string | null {
  if (typeof value !== "string" || value.length > Math.ceil(8 * 1024 * 1024 / 3) * 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const raw = atob(value);
    if (raw.length > 8 * 1024 * 1024 || raw.length < 33 ||
        raw.slice(0, 8) !== "\x89PNG\r\n\x1a\n" || raw.slice(12, 16) !== "IHDR") return null;
    const bytes = Uint8Array.from(raw.slice(16, 24), (c) => c.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const w = view.getUint32(0), h = view.getUint32(4);
    if (w < 1 || h < 1 || w > 4096 || h > 4096 ||
        (width !== undefined && w !== width) || (height !== undefined && h !== height)) return null;
    return `data:image/png;base64,${value}`;
  } catch { return null; }
}

const keys = new Set(["BackSpace", "Tab", "Return", "Escape", "Delete", "Home", "End",
  "Page_Up", "Page_Down", "Left", "Right", "Up", "Down", "Shift_L", "Control_L", "Alt_L"]);
const browserKeys: Record<string, string> = { Backspace: "BackSpace", Enter: "Return",
  PageUp: "Page_Up", PageDown: "Page_Down", ArrowLeft: "Left", ArrowRight: "Right",
  ArrowUp: "Up", ArrowDown: "Down", Shift: "Shift_L", Control: "Control_L", Alt: "Alt_L" };
export function desktopKey(key: string): string | null {
  const mapped = browserKeys[key] ?? key;
  return keys.has(mapped) || (Array.from(mapped).length === 1 && !/[\p{C}]/u.test(mapped)) ? mapped : null;
}
