/**
 * Test unitari — shared/cron (vitest)
 *
 * Schedule parsing (at/every/cron), job CRUD, due check,
 * recompute, nextWake, computePreviousRunAtMs.
 */
import { describe, it, expect } from "vitest";
import {
  parseAbsoluteTimeMs, computeNextRunAtMs, computePreviousRunAtMs,
} from "../../../shared/cron/schedule.js";
import {
  createJob, applyJobPatch, isJobEnabled, isJobDue,
  recomputeNextRuns, nextWakeAtMs,
} from "../../../shared/cron/jobs.js";

const every = (ms: number) => ({ kind: "every" as const, everyMs: ms });
const at = (v: string) => ({ kind: "at" as const, at: v });
const cron = (expr: string) => ({ kind: "cron" as const, expr });
const cmd = () => ({ kind: "command" as const, command: "echo test" });

describe("parseAbsoluteTimeMs", () => {
  it("accetta numero positivo finito", () => {
    expect(parseAbsoluteTimeMs(1700000000000)).toBe(1700000000000);
  });
  it("rifiuta numero negativo, NaN, Infinity", () => {
    expect(parseAbsoluteTimeMs(-1)).toBeNull();
    expect(parseAbsoluteTimeMs(NaN)).toBeNull();
    expect(parseAbsoluteTimeMs(Infinity)).toBeNull();
  });
  it("parsa stringa ISO 8601", () => {
    expect(parseAbsoluteTimeMs("2025-06-01T00:00:00Z")).toBeGreaterThan(0);
  });
  it("rifiuta stringa non valida e tipi errati", () => {
    expect(parseAbsoluteTimeMs("not-a-date")).toBeNull();
    expect(parseAbsoluteTimeMs(null as any)).toBeNull();
    expect(parseAbsoluteTimeMs(undefined as any)).toBeNull();
  });
});

describe("computeNextRunAtMs — schedule 'at'", () => {
  const nowMs = 1700000000000;
  it("ritorna timestamp futuro", () => {
    const future = new Date(nowMs + 60_000).toISOString();
    expect(computeNextRunAtMs(at(future), nowMs)).toBe(nowMs + 60_000);
  });
  it("ritorna undefined per timestamp passato", () => {
    const past = new Date(nowMs - 60_000).toISOString();
    expect(computeNextRunAtMs(at(past), nowMs)).toBeUndefined();
  });
  it("ritorna undefined per valore non parsabile", () => {
    expect(computeNextRunAtMs(at("garbage"), nowMs)).toBeUndefined();
  });
});

describe("computeNextRunAtMs — schedule 'every'", () => {
  const nowMs = 1700000000000;
  it("calcola prossimo intervallo > now", () => {
    const next = computeNextRunAtMs(every(60_000), nowMs);
    expect(next).toBeDefined();
    expect(next!).toBeGreaterThan(nowMs);
  });
  it("con anchor nel futuro ritorna anchor", () => {
    const anchor = nowMs + 100_000;
    const next = computeNextRunAtMs({ kind: "every", everyMs: 60_000, anchorMs: anchor }, nowMs);
    expect(next).toBe(anchor);
  });
  it("ritorna undefined per everyMs NaN", () => {
    expect(computeNextRunAtMs(every(NaN), nowMs)).toBeUndefined();
  });
});

describe("computeNextRunAtMs — schedule 'cron'", () => {
  it("calcola prossima esecuzione per '* * * * *'", () => {
    const nowMs = Date.now();
    const next = computeNextRunAtMs(cron("* * * * *"), nowMs);
    expect(next).toBeDefined();
    expect(next!).toBeGreaterThan(nowMs);
  });
  it("ritorna undefined per espressione vuota", () => {
    expect(computeNextRunAtMs(cron(""), Date.now())).toBeUndefined();
    expect(computeNextRunAtMs(cron("   "), Date.now())).toBeUndefined();
  });
});

