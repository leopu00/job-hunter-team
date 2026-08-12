/** O-66 — il cloud converge senza aspettare che qualcuno prema Sync now. */
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSingleFlightPush,
  decidePeriodicPush,
  nextPeriodicCheckState,
  nextPeriodicPushState,
  periodicPushLimits,
  periodicPushStatusLine,
  readPeriodicPushState,
  savePeriodicPushState,
} from "../../../cli/src/lib/periodic-push.js";

const T0 = Date.UTC(2026, 7, 12, 15, 0, 0);
const MIN = 60_000;
const iso = (value: number) => new Date(value).toISOString();
const limits = periodicPushLimits({});
const signature = (count = 2) => ({
  positions: { n: count, max: "2026-08-12 15:00:00" },
  profile: null,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("policy del push periodico", () => {
  it("ha cadenza, retry e timeout finiti e configurabili", () => {
    expect(limits).toMatchObject({
      enabled: true,
      intervalMs: 15 * MIN,
      retryMs: MIN,
      timeoutMs: 2 * MIN,
    });
    expect(
      periodicPushLimits({
        JHT_PERIODIC_PUSH_SEC: "3",
        JHT_PERIODIC_PUSH_RETRY_SEC: "2",
        JHT_PERIODIC_PUSH_TIMEOUT_SEC: "4",
      }),
    ).toMatchObject({ intervalMs: 3000, retryMs: 2000, timeoutMs: 4000 });
  });

  it("al primo controllo legge la firma e parte se ci sono dati locali", () => {
    expect(decidePeriodicPush({ now: T0, state: {}, limits })).toMatchObject({
      push: false,
      needsSignature: true,
    });
    expect(
      decidePeriodicPush({
        now: T0,
        state: {},
        limits,
        signature: signature(),
      }),
    ).toMatchObject({ push: true, reason: "local_changes" });
  });

  it("non chiama il cloud quando la firma non è cambiata", () => {
    expect(
      decidePeriodicPush({
        now: T0,
        state: { signature: signature(), last_check_at: iso(T0 - 20 * MIN) },
        limits,
        signature: signature(),
      }),
    ).toMatchObject({ push: false, reason: "nothing_new", checked: true });
  });

  it("un successo impone la cadenza normale", () => {
    const state = nextPeriodicPushState({
      state: {},
      now: T0,
      signature: signature(),
      result: { ok: true, skipped: 0 },
      source: "periodic",
    });
    expect(state).toMatchObject({
      status: "completed",
      last_success_at: iso(T0),
      consecutive_failures: 0,
      signature: signature(),
    });
    expect(
      decidePeriodicPush({ now: T0 + 14 * MIN, state, limits }),
    ).toMatchObject({ push: false, reason: "cadence" });
  });

  it("un fallimento resta visibile e viene ritentato dopo il retry breve", () => {
    const state = nextPeriodicPushState({
      state: { signature: signature(1) },
      now: T0,
      signature: signature(2),
      result: { ok: false, timedOut: true, skipped: 0 },
      source: "periodic",
    });
    expect(state).toMatchObject({
      status: "timeout",
      consecutive_failures: 1,
      signature: signature(1),
    });
    expect(periodicPushStatusLine(state)).toContain("retry is automatic");
    expect(
      decidePeriodicPush({ now: T0 + 59_000, state, limits }),
    ).toMatchObject({ push: false, reason: "cadence" });
    expect(
      decidePeriodicPush({
        now: T0 + MIN,
        state,
        limits,
        signature: signature(2),
      }),
    ).toMatchObject({ push: true, reason: "local_changes" });
  });

  it("un controllo senza novità persiste il momento osservato", () => {
    expect(
      nextPeriodicCheckState({
        state: { status: "completed" },
        now: T0,
        signature: signature(),
        reason: "nothing_new",
      }),
    ).toMatchObject({
      status: "idle",
      last_check_at: iso(T0),
      signature: signature(),
    });
  });
});

describe("single-flight condiviso con Sync now", () => {
  it("due trigger sovrapposti attendono lo stesso push e il successivo riparte", async () => {
    let release!: (value: { ok: boolean; skipped: number }) => void;
    const first = new Promise<{ ok: boolean; skipped: number }>((resolve) => {
      release = resolve;
    });
    const push = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValue({ ok: true, skipped: 0 });
    const joined = vi.fn();
    const run = createSingleFlightPush(push, joined);

    const automatic = run({ source: "periodic" });
    await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const syncNow = run({ source: "sync-now" });
    expect(push).toHaveBeenCalledTimes(1);
    expect(joined).toHaveBeenCalledTimes(1);
    release({ ok: true, skipped: 0 });
    await expect(Promise.all([automatic, syncNow])).resolves.toEqual([
      { ok: true, skipped: 0 },
      { ok: true, skipped: 0 },
    ]);

    await run({ source: "periodic" });
    expect(push).toHaveBeenCalledTimes(2);
  });
});

describe("stato osservabile su disco", () => {
  it("scrive JSON 0600 e lo rilegge", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jht-periodic-push-"));
    const file = join(dir, "state.json");
    try {
      const state = { status: "failed", last_attempt_at: iso(T0) };
      await expect(savePeriodicPushState(state, file)).resolves.toBe(true);
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(state);
      expect(readPeriodicPushState(file)).toEqual(state);
      expect(statSync(file).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
