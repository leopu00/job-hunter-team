import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  resolveIndicatorType,
  emitHeartbeatEvent,
  onHeartbeatEvent,
  getLastHeartbeatEvent,
  setHeartbeatHandler,
  setHeartbeatsEnabled,
  areHeartbeatsEnabled,
  requestHeartbeatNow,
  resetHeartbeatForTest,
} from "./heartbeat.js";
import type { HeartbeatEvent } from "./types.js";

describe("heartbeat", () => {
  beforeEach(() => {
    resetHeartbeatForTest();
  });

  it("resolveIndicatorType — mappa status a indicator corretto", () => {
    assert.equal(resolveIndicatorType("ok-empty"), "ok");
    assert.equal(resolveIndicatorType("ok-token"), "ok");
    assert.equal(resolveIndicatorType("sent"), "alert");
    assert.equal(resolveIndicatorType("failed"), "error");
    assert.equal(resolveIndicatorType("skipped"), undefined);
  });

  it("emitHeartbeatEvent — aggiorna lastEvent e notifica listener", () => {
    const events: HeartbeatEvent[] = [];
    onHeartbeatEvent((evt) => events.push(evt));

    emitHeartbeatEvent({ status: "ok-token", agentId: "test-agent" });

    assert.equal(events.length, 1);
    assert.equal(events[0].status, "ok-token");
    assert.equal(events[0].agentId, "test-agent");
    assert.equal(events[0].indicatorType, "ok");
    assert.ok(events[0].ts > 0, "Deve avere timestamp");

    const last = getLastHeartbeatEvent();
    assert.ok(last, "lastEvent deve esistere");
    assert.equal(last!.status, "ok-token");
  });

  it("onHeartbeatEvent — unsubscribe funziona", () => {
    const events: HeartbeatEvent[] = [];
    const unsub = onHeartbeatEvent((evt) => events.push(evt));

    emitHeartbeatEvent({ status: "sent" });
    assert.equal(events.length, 1);

    unsub();
    emitHeartbeatEvent({ status: "ok-token" });
    assert.equal(events.length, 1, "Dopo unsub non deve ricevere");
  });

  it("setHeartbeatsEnabled — disabilita e riabilita heartbeat", () => {
    assert.ok(areHeartbeatsEnabled(), "Default: abilitato");

    setHeartbeatsEnabled(false);
    assert.ok(!areHeartbeatsEnabled());

    setHeartbeatsEnabled(true);
    assert.ok(areHeartbeatsEnabled());
  });

  it("requestHeartbeatNow — non esegue se disabilitato", () => {
    setHeartbeatsEnabled(false);
    // Non deve lanciare errore
    requestHeartbeatNow({ reason: "test" });
  });

  it("setHeartbeatHandler — handler viene chiamato da executeHeartbeat", async () => {
    let called = false;
    setHeartbeatHandler(async (opts) => {
      called = true;
      return { status: "ran", durationMs: 10 };
    });

    // requestHeartbeatNow schedula con coalescing (250ms default)
    requestHeartbeatNow({ reason: "test", agentId: "agent-1" });
    // Aspetta coalescing + esecuzione
    await new Promise((r) => setTimeout(r, 500));

    assert.ok(called, "Handler deve essere stato chiamato");
    const last = getLastHeartbeatEvent();
    assert.ok(last, "Deve avere ultimo evento");
  });

  it("resetHeartbeatForTest — pulisce tutto lo stato", () => {
    emitHeartbeatEvent({ status: "sent" });
    assert.ok(getLastHeartbeatEvent());

    resetHeartbeatForTest();

    assert.equal(getLastHeartbeatEvent(), null);
    assert.ok(areHeartbeatsEnabled(), "Deve tornare abilitato");
  });
});
