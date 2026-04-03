/**
 * Test unitari — Gateway (ciclo completo messaggi).
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Gateway, createGateway } from "./gateway.js";
import type { ChannelHandler, ProviderHandler } from "./router.js";
import type {
  ChannelId,
  GatewayEvent,
  GatewayMessage,
  GatewayResponse,
} from "./types.js";

function mockMessage(channel: ChannelId = "web"): GatewayMessage {
  return {
    id: "msg-1", channel, role: "user",
    content: "ciao", timestamp: new Date(),
  };
}

function mockResponse(messageId = "msg-1"): GatewayResponse {
  return {
    id: "resp-1", messageId, content: "risposta",
    role: "assistant", timestamp: new Date(), streaming: false,
  };
}

function mockChannel(id: ChannelId): ChannelHandler & { sent: GatewayResponse[] } {
  const sent: GatewayResponse[] = [];
  return {
    id, sent,
    connect: async () => {},
    disconnect: async () => {},
    send: async (r: GatewayResponse) => { sent.push(r); },
    status: () => ({ id, connected: true }),
  };
}

function mockProvider(resp?: GatewayResponse): ProviderHandler {
  return { name: "mock", chat: async () => resp ?? mockResponse() };
}

describe("Gateway", () => {
  let gw: Gateway;
  let ch: ReturnType<typeof mockChannel>;

  beforeEach(() => {
    gw = createGateway({ maxQueueSize: 3 });
    ch = mockChannel("web");
    gw.router.registerChannel(ch);
    gw.router.setProvider(mockProvider());
  });

  it("createGateway applica config custom", () => {
    const g = createGateway({ port: 9999, maxQueueSize: 50 });
    assert.equal(g.config.port, 9999);
    assert.equal(g.config.maxQueueSize, 50);
  });

  it("handleMessage lancia errore se gateway non attivo", async () => {
    await assert.rejects(
      () => gw.handleMessage(mockMessage()),
      { message: "Gateway non attivo" }
    );
  });

  it("ciclo completo: pre → provider → post → canale", async () => {
    await gw.start();
    const resp = await gw.handleMessage(mockMessage());
    assert.equal(resp.content, "risposta");
    assert.equal(ch.sent.length, 1);
    assert.equal(ch.sent[0].content, "risposta");
    await gw.stop();
  });

  it("emette eventi durante il ciclo", async () => {
    const events: GatewayEvent[] = [];
    gw.onEvent((e) => events.push(e));
    await gw.start();
    await gw.handleMessage(mockMessage());
    await gw.stop();

    const types = events.map((e) => e.type);
    assert.ok(types.includes("channel.connected"));
    assert.ok(types.includes("message.received"));
    assert.ok(types.includes("response.started"));
    assert.ok(types.includes("response.completed"));
    assert.ok(types.includes("channel.disconnected"));
  });

  it("coda piena lancia errore", async () => {
    const slowProvider: ProviderHandler = {
      name: "slow",
      chat: () => new Promise((r) => setTimeout(() => r(mockResponse()), 100)),
    };
    gw.router.setProvider(slowProvider);
    await gw.start();

    const promises = Array.from({ length: 3 }, (_, i) =>
      gw.handleMessage({ ...mockMessage(), id: `msg-${i}` })
    );
    await assert.rejects(
      () => gw.handleMessage({ ...mockMessage(), id: "msg-overflow" }),
      { message: "Coda messaggi piena" }
    );
    await Promise.allSettled(promises);
    await gw.stop();
  });

  it("middleware pre abort blocca il messaggio", async () => {
    gw.middleware.register({
      name: "blocker", phase: "pre", priority: 100,
      handler: async (ctx) => {
        ctx.aborted = true;
        ctx.abortReason = "test block";
        return ctx;
      },
    });
    await gw.start();
    await assert.rejects(
      () => gw.handleMessage(mockMessage()),
      { message: "test block" }
    );
    assert.equal(ch.sent.length, 0);
    await gw.stop();
  });

  it("errore provider emette evento error", async () => {
    const events: GatewayEvent[] = [];
    gw.onEvent((e) => events.push(e));
    gw.router.setProvider({
      name: "broken",
      chat: async () => { throw new Error("provider crash"); },
    });
    await gw.start();
    await assert.rejects(
      () => gw.handleMessage(mockMessage()),
      { message: "provider crash" }
    );
    assert.ok(events.some((e) => e.type === "error"));
    await gw.stop();
  });

  it("start/stop idempotenti", async () => {
    await gw.start();
    await gw.start(); // seconda chiamata non fa nulla
    assert.equal(gw.isRunning(), true);
    await gw.stop();
    await gw.stop(); // seconda chiamata non fa nulla
    assert.equal(gw.isRunning(), false);
  });

  it("queueSize ritorna 0 dopo completamento", async () => {
    await gw.start();
    assert.equal(gw.queueSize(), 0);
    await gw.handleMessage(mockMessage());
    assert.equal(gw.queueSize(), 0);
    await gw.stop();
  });
});
