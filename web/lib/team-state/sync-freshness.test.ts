import { describe, expect, it } from "vitest";
import { syncRequestIsPending } from "./sync-freshness";

describe("segnale freshness durante Sync now", () => {
  it("considera pending una richiesta senza completion", () => {
    expect(
      syncRequestIsPending({
        sync_requested_at: "2026-08-04T14:00:01.000Z",
        sync_completed_at: "2026-08-04T14:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("un heartbeat successivo non rende terminale la richiesta", () => {
    expect(
      syncRequestIsPending({
        sync_requested_at: "2026-08-04T14:00:01.000Z",
        sync_completed_at: null,
        last_action: "heartbeat",
        last_action_at: "2026-08-04T14:00:02.000Z",
      }),
    ).toBe(true);
  });

  it("completion o esito sync correlato chiudono il pending", () => {
    expect(
      syncRequestIsPending({
        sync_requested_at: "2026-08-04T14:00:01.000Z",
        sync_completed_at: "2026-08-04T14:00:02.000Z",
      }),
    ).toBe(false);
    expect(
      syncRequestIsPending({
        sync_requested_at: "2026-08-04T14:00:01.000Z",
        sync_completed_at: null,
        last_action: "sync:push_failed",
        last_action_at: "2026-08-04T14:00:02.000Z",
      }),
    ).toBe(false);
  });

  it("un esito sync della richiesta precedente non chiude quella nuova", () => {
    expect(
      syncRequestIsPending({
        sync_requested_at: "2026-08-04T14:00:03.000Z",
        sync_completed_at: null,
        last_action: "sync:completed",
        last_action_at: "2026-08-04T14:00:02.000Z",
      }),
    ).toBe(true);
  });

  it("un action sync sconosciuto o con timestamp uguale non chiude il pending", () => {
    expect(
      syncRequestIsPending({
        sync_requested_at: "2026-08-04T14:00:01.000Z",
        sync_completed_at: null,
        last_action: "sync:future_status",
        last_action_at: "2026-08-04T14:00:02.000Z",
      }),
    ).toBe(true);
    expect(
      syncRequestIsPending({
        sync_requested_at: "2026-08-04T14:00:01.000Z",
        sync_completed_at: null,
        last_action: "sync:completed",
        last_action_at: "2026-08-04T14:00:01.000Z",
      }),
    ).toBe(true);
  });
});
