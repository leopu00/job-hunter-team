import { describe, expect, it } from "vitest";
import {
  acknowledgeSync,
  observedSyncOutcome,
  pushRendezvousOutcome,
  syncRendezvousPending,
  syncRendezvousTerminal,
  timeoutFailure,
} from "../../../cli/src/lib/sync-rendezvous.js";

describe("rendezvous Sync now — stato terminale veritiero", () => {
  it("confronta istanti, non rappresentazioni testuali del fuso", () => {
    expect(
      syncRendezvousPending(
        "2026-08-04T10:00:01Z",
        "2026-08-04T10:00:00+00:00",
      ),
    ).toBe(true);
    expect(
      syncRendezvousPending(
        "2026-08-04T10:00:00Z",
        "2026-08-04T12:00:00+02:00",
      ),
    ).toBe(false);
    expect(syncRendezvousPending("dato-malformato", null)).toBe(false);
  });

  it("non permette l'ACK dopo push parziale, fallito o in timeout", () => {
    expect(pushRendezvousOutcome({ ok: true, skipped: 0 })).toEqual({
      status: "ready_to_ack",
    });
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

  it("non ripete un esito terminale della stessa richiesta", () => {
    expect(
      syncRendezvousTerminal(
        "2026-08-04T10:00:00Z",
        "sync:timeout",
        "2026-08-04T10:00:01Z",
      ),
    ).toBe("timeout");
    // Una nuova richiesta B è successiva all'esito di A: deve poter partire.
    expect(
      syncRendezvousTerminal(
        "2026-08-04T10:00:02Z",
        "sync:timeout",
        "2026-08-04T10:00:01Z",
      ),
    ).toBeNull();
    expect(
      syncRendezvousTerminal(
        "2026-08-04T10:00:00Z",
        "heartbeat",
        "2026-08-04T10:00:01Z",
      ),
    ).toBeNull();
  });

  it("considera completato solo un ACK HTTP 2xx e propaga la deadline", async () => {
    const signal = AbortSignal.timeout(10_000);
    let seenInit: Record<string, any> | undefined;
    const ok = await acknowledgeSync({
      reader: null,
      url: "https://example.invalid/api/team-state",
      token: "token-di-test",
      expectedRequestedAt: "2026-08-04T10:00:00Z",
      signal,
      fetchFn: async (_url: string, init?: Record<string, any>) => {
        seenInit = init;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            applied: true,
            status: "completed",
            sync_completed_at: "2026-08-04T10:00:02Z",
            last_action_at: "2026-08-04T10:00:02Z",
          }),
        } as Response;
      },
    });
    expect(ok).toEqual({
      status: "completed",
      completedAt: "2026-08-04T10:00:02Z",
      via: "http",
    });
    expect(seenInit?.signal).toBe(signal);
    expect(JSON.parse(seenInit?.body)).toEqual({
      expected_requested_at: "2026-08-04T10:00:00Z",
      status: "completed",
    });

    const rejected = await acknowledgeSync({
      reader: null,
      url: "https://example.invalid/api/team-state",
      token: "token-di-test",
      expectedRequestedAt: "2026-08-04T10:00:00Z",
      fetchFn: async () => ({ ok: false, status: 503 }) as Response,
    });
    expect(rejected).toEqual({
      status: "ack_failed",
      httpStatus: 503,
      retryable: true,
    });
  });

  it("invia solo la correlazione: nessun timestamp può venire dal clock VPS", () => {
    const observed = observedSyncOutcome("timeout", "2026-08-04T10:00:00.500Z");
    expect(observed).toEqual({
      expected_requested_at: "2026-08-04T10:00:00.500Z",
      status: "timeout",
    });
    expect(JSON.stringify(observed)).not.toContain("last_action_at");
    expect(
      observedSyncOutcome("stato-sconosciuto", "2026-08-04T10:00:00Z"),
    ).toBeNull();
  });

  it("distingue timeout da failure senza esporre il messaggio originale", async () => {
    const timeout = Object.assign(new Error("dettaglio da non propagare"), {
      name: "TimeoutError",
    });
    expect(timeoutFailure(timeout)).toBe(true);
    expect(timeoutFailure(new Error("rete"))).toBe(false);

    const result = await acknowledgeSync({
      reader: null,
      url: "https://example.invalid/api/team-state",
      token: "token-di-test",
      expectedRequestedAt: "2026-08-04T10:00:00Z",
      fetchFn: async () => {
        throw timeout;
      },
    });
    expect(result).toEqual({ status: "timeout", retryable: true });
    expect(JSON.stringify(result)).not.toContain("dettaglio");
  });

  it("usa sempre l'endpoint CAS unico senza un falso verde", async () => {
    let calls = 0;
    const result = await acknowledgeSync({
      reader: {
        patchTeamState: async () => {
          throw new Error("non va usato");
        },
      },
      url: "https://example.invalid/api/team-state",
      token: "token-di-test",
      expectedRequestedAt: "2026-08-04T10:00:00Z",
      fetchFn: async () => {
        calls += 1;
        return { ok: false, status: 401 } as Response;
      },
    });
    expect(calls).toBe(1);
    expect(result).toEqual({
      status: "ack_failed",
      httpStatus: 401,
      retryable: false,
    });
  });

  it("tratta 409 come richiesta sostituita, non come errore di trasporto", async () => {
    const result = await acknowledgeSync({
      url: "https://example.invalid/api/team-state/sync-observed",
      token: "token-di-test",
      expectedRequestedAt: "2026-08-04T10:00:00Z",
      fetchFn: async () => ({ ok: false, status: 409 }) as Response,
    });
    expect(result).toEqual({
      status: "superseded",
      retryable: false,
      via: "http",
    });
  });
});
