import { invoke } from "@tauri-apps/api/core";

/**
 * How much of the AI provider's work window the team has used and when it renews, read through the native
 * `provider_window_read` command (the team of this computer, or the one the chat is connected to). It is what the
 * team's bridge already records: the percent of the window used, the instant it renews, the provider's short name
 * and when the bridge last wrote it. A reply off the closed shape is `window_unavailable`, never a made-up number.
 */
export interface ProviderWindow {
  provider: string | null;
  /** Percent of the window used (0 to 100, a little over when the provider lets it); `null` when the bridge has no reading. */
  usedPct: number | null;
  /** Unix seconds the window renews; `null` when unknown. */
  resetAtUnix: number | null;
  /** Unix seconds the bridge wrote this reading. */
  updatedAtUnix: number;
}

export type ProviderWindowResult = { ok: true; window: ProviderWindow } | { ok: false; error: "window_unavailable" };

const KEYS = ["ok", "provider", "resetAtUnix", "updatedAtUnix", "usedPct"];
const PROVIDER = /^[a-z0-9_-]{1,32}$/;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const instant = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 1e9 && value < 4.1e9;

/** The reply of `provider_window_read` as the page uses it. */
export function pickProviderWindow(reply: unknown): ProviderWindowResult {
  const unavailable: ProviderWindowResult = { ok: false, error: "window_unavailable" };
  if (!isRecord(reply) || reply.ok !== true) return unavailable;
  if (Object.keys(reply).sort().join() !== KEYS.join()) return unavailable;
  const { provider, usedPct, resetAtUnix, updatedAtUnix } = reply;
  if (provider !== null && !(typeof provider === "string" && PROVIDER.test(provider))) return unavailable;
  if (usedPct !== null && !(typeof usedPct === "number" && Number.isFinite(usedPct) && usedPct >= 0 && usedPct <= 1000)) return unavailable;
  if (resetAtUnix !== null && !instant(resetAtUnix)) return unavailable;
  if (!instant(updatedAtUnix)) return unavailable;
  return { ok: true, window: { provider, usedPct, resetAtUnix, updatedAtUnix } };
}

type Call = (command: string) => Promise<unknown>;
const nativeCall: Call = (command) => invoke<unknown>(command);

export async function readProviderWindow(call: Call = nativeCall): Promise<ProviderWindowResult> {
  try {
    return pickProviderWindow(await call("provider_window_read"));
  } catch {
    return { ok: false, error: "window_unavailable" };
  }
}
