/**
 * Forma e accesso allo store dei job cron (`~/.jht/cron/jobs.json`), il
 * file che il web condivide con il CLI (`jht cron`) e il pacing-bridge.
 *
 * Prima di questo modulo `CronJob` era definito tre volte con tre livelli
 * di precisione diversi: completo nella UI (`(protected)/cron/types.ts`),
 * con `schedule`/`payload` degradati a `Record<string, unknown>` in
 * `api/cron/route.ts`, e del tutto assente in `api/cron/[id]/route.ts`,
 * dove i job erano `Array<Record<string, unknown>>`. Le due route
 * portavano anche una copia identica di `readStore`/`writeStore`.
 * Qui la definizione è una sola, nella versione precisa.
 */
import fs from "node:fs";
import path from "node:path";
import { JHT_HOME } from "@/lib/jht-paths";

export const CRON_DIR = path.join(JHT_HOME, "cron");
export const CRON_STORE = path.join(CRON_DIR, "jobs.json");

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

export interface StoreFile {
  version: 1;
  jobs: CronJob[];
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

/**
 * Store corrente; store vuoto se il file manca o è illeggibile — un
 * jobs.json corrotto non deve far fallire la pagina, al più mostra zero
 * job finché non se ne crea uno.
 */
export function readStore(): StoreFile {
  try {
    if (!fs.existsSync(CRON_STORE)) return { version: 1, jobs: [] };
    return JSON.parse(fs.readFileSync(CRON_STORE, "utf-8")) as StoreFile;
  } catch {
    return { version: 1, jobs: [] };
  }
}

/**
 * Riscrive lo store in modo atomico: file temporaneo + rename, così un
 * crash a metà scrittura non lascia un jobs.json troncato al CLI che lo
 * legge in parallelo. Il rename fallisce se tmp e destinazione stanno su
 * filesystem diversi — di lì il fallback copia+unlink. Permessi 0600:
 * il payload contiene comandi da eseguire.
 */
export function writeStore(store: StoreFile) {
  fs.mkdirSync(CRON_DIR, { recursive: true });
  const tmp = `${CRON_STORE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
  try {
    fs.renameSync(tmp, CRON_STORE);
  } catch {
    fs.copyFileSync(tmp, CRON_STORE);
    fs.unlinkSync(tmp);
  }
}
