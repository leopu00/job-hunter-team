/**
 * Test unitari — MessageRouter e MiddlewarePipeline.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MessageRouter, type ChannelHandler, type ProviderHandler } from "./router.js";
import {
  MiddlewarePipeline,
  loggingMiddleware,
  createRateLimitMiddleware,
} from "./middleware.js";
import type { GatewayMessage, GatewayResponse, ChannelId } from "./types.js";

// --- Helper: mock objects ---

function mockMessage(channel: ChannelId = "web"): GatewayMessage {
  return {
    id: "msg-1",
    channel,
    role: "user",
    content: "test",
    timestamp: new Date(),
  };
}

function mockResponse(messageId = "msg-1"): GatewayResponse {
  return {
    id: "resp-1",
    messageId,
    content: "risposta",
    role: "assistant",
    timestamp: new Date(),
    streaming: false,
  };
}

function mockChannel(id: ChannelId): ChannelHandler & { sent: GatewayResponse[] } {
  const sent: GatewayResponse[] = [];
  return {
    id,
    sent,
    connect: async () => {},
    disconnect: async () => {},
    send: async (r: GatewayResponse) => { sent.push(r); },
    status: () => ({ id, connected: true }),
  };
}

function mockProvider(response?: GatewayResponse): ProviderHandler {
  return {
    name: "mock-provider",
    chat: async () => response ?? mockResponse(),
  };
}

// --- Router ---

describe("MessageRouter", () => {
  let router: MessageRouter;

  beforeEach(() => { router = new MessageRouter(); });

  it("registra e recupera un canale", () => {
    const ch = mockChannel("web");
    router.registerChannel(ch);
    assert.equal(router.getChannel("web"), ch);
  });

  it("rimuove un canale registrato", () => {
    router.registerChannel(mockChannel("cli"));
    assert.equal(router.unregisterChannel("cli"), true);
    assert.equal(router.getChannel("cli"), undefined);
  });

  it("unregister ritorna false se canale non esiste", () => {
    assert.equal(router.unregisterChannel("telegram"), false);
  });

  it("listChannels ritorna status di tutti i canali", () => {
    router.registerChannel(mockChannel("web"));
    router.registerChannel(mockChannel("cli"));
    const list = router.listChannels();
    assert.equal(list.length, 2);
    assert.deepEqual(list.map((s) => s.id).sort(), ["cli", "web"]);
  });

  it("routeToProvider inoltra al provider e ritorna risposta", async () => {
    const resp = mockResponse();
    router.setProvider(mockProvider(resp));
    const result = await router.routeToProvider(mockMessage());
    assert.equal(result.id, resp.id);
    assert.equal(result.content, "risposta");
  });

  it("routeToProvider lancia errore senza provider", async () => {
    await assert.rejects(
      () => router.routeToProvider(mockMessage()),
      { message: "Nessun provider AI configurato" }
    );
  });

  it("routeToChannel invia risposta al canale corretto", async () => {
    const ch = mockChannel("web");
    router.registerChannel(ch);
    const resp = mockResponse();
    await router.routeToChannel("web", resp);
    assert.equal(ch.sent.length, 1);
    assert.equal(ch.sent[0].id, resp.id);
  });

  it("routeToChannel lancia errore per canale non registrato", async () => {
    await assert.rejects(
      () => router.routeToChannel("telegram", mockResponse()),
      { message: 'Canale "telegram" non registrato' }
    );
  });
});

// --- Middleware ---

describe("MiddlewarePipeline", () => {
  let pipeline: MiddlewarePipeline;

  beforeEach(() => { pipeline = new MiddlewarePipeline(); });

  it("esegue pre middleware in ordine di priorità", async () => {
    const order: number[] = [];
    pipeline.register({
      name: "second", phase: "pre", priority: 20,
      handler: async (ctx) => { order.push(2); return ctx; },
    });
    pipeline.register({
      name: "first", phase: "pre", priority: 10,
      handler: async (ctx) => { order.push(1); return ctx; },
    });
    await pipeline.runPre(mockMessage());
    assert.deepEqual(order, [1, 2]);
  });

  it("abort interrompe la pipeline pre", async () => {
    const reached: string[] = [];
    pipeline.register({
      name: "blocker", phase: "pre", priority: 1,
      handler: async (ctx) => {
        reached.push("blocker");
        ctx.aborted = true;
        ctx.abortReason = "bloccato";
        return ctx;
      },
    });
    pipeline.register({
      name: "after", phase: "pre", priority: 2,
      handler: async (ctx) => { reached.push("after"); return ctx; },
    });
    const result = await pipeline.runPre(mockMessage());
    assert.equal(result.aborted, true);
    assert.equal(result.abortReason, "bloccato");
    assert.deepEqual(reached, ["blocker"]);
  });

  it("logging middleware imposta receivedAt", async () => {
    pipeline.register(loggingMiddleware);
    const ctx = await pipeline.runPre(mockMessage());
    assert.equal(typeof ctx.metadata.receivedAt, "number");
  });

  it("rate limit middleware blocca dopo il limite", async () => {
    const rl = createRateLimitMiddleware(2);
    pipeline.register(rl);
    const msg = mockMessage();
    const r1 = await pipeline.runPre(msg);
    assert.equal(r1.aborted, false);
    const r2 = await pipeline.runPre(msg);
    assert.equal(r2.aborted, false);
    const r3 = await pipeline.runPre(msg);
    assert.equal(r3.aborted, true);
    assert.ok(r3.abortReason?.includes("Rate limit"));
  });

  it("unregister rimuove middleware per nome", () => {
    pipeline.register(loggingMiddleware);
    assert.equal(pipeline.list().length, 1);
    assert.equal(pipeline.unregister("logging"), true);
    assert.equal(pipeline.list().length, 0);
  });
});
