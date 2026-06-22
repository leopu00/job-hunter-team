export type ScheduleKind = "cron" | "every" | "at";

export interface ScheduleCron {
  kind: "cron";
  expr: string;
  tz?: string;
}
export interface ScheduleEvery {
  kind: "every";
  everyMs: number;
  anchorMs?: number;
}
export interface ScheduleAt {
  kind: "at";
  at: string;
}
export type CronSchedule = ScheduleCron | ScheduleEvery | ScheduleAt;

export interface CronPayload {
  kind: "command";
  command: string;
  timeoutSeconds?: number;
}

export interface CronJobState {
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastRunStatus?: "ok" | "error" | "skipped";
  lastError?: string;
  lastDurationMs?: number;
  consecutiveErrors?: number;
}

export interface CronJob {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: CronSchedule;
  payload: CronPayload;
  state: CronJobState;
}

/** Ritornato dall'API GET /api/cron */
export interface CronListResponse {
  jobs: CronJob[];
}

/** Input per la creazione di un nuovo job */
export interface CronJobCreateInput {
  name: string;
  description?: string;
  enabled: boolean;
  schedule: CronSchedule;
  payload: CronPayload;
  deleteAfterRun?: boolean;
}

/* ── i18n per le label della schedule (usate dalla UI) ───────────── */
type CronLocale = "it" | "en" | "hu" | "es" | "de" | "fr" | "pt";

const LOCALE_TAG: Record<string, string> = {
  it: "it-IT",
  en: "en-US",
  hu: "hu-HU",
  es: "es-ES",
  de: "de-DE",
  fr: "fr-FR",
  pt: "pt-PT",
};

interface CronStrings {
  every: (n: number) => string;
  once: (at: string) => string;
  running: string;
  inSeconds: (n: number) => string;
  inMinutes: (n: number) => string;
}

const CRON_STRINGS: Record<CronLocale, CronStrings> = {
  it: {
    every: (n) => `ogni ${n} min`,
    once: (at) => `una volta: ${at}`,
    running: "in esecuzione",
    inSeconds: (n) => `tra ${n}s`,
    inMinutes: (n) => `tra ${n} min`,
  },
  en: {
    every: (n) => `every ${n} min`,
    once: (at) => `once: ${at}`,
    running: "running",
    inSeconds: (n) => `in ${n}s`,
    inMinutes: (n) => `in ${n} min`,
  },
  hu: {
    every: (n) => `${n} percenként`,
    once: (at) => `egyszer: ${at}`,
    running: "fut",
    inSeconds: (n) => `${n} mp múlva`,
    inMinutes: (n) => `${n} perc múlva`,
  },
  es: {
    every: (n) => `cada ${n} min`,
    once: (at) => `una vez: ${at}`,
    running: "en ejecución",
    inSeconds: (n) => `en ${n}s`,
    inMinutes: (n) => `en ${n} min`,
  },
  de: {
    every: (n) => `alle ${n} Min.`,
    once: (at) => `einmalig: ${at}`,
    running: "läuft",
    inSeconds: (n) => `in ${n}s`,
    inMinutes: (n) => `in ${n} Min.`,
  },
  fr: {
    every: (n) => `toutes les ${n} min`,
    once: (at) => `une fois : ${at}`,
    running: "en cours",
    inSeconds: (n) => `dans ${n}s`,
    inMinutes: (n) => `dans ${n} min`,
  },
  pt: {
    every: (n) => `a cada ${n} min`,
    once: (at) => `uma vez: ${at}`,
    running: "em execução",
    inSeconds: (n) => `em ${n}s`,
    inMinutes: (n) => `em ${n} min`,
  },
};

function cronStrings(locale: string): CronStrings {
  return CRON_STRINGS[
    (locale as CronLocale) in CRON_STRINGS ? (locale as CronLocale) : "en"
  ];
}

/** Formato leggibile della schedule per la UI */
export function scheduleLabel(s: CronSchedule, locale = "it"): string {
  const t = cronStrings(locale);
  if (s.kind === "cron") return `cron: ${s.expr}`;
  if (s.kind === "every") return t.every(Math.round(s.everyMs / 60_000));
  if (s.kind === "at") return t.once(s.at);
  return "?";
}

/** Formato leggibile della prossima esecuzione */
export function nextRunLabel(ms: number | undefined, locale = "it"): string {
  if (!ms) return "—";
  const t = cronStrings(locale);
  const d = new Date(ms);
  const now = Date.now();
  const diff = ms - now;
  if (diff < 0) return t.running;
  if (diff < 60_000) return t.inSeconds(Math.round(diff / 1000));
  if (diff < 3_600_000) return t.inMinutes(Math.round(diff / 60_000));
  return d.toLocaleString(LOCALE_TAG[locale] ?? "en-US", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
