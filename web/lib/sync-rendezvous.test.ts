import { describe, expect, it } from "vitest";
import {
  timestampAdvanced,
  syncTerminalOutcome,
  waitForSyncOutcome,
} from "./sync-rendezvous";

describe("timestamp del rendezvous sync", () => {
  it("accetta solo un completion valido e successivo alla baseline", () => {
    const baseline = "2026-08-04T14:00:00.000Z";
    expect(timestampAdvanced(null, baseline)).toBe(false);
    expect(timestampAdvanced("non-una-data", baseline)).toBe(false);
    expect(timestampAdvanced(baseline, baseline)).toBe(false);
    expect(timestampAdvanced("2026-08-04T13:59:59.999Z", baseline)).toBe(
      false,
    );
    expect(timestampAdvanced("2026-08-04T14:00:00.001Z", baseline)).toBe(
      true,
    );
  });

  it("confronta gli istanti, non la forma testuale del fuso", () => {
    expect(
      timestampAdvanced(
        "2026-08-04T14:00:01+00:00",
        "2026-08-04T14:00:00Z",
      ),
    ).toBe(true);
  });
});

describe("round-trip client -> VPS -> client senza evento Realtime", () => {
  it("osserva l'ACK col catch-up bounded e completa senza reload", async () => {
    const baseline = "2026-08-04T14:00:00.000Z";
    const requestedAt = "2026-08-04T14:00:01.000Z";
    const states = [baseline, baseline, "2026-08-04T14:00:06.000Z"];
    let now = 0;
    let reads = 0;

    const completed = await waitForSyncOutcome({
      baselineCompletion: baseline,
      requestedAt,
      readObservation: async () => ({
        requestedAt,
        completedAt: states[reads++] ?? null,
        lastAction: null,
        lastActionAt: null,
      }),
      intervalMs: 1_000,
      timeoutMs: 10_000,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });

    expect(completed).toEqual({
      status: "completed",
      completedAt: "2026-08-04T14:00:06.000Z",
    });
    expect(reads).toBe(3);
    expect(now).toBe(2_000);
  });

  it("non dichiara successo se la baseline non avanza", async () => {
    const baseline = "2026-08-04T14:00:00.000Z";
    let now = 0;

    const completed = await waitForSyncOutcome({
      baselineCompletion: baseline,
      requestedAt: "2026-08-04T14:00:01.000Z",
      readObservation: async () => ({
        requestedAt: "2026-08-04T14:00:01.000Z",
        completedAt: baseline,
        lastAction: null,
        lastActionAt: null,
      }),
      intervalMs: 1_000,
      timeoutMs: 2_500,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });

    expect(completed).toBeNull();
    expect(now).toBe(2_500);
  });

  it("si ferma quando Realtime ha gia' chiuso la richiesta", async () => {
    let cancelled = false;
    let reads = 0;

    const completed = await waitForSyncOutcome({
      baselineCompletion: null,
      requestedAt: "2026-08-04T14:00:01.000Z",
      readObservation: async () => {
        reads += 1;
        cancelled = true;
        return {
          requestedAt: "2026-08-04T14:00:01.000Z",
          completedAt: null,
          lastAction: null,
          lastActionAt: null,
        };
      },
      isCancelled: () => cancelled,
      sleep: async () => {
        throw new Error("non deve attendere dopo la cancellazione");
      },
    });

    expect(completed).toBeNull();
    expect(reads).toBe(1);
  });
});

describe("failure server correlato al click", () => {
  const baseline = "2026-08-04T14:00:00.000Z";
  const requestedAt = "2026-08-04T14:00:01.000Z";

  it.each([
    ["sync:timeout", "timeout"],
    ["sync:push_failed", "push_failed"],
    ["sync:ack_failed", "ack_failed"],
  ] as const)("%s chiude con esito %s", (lastAction, status) => {
    expect(
      syncTerminalOutcome(
        {
          requestedAt,
          completedAt: baseline,
          lastAction,
          lastActionAt: "2026-08-04T14:00:02.000Z",
        },
        baseline,
        requestedAt,
      ),
    ).toEqual({ status });
  });

  it("accetta il completed atomico se la risposta PATCH lo ha gia' incluso nella baseline", () => {
    const completedAt = "2026-08-04T14:00:02.000Z";
    expect(
      syncTerminalOutcome(
        {
          requestedAt,
          completedAt,
          lastAction: "sync:completed",
          lastActionAt: "2026-08-04T14:00:02.001Z",
        },
        completedAt,
        requestedAt,
      ),
    ).toEqual({ status: "completed", completedAt });
  });

  it("non accetta un completed correlato senza timestamp completion valido", () => {
    expect(
      syncTerminalOutcome(
        {
          requestedAt,
          completedAt: "non-una-data",
          lastAction: "sync:completed",
          lastActionAt: "2026-08-04T14:00:02.001Z",
        },
        baseline,
        requestedAt,
      ),
    ).toBeNull();
  });

  it("ignora un failure vecchio o appartenente a un'altra corsia", () => {
    expect(
      syncTerminalOutcome(
        {
          requestedAt,
          completedAt: baseline,
          lastAction: "sync:push_failed",
          lastActionAt: requestedAt,
        },
        baseline,
        requestedAt,
      ),
    ).toBeNull();
    expect(
      syncTerminalOutcome(
        {
          requestedAt,
          completedAt: baseline,
          lastAction: "chat:request_failed",
          lastActionAt: "2026-08-04T14:00:02.000Z",
        },
        baseline,
        requestedAt,
      ),
    ).toBeNull();
    expect(
      syncTerminalOutcome(
        {
          requestedAt,
          completedAt: baseline,
          lastAction: "sync:timeout",
          lastActionAt: "2026-08-04T14:00:02.000Z",
        },
        baseline,
        "richiesta-malformata",
      ),
    ).toBeNull();
  });

  it("un failure terminale correlato prevale su freshness successiva", () => {
    expect(
      syncTerminalOutcome(
        {
          requestedAt,
          completedAt: "2026-08-04T14:00:03.000Z",
          lastAction: "sync:push_failed",
          lastActionAt: "2026-08-04T14:00:02.000Z",
        },
        baseline,
        requestedAt,
      ),
    ).toEqual({ status: "push_failed" });
  });

  it("un completion nuovo ignora un failure della richiesta precedente", () => {
    expect(
      syncTerminalOutcome(
        {
          requestedAt,
          completedAt: "2026-08-04T14:00:03.000Z",
          lastAction: "sync:push_failed",
          lastActionAt: "2026-08-04T14:00:00.500Z",
        },
        baseline,
        requestedAt,
      ),
    ).toEqual({
      status: "completed",
      completedAt: "2026-08-04T14:00:03.000Z",
    });
  });

  it("non attribuisce a un tab il completion della richiesta concorrente", () => {
    expect(
      syncTerminalOutcome(
        {
          requestedAt: "2026-08-04T14:00:03.000Z",
          completedAt: "2026-08-04T14:00:04.000Z",
          lastAction: "sync:completed",
          lastActionAt: "2026-08-04T14:00:04.000Z",
        },
        baseline,
        requestedAt,
      ),
    ).toEqual({ status: "superseded" });
  });

  it("ignora un evento Realtime vecchio arrivato dopo la propria PATCH", () => {
    expect(
      syncTerminalOutcome(
        {
          requestedAt: "2026-08-04T14:00:00.500Z",
          completedAt: "2026-08-04T14:00:02.000Z",
          lastAction: "sync:completed",
          lastActionAt: "2026-08-04T14:00:02.000Z",
        },
        baseline,
        requestedAt,
      ),
    ).toBeNull();
  });
});
