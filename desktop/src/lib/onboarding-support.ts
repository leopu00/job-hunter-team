import { invoke, isTauri } from "@tauri-apps/api/core";
import { redactWithReport } from "../../../web/lib/redact";

/** The public support intake used by the other desktop client too. */
export const SETUP_SUPPORT_ENDPOINT = "https://jobhunterteam.ai/api/feedback";
export const SETUP_SUPPORT_MAILBOX = "support@jobhunterteam.ai";
export const SETUP_SUPPORT_MAILTO_MAX = 1_800;

export type SetupSupportContext = { appVersion: string; logTail: string };

export type SetupSupportReport = {
  preview: string;
  payload: Record<string, string>;
  redactions: Record<string, number>;
};

function safeCode(value: unknown): string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : "unknown";
}

function safeText(value: unknown, limit: number): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, limit)
    : "";
}

function safeVersion(value: unknown): string {
  const version = safeText(value, 40);
  return /^(?:dev|v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/.test(version) ? version : "unknown";
}

function safeLocale(value: unknown): string {
  const locale = safeText(value, 10);
  return /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(locale) ? locale : "en";
}

/** The UA is only used for its OS release; it is redacted before it can leave the app. */
export function operatingSystem(userAgent = navigator.userAgent): string {
  const windows = /Windows NT ([0-9.]+)/.exec(userAgent);
  if (windows) return `Windows ${windows[1]}`;
  const mac = /Mac OS X ([0-9_]+)/.exec(userAgent);
  if (mac) return `macOS ${mac[1].replace(/_/g, ".")}`;
  const linux = /Linux/.test(userAgent);
  return linux ? "Linux (version unavailable)" : "Operating system unavailable";
}

/**
 * Creates exactly the text that is previewed and sent. The shared web redactor
 * is deliberately applied here as the last renderer-side boundary: native
 * diagnostics never reach preview, POST or mailto without it.
 */
export function createSetupSupportReport(input: {
  stage: unknown;
  code: unknown;
  appVersion: unknown;
  platform: unknown;
  locale: unknown;
  logTail: unknown;
}): SetupSupportReport {
  const stage = safeCode(input.stage);
  const code = safeCode(input.code);
  const appVersion = safeVersion(input.appVersion);
  const platform = safeText(input.platform, 120) || "Operating system unavailable";
  const locale = safeLocale(input.locale);
  const rawDiagnostics = [
    `Setup step: ${stage}`,
    `Error code: ${code}`,
    `Operating system: ${platform}`,
    `App version: ${appVersion}`,
    "Last runtime-log lines:",
    safeText(input.logTail, 16_000) || "(no runtime log was available)",
  ].join("\n");
  const cleaned = redactWithReport(rawDiagnostics);
  const happened = `Desktop setup stopped at ${stage} (${code}).`;
  const payload = {
    client: "tauri-desktop",
    app_version: appVersion,
    locale,
    platform: redactWithReport(platform).text,
    doing: `Desktop setup: ${stage}`,
    happened,
    expected: "The desktop setup should complete.",
    diagnostics: cleaned.text,
  };
  const preview = [
    "# Job Hunter Team desktop setup report",
    "",
    `- Step: ${stage}`,
    `- Code: ${code}`,
    `- OS: ${payload.platform}`,
    `- App version: ${appVersion}`,
    "",
    "## Last runtime-log lines",
    "",
    cleaned.text,
  ].join("\n");
  // Redact a second time after the report frame was produced: future changes
  // to a field above cannot bypass the same outgoing boundary.
  const final = redactWithReport(preview);
  return { preview: final.text, payload: { ...payload, diagnostics: final.text }, redactions: mergeCounts(cleaned.counts, final.counts) };
}

function mergeCounts(...all: Record<string, number>[]): Record<string, number> {
  return all.reduce<Record<string, number>>((out, counts) => {
    for (const [key, value] of Object.entries(counts)) out[key] = (out[key] ?? 0) + value;
    return out;
  }, {});
}

export function mailtoForSetupSupport(report: SetupSupportReport): string | null {
  const params = new URLSearchParams({
    subject: "Job Hunter Team desktop setup report",
    body: report.preview,
  });
  const value = `mailto:${SETUP_SUPPORT_MAILBOX}?${params}`;
  return value.length <= SETUP_SUPPORT_MAILTO_MAX ? value : null;
}

export async function readSetupSupportContext(): Promise<SetupSupportContext> {
  if (!isTauri()) return { appVersion: "0.4.0", logTail: "" };
  const value = await invoke<unknown>("onboarding_support_context");
  if (!value || typeof value !== "object") return { appVersion: "unknown", logTail: "" };
  const raw = value as { appVersion?: unknown; logTail?: unknown };
  return { appVersion: safeText(raw.appVersion, 40) || "unknown", logTail: typeof raw.logTail === "string" ? raw.logTail : "" };
}

async function saveLongReport(markdown: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const logicalPath = await invoke<unknown>("onboarding_support_report_save", { draft: { markdown } });
    return typeof logicalPath === "string" && logicalPath.trim() ? logicalPath : null;
  } catch {
    return null;
  }
}

export type SupportDelivery =
  | { kind: "sent"; ticket: string }
  | { kind: "mailto"; href: string; savedReport: string | null }
  | { kind: "failed" };

/** POST first; only an unavailable endpoint opens the user's mail app. */
export async function deliverSetupSupportReport(report: SetupSupportReport): Promise<SupportDelivery> {
  try {
    const response = await fetch(SETUP_SUPPORT_ENDPOINT, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report.payload),
    });
    const data = await response.json().catch(() => null) as { ticket?: unknown } | null;
    if (response.ok && typeof data?.ticket === "string" && data.ticket) return { kind: "sent", ticket: data.ticket };
  } catch { /* mail fallback below */ }

  const direct = mailtoForSetupSupport(report);
  if (direct) return { kind: "mailto", href: direct, savedReport: null };
  const savedReport = await saveLongReport(report.preview);
  // The mail client gets a compact, redacted summary. The complete redacted
  // report remains in the private attachment folder instead of overflowing a
  // mailto URL.
  const summary = report.preview.split("\n## Last runtime-log lines", 1)[0].trim();
  const fallback = `mailto:${SETUP_SUPPORT_MAILBOX}?${new URLSearchParams({
    subject: "Job Hunter Team desktop setup report",
    body: `${summary}\n\n${savedReport
      ? `The complete redacted report is ready to attach from: ${savedReport}`
      : "The complete report could not be saved automatically. Please retry the support report."}`,
  })}`;
  return { kind: "mailto", href: fallback, savedReport };
}
