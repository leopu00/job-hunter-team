import { describe, expect, it } from "vitest";
import {
  acknowledgeSync,
  observedSyncOutcome,
  pushRendezvousOutcome,
  syncRendezvousPending,
  timeoutFailure,
} from "../../../cli/src/lib/sync-rendezvous.js";

describe("rendezvous Sync now — stato terminale veritiero", () => {
  it("confronta istanti, non rappresentazioni testuali del fuso", () => {
    expect(syncRendezvousPending("2026-08-04T10:00:01Z", "2026-08-04T10:00:00+00:00")).toBe(true);
    expect(syncRendezvousPending("2026-08-04T10:00:00Z", "2026-08-04T12:00:00+02:00")).toBe(false);
    expect(syncRendezvousPending("dato-malformato", null)).toBe(false);
  });

  it("non permette l'ACK dopo push parziale, fallito o in timeout", () => {
    expect(pushRendezvousOutcome({ ok: true, skipped: 0 })).toEqual({ status: "ready_to_ack" });
    expect(pushRendezvousOutcome({ ok: true, skipped: 1 })).toEqual({
      status: "push_failed",
      retryable: true,
    });
    expect(pushRendezvousOutcome({ ok: false, timedOut: true })).toEqual({
      status: "timeout",
      retryable: true,
    });
    expect(pushRendezvousOutcome({ ok: false, authFailed: true })).toEqual({
      status: "push_failed",
      retryable: false,
    });
  });

  it("considera completato solo un ACK HTTP 2xx e propaga la deadline", async () => {
    const signal = AbortSignal.timeout(10_000);
    let seenInit: Record<string, any> | undefined;
    const ok = await acknowledgeSync({
      reader: null,
      url: "https://example.invalid/api/team-state",
      token: "token-di-test",
      completedAt: "2026-08-04T10:00:02Z",
      observed: {
        last_action: "sync:completed",
        last_action_at: "2026-08-04T10:00:02Z",
      },
      signal,
      fetchFn: async (_url: string, init?: Record<string, any>) => {
        seenInit = init;
        return { ok: true, status: 200 } as Response;
      },
    });
    expect(ok).toEqual({
      status: "completed",
      completedAt: "2026-08-04T10:00:02Z",
      via: "http",
    });
    expect(seenInit?.signal).toBe(signal);
    expect(JSON.parse(seenInit?.body)).toEqual({
      last_action: "sync:completed",
      last_action_at: "2026-08-04T10:00:02Z",
      sync_completed_at: "2026-08-04T10:00:02Z",
    });

    const rejected = await acknowledgeSync({
      reader: null,
      url: "https://example.invalid/api/team-state",
      token: "token-di-test",
      completedAt: "2026-08-04T10:00:02Z",
      fetchFn: async () => ({ ok: false, status: 503 }) as Response,
    });
    expect(rejected).toEqual({ status: "ack_failed", httpStatus: 503, retryable: true });
  });

  it("pubblica un esito correlato anche con clock VPS indietro", () => {
    const observed = observedSyncOutcome(
      "timeout",
      "2026-08-04T10:00:00.500Z",
      Date.parse("2026-08-04T09:59:00Z"),
    );
    expect(observed).toEqual({
      last_action: "sync:timeout",
      last_action_at: "2026-08-04T10:00:00.501Z",
    });
    expect(observedSyncOutcome("stato-sconosciuto", "2026-08-04T10:00:00Z")).toBeNull();
  });

  it("distingue timeout da failure senza esporre il messaggio originale", async () => {
    const timeout = Object.assign(new Error("dettaglio da non propagare"), { name: "TimeoutError" });
    expect(timeoutFailure(timeout)).toBe(true);
    expect(timeoutFailure(new Error("rete"))).toBe(false);

    const result = await acknowledgeSync({
      reader: null,
      url: "https://example.invalid/api/team-state",
      token: "token-di-test",
      completedAt: "2026-08-04T10:00:02Z",
      fetchFn: async () => {
        throw timeout;
      },
    });
    expect(result).toEqual({ status: "timeout", retryable: true });
    expect(JSON.stringify(result)).not.toContain("dettaglio");
  });

  it("degrada dal canale diretto all'HTTP senza un falso verde", async () => {
    let calls = 0;
    const result = await acknowledgeSync({
      reader: { patchTeamState: async () => { throw new Error("direct down"); } },
      url: "https://example.invalid/api/team-state",
      token: "token-di-test",
      completedAt: "2026-08-04T10:00:02Z",
      fetchFn: async () => {
        calls += 1;
        return { ok: false, status: 401 } as Response;
      },
    });
    expect(calls).toBe(1);
    expect(result).toEqual({ status: "ack_failed", httpStatus: 401, retryable: false });
  });
});