describe("computePreviousRunAtMs", () => {
  it("ritorna undefined per schedule non-cron", () => {
    expect(computePreviousRunAtMs(every(60000), Date.now())).toBeUndefined();
    expect(computePreviousRunAtMs(at("2025-01-01"), Date.now())).toBeUndefined();
  });
  it("ritorna undefined per espressione cron vuota", () => {
    expect(computePreviousRunAtMs(cron(""), Date.now())).toBeUndefined();
  });
});

describe("createJob", () => {
  it("genera id UUID, timestamp e state", () => {
    const job = createJob({ name: "test", schedule: every(60_000), payload: cmd() });
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(job.createdAtMs).toBeGreaterThan(0);
    expect(job.updatedAtMs).toBe(job.createdAtMs);
    expect(job.enabled).toBe(true);
    expect(job.state.nextRunAtMs).toBeDefined();
  });
  it("enabled false non calcola nextRunAtMs", () => {
    const job = createJob({ name: "off", enabled: false, schedule: every(1000), payload: cmd() });
    expect(job.enabled).toBe(false);
    expect(job.state.nextRunAtMs).toBeUndefined();
  });
});

describe("applyJobPatch", () => {
  it("aggiorna nome, descrizione e updatedAtMs", () => {
    const job = createJob({ name: "old", schedule: every(1000), payload: cmd() });
    const before = job.updatedAtMs;
    applyJobPatch(job, { name: "new", description: "desc" });
    expect(job.name).toBe("new");
    expect(job.description).toBe("desc");
    expect(job.updatedAtMs).toBeGreaterThanOrEqual(before);
  });
  it("disabilitare rimuove nextRunAtMs e runningAtMs", () => {
    const job = createJob({ name: "t", schedule: every(1000), payload: cmd() });
    job.state.runningAtMs = 123;
    applyJobPatch(job, { enabled: false });
    expect(job.state.nextRunAtMs).toBeUndefined();
    expect(job.state.runningAtMs).toBeUndefined();
  });
});

describe("isJobEnabled / isJobDue", () => {
  it("isJobEnabled riflette campo enabled", () => {
    expect(isJobEnabled({ enabled: true } as any)).toBe(true);
    expect(isJobEnabled({ enabled: false } as any)).toBe(false);
  });
  it("isJobDue true quando abilitato e nextRun <= now", () => {
    expect(isJobDue({ enabled: true, state: { nextRunAtMs: 100 } } as any, 200)).toBe(true);
  });
  it("isJobDue false quando disabilitato o running", () => {
    expect(isJobDue({ enabled: false, state: { nextRunAtMs: 100 } } as any, 200)).toBe(false);
    expect(isJobDue({ enabled: true, state: { nextRunAtMs: 100, runningAtMs: 150 } } as any, 200)).toBe(false);
  });
  it("isJobDue true con forced anche se non due", () => {
    expect(isJobDue({ enabled: true, state: { nextRunAtMs: 999 } } as any, 100, { forced: true })).toBe(true);
  });
});

describe("recomputeNextRuns / nextWakeAtMs", () => {
  it("recompute aggiorna nextRunAtMs e ritorna changed", () => {
    const job = createJob({ name: "r", schedule: every(60_000), payload: cmd() });
    job.state.nextRunAtMs = undefined;
    expect(recomputeNextRuns([job])).toBe(true);
    expect(job.state.nextRunAtMs).toBeDefined();
  });
  it("nextWakeAtMs trova il timestamp piu' vicino", () => {
    const jobs = [{ state: { nextRunAtMs: 500 } }, { state: { nextRunAtMs: 200 } }, { state: { nextRunAtMs: 800 } }];
    expect(nextWakeAtMs(jobs as any)).toBe(200);
  });
  it("nextWakeAtMs ritorna null per array vuoto", () => {
    expect(nextWakeAtMs([])).toBeNull();
  });
});
