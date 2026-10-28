import type { Locale } from "@/i18n/config";
import { PROVIDER_WINDOW_TEXT } from "./provider-window.i18n";
import type { ProviderWindowResult } from "./provider-window-native";

/** From this much used the app says the window is nearly gone; from this much, that it is gone. */
export const WINDOW_NEAR_PCT = 90;
export const WINDOW_DONE_PCT = 99.5;
/** The bridge writes a reading every few minutes; one older than this says nothing about now. */
export const WINDOW_STALE_SECONDS = 20 * 60;

export type WindowNotice = { kind: "near"; pct: number } | { kind: "done"; resetAtUnix: number | null };

/**
 * What to tell the person, if anything. Nothing without a fresh reading with a percent; «done» when the window is
 * used up (with the renewal time when it is known and still ahead, without it when it is unknown); a renewal
 * already past means the reading is out of date, so nothing.
 */
export function windowNotice(result: ProviderWindowResult, nowMs: number): WindowNotice | null {
  if (!result.ok) return null;
  const { usedPct, resetAtUnix, updatedAtUnix } = result.window;
  const now = nowMs / 1000;
  if (usedPct === null || now - updatedAtUnix > WINDOW_STALE_SECONDS) return null;
  if (usedPct >= WINDOW_DONE_PCT) {
    if (resetAtUnix !== null && resetAtUnix <= now) return null;
    return { kind: "done", resetAtUnix };
  }
  if (usedPct >= WINDOW_NEAR_PCT) return { kind: "near", pct: Math.min(99, Math.floor(usedPct)) };
  return null;
}

/** HH:MM in the person's time zone, 24-hour, whatever the language. */
export function localTime(unixSeconds: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(unixSeconds * 1000));
}

export function windowNoticeText(notice: WindowNotice, locale: Locale): string {
  const text = PROVIDER_WINDOW_TEXT[locale];
  if (notice.kind === "near") return text.usageNear.replace("{pct}", String(notice.pct));
  return notice.resetAtUnix === null ? text.usageDoneNoTime : text.usageDone.replace("{time}", localTime(notice.resetAtUnix, locale));
}
