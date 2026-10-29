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
  /** The mail subject of the fallback; the setup report's own when absent. */
  subject?: string;
};

const SETUP_SUPPORT_SUBJECT = "Job Hunter Team desktop setup report";

function safeCode(value: unknown): string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : "unknown";
}

/** Zero-width, bidi-control, soft-hyphen and byte-order-mark characters: they hide text from the person reading the
 *  preview and split a secret so a redaction rule misses it. */
const INVISIBLE = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0]/g;

function safeText(value: unknown, limit: number): string {
  return typeof value === "string"
    ? value.replace(INVISIBLE, "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, limit)
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

// The shared rules cover credentials, IPs and user-home paths. Setup logs can
// also label a machine or account directly, so keep those identifiers out of
// every support rendering as well.
/** What every rule writes in place of what it took out. */
const PLACEHOLDER = /\[(?:user|secret|ip|host|id|email|phone|hash|jwt|iban|fiscal-code|private-key|aws-access-key|slack-token|gemini-key|telegram-token|github-token|provider-key|credentials)\]/g;
const MASK_OPEN = "\ue000";
const MASK_CLOSE = "\ue001";
// Private, loopback and link-local addresses: not secrets of the world, but they name the person's own network.
const PRIVATE_IP = /\b(?:10\.\d{1,3}|127\.\d{1,3}|169\.254|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g;

/**
 * The shared rules, plus what the setup logs add (host and account labels, private addresses). Idempotent: what an
 * earlier pass wrote ([user], [secret], ...) is set aside while the rules run and put back, so redacting a redacted
 * text gives the same text and never a doubled bracket.
 */
export function redactSetupSupportText(text: string) {
  const kept: string[] = [];
  const masked = text.replace(PLACEHOLDER, (found) => `${MASK_OPEN}${kept.push(found) - 1}${MASK_CLOSE}`);
  const shared = redactWithReport(masked);
  const counts = { ...shared.counts };
  const bump = (key: string, found: RegExpMatchArray | null) => { if (found) counts[key] = (counts[key] ?? 0) + found.length; };
  // `[ \t]*` and not `\s*`: a label at the end of a line must not take the next line's heading as its value
  const labelled = shared.text
    .replace(/\b(host|hostname|server|address)[ \t]*[:=][ \t]*[^\s,;]+/gi, (_, key: string) => { bump("host_label", [key]); return `${key}: ${MASK_OPEN}${kept.push("[host]") - 1}${MASK_CLOSE}`; })
    .replace(/\b(?:user[_-]?id|account[_-]?id|team[_-]?id|profile[_-]?id|client[_-]?id|id)[ \t]*[:=][ \t]*[^\s,;]+/gi, () => { bump("id_label", ["id"]); return `id: ${MASK_OPEN}${kept.push("[id]") - 1}${MASK_CLOSE}`; });
  bump("private_ip", labelled.match(PRIVATE_IP));
  const out = labelled
    .replace(PRIVATE_IP, () => `${MASK_OPEN}${kept.push("[ip]") - 1}${MASK_CLOSE}`)
    .replace(new RegExp(`${MASK_OPEN}(\\d+)${MASK_CLOSE}`, "g"), (_, index: string) => kept[Number(index)] ?? "");
  return { text: out, counts };
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
  const locale = safeLocale(input.locale);
  const happened = `Desktop setup stopped at ${stage} (${code}).`;
  const rawLog = safeText(input.logTail, 16_000) || "(no runtime log was available)";
  const rawPlatform = safeText(input.platform, 120) || "Operating system unavailable";
  // One pass over the whole frame: the text previewed is the text sent, and nothing is redacted twice.
  const final = redactSetupSupportText([
    "# Job Hunter Team desktop setup report",
    "",
    `- Step: ${stage}`,
    `- Code: ${code}`,
    `- OS: ${rawPlatform}`,
    `- App version: ${appVersion}`,
    "",
    "## Last runtime-log lines",
    "",
    rawLog,
  ].join("\n"));
  const platform = redactSetupSupportText(rawPlatform).text;
  return {
    preview: final.text,
    payload: {
      client: "tauri-desktop",
      app_version: appVersion,
      locale,
      platform,
      doing: `Desktop setup: ${stage}`,
      happened,
      expected: "The desktop setup should complete.",
      diagnostics: final.text,
    },
    redactions: final.counts,
  };
}

/** What the person chooses among when they report a problem from Help or Settings. */
export const PROBLEM_CATEGORIES = ["install", "team", "account", "other"] as const;
export type ProblemCategory = (typeof PROBLEM_CATEGORIES)[number];
export const PROBLEM_MIN_CHARS = 5;
export const PROBLEM_MAX_CHARS = 2_000;

/** The intake's own `kind` values: an installation or an account question is a support request, a team that misbehaves a bug. */
const PROBLEM_KIND: Record<ProblemCategory, string> = { install: "supporto", team: "bug", account: "supporto", other: "altro" };

function safeCategory(value: unknown): ProblemCategory {
  return (PROBLEM_CATEGORIES as readonly unknown[]).includes(value) ? (value as ProblemCategory) : "other";
}

/** Multi-line free text: line breaks stay; control, zero-width and bidi characters do not; blank runs shrink. */
function safeStory(value: unknown, limit: number): string {
  return typeof value === "string"
    ? value.replace(INVISIBLE, "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, limit)
    : "";
}

const STORY_HEADING = "## What happened";
const LOG_HEADING = "## Last runtime-log lines";

/**
 * A report the person writes themselves, from Help or Settings. One redaction pass over the whole frame, so the
 * text previewed is the text sent: `diagnostics` is the preview and `happened` is its «What happened» section,
 * cut out of the REDACTED text (never redacted separately). Nothing leaves before the person confirms.
 */
export function createProblemReport(input: {
  category: unknown;
  description: unknown;
  appVersion: unknown;
  platform: unknown;
  locale: unknown;
  logTail: unknown;
}): SetupSupportReport {
  const category = safeCategory(input.category);
  const appVersion = safeVersion(input.appVersion);
  const rawPlatform = safeText(input.platform, 120) || "Operating system unavailable";
  const locale = safeLocale(input.locale);
  const description = safeStory(input.description, PROBLEM_MAX_CHARS);
  const log = safeText(input.logTail, 16_000) || "(no runtime log was available)";
  const final = redactSetupSupportText([
    "# Job Hunter Team desktop problem report",
    "",
    `- Category: ${category}`,
    `- OS: ${rawPlatform}`,
    `- App version: ${appVersion}`,
    "",
    STORY_HEADING,
    "",
    description || "(nothing written)",
    "",
    LOG_HEADING,
    "",
    log,
  ].join("\n"));
  const from = final.text.indexOf(STORY_HEADING);
  const to = final.text.indexOf(`\n${LOG_HEADING}`);
  const happened = from >= 0 && to > from ? final.text.slice(from + STORY_HEADING.length, to).trim() : "";
  return {
    preview: final.text,
    subject: `Job Hunter Team desktop problem report (${category})`,
    payload: {
      client: "tauri-desktop",
      app_version: appVersion,
      locale,
      platform: redactSetupSupportText(rawPlatform).text,
      kind: PROBLEM_KIND[category],
      subject: `Desktop problem: ${category}`,
      doing: `Desktop app, problem report: ${category}`,
      happened: happened === "(nothing written)" ? "" : happened,
      expected: "",
      diagnostics: final.text,
    },
    redactions: final.counts,
  };
}

export function mailtoForSetupSupport(report: SetupSupportReport): string | null {
  const params = new URLSearchParams({
    subject: report.subject ?? SETUP_SUPPORT_SUBJECT,
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
    subject: report.subject ?? SETUP_SUPPORT_SUBJECT,
    body: `${summary}\n\n${savedReport
      ? `The complete redacted report is ready to attach from: ${savedReport}`
      : "The complete report could not be saved automatically. Please retry the support report."}`,
  })}`;
  return { kind: "mailto", href: fallback, savedReport };
}
