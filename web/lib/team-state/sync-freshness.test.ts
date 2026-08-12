import { describe, expect, it } from "vitest";
import {
  CLOUD_SYNC_STALE_AFTER_MS,
  cloudSyncIsBehind,
  freshnessRowFromRead,
  syncRequestIsPending,
} from "./sync-freshness";

describe("visibilità del ritardo cloud", () => {
  const now = Date.parse("2026-08-12T18:00:00.000Z");

  it("resta fresco entro il bound automatico e diventa indietro oltre", () => {
    expect(
      cloudSyncIsBehind(
        "current",
        new Date(now - CLOUD_SYNC_STALE_AFTER_MS).toISOString(),
        now,
      ),
    ).toBe(false);
    expect(
      cloudSyncIsBehind(
        "current",
        new Date(now - CLOUD_SYNC_STALE_AFTER_MS - 1).toISOString(),
        now,
      ),
    ).toBe(true);
  });

  it("mai sincronizzato è visibilmente indietro; clock skew non lo è", () => {
    expect(cloudSyncIsBehind(null, null, now)).toBe(true);
    expect(cloudSyncIsBehind("timeout", new Date(now).toISOString(), now)).toBe(
      true,
    );
    expect(cloudSyncIsBehind("current", "not-a-date", now)).toBe(true);
    expect(
      cloudSyncIsBehind("current", new Date(now + 1_000).toISOString(), now),
    ).toBe(false);
  });

  it("un errore Supabase resta sconosciuto, non diventa una riga nulla", () => {
    expect(
      freshnessRowFromRead({
        data: null,
        error: { message: "transient read failure" },
      }),
    ).toBeUndefined();
    expect(freshnessRowFromRead({ data: null, error: null })).toBeNull();
    expect(
      freshnessRowFromRead({
        data: { cloud_push_status: "current" },
        error: null,
      }),
    ).toEqual({ cloud_push_status: "current" });
  });
});

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
