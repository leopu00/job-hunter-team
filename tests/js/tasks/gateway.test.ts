/**
 * Test unitari — shared/gateway (vitest)
 *
 * Router, middleware pipeline (ordine, errori, skip), dispatch request.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MessageRouter } from "../../../shared/gateway/router.js";
import { MiddlewarePipeline, loggingMiddleware, createRateLimitMiddleware } from "../../../shared/gateway/middleware.js";
import { Gateway, createGateway } from "../../../shared/gateway/gateway.js";
import type { ChannelHandler, ProviderHandler } from "../../../shared/gateway/router.js";
import type { ChannelId, GatewayMessage, GatewayResponse, GatewayEvent, MiddlewareContext } from "../../../shared/gateway/types.js";

function msg(channel: ChannelId = "web", content = "test"): GatewayMessage {
  return { id: "m1", channel, role: "user", content, timestamp: new Date() };
}
function resp(mid = "m1"): GatewayResponse {
  return { id: "r1", messageId: mid, content: "ok", role: "assistant", timestamp: new Date(), streaming: false };
}
function chan(id: ChannelId): ChannelHandler & { sent: GatewayResponse[] } {
  const sent: GatewayResponse[] = [];
  return { id, sent, connect: async () => {}, disconnect: async () => {},
    send: async (r) => { sent.push(r); }, status: () => ({ id, connected: true }) };
}
function prov(r?: GatewayResponse): ProviderHandler {
  return { name: "mock", chat: async () => r ?? resp() };
}

describe("Router — edge cases", () => {
  let router: MessageRouter;
  beforeEach(() => { router = new MessageRouter(); });

  it("getProvider ritorna null senza setProvider", () => {
    expect(router.getProvider()).toBeNull();
  });

  it("setProvider sovrascrive provider precedente", () => {
    router.setProvider(prov());
    router.setProvider({ name: "new", chat: async () => resp() });
    expect(router.getProvider()!.name).toBe("new");
  });

  it("connectAll gestisce errore di un canale senza bloccare", async () => {
    const ok = chan("web");
    const broken: ChannelHandler = {
      id: "cli", connect: async () => { throw new Error("fail"); },
      disconnect: async () => {}, send: async () => {},
      status: () => ({ id: "cli", connected: false, error: "fail" }),
    };
    router.registerChannel(ok);
    router.registerChannel(broken);
    await expect(router.connectAll()).resolves.toBeUndefined();
  });

  it("disconnectAll non lancia se un canale fallisce", async () => {
    const broken: ChannelHandler = {
      id: "web", connect: async () => {},
      disconnect: async () => { throw new Error("dc fail"); },
      send: async () => {}, status: () => ({ id: "web", connected: true }),
    };
    router.registerChannel(broken);
    await expect(router.disconnectAll()).resolves.toBeUndefined();
  });
});

describe("Middleware — errori, post, filter", () => {
  let pipe: MiddlewarePipeline;
  beforeEach(() => { pipe = new MiddlewarePipeline(); });

  it("list filtra per fase pre/post", () => {
    pipe.register({ name: "a", phase: "pre", priority: 1, handler: async (c) => c });
    pipe.register({ name: "b", phase: "post", priority: 1, handler: async (c) => c });
    pipe.register({ name: "c", phase: "pre", priority: 2, handler: async (c) => c });
    expect(pipe.list("pre")).toHaveLength(2);
    expect(pipe.list("post")).toHaveLength(1);
    expect(pipe.list()).toHaveLength(3);
  });

  it("unregister ritorna false per nome inesistente", () => {
    expect(pipe.unregister("fantasma")).toBe(false);
  });

  it("runPost esegue solo middleware post in ordine", async () => {
    const order: number[] = [];
    pipe.register({ name: "pre1", phase: "pre", priority: 1, handler: async (c) => { order.push(0); return c; } });
    pipe.register({ name: "post2", phase: "post", priority: 20, handler: async (c) => { order.push(2); return c; } });
    pipe.register({ name: "post1", phase: "post", priority: 10, handler: async (c) => { order.push(1); return c; } });
    const ctx: MiddlewareContext = { message: msg(), metadata: {}, aborted: false };
    await pipe.runPost(ctx);
    expect(order).toEqual([1, 2]);
  });

  it("runPost si ferma se ctx.aborted", async () => {
    const reached: string[] = [];
    pipe.register({ name: "abort", phase: "post", priority: 1,
      handler: async (c) => { reached.push("abort"); c.aborted = true; return c; } });
    pipe.register({ name: "after", phase: "post", priority: 2,
      handler: async (c) => { reached.push("after"); return c; } });
    const ctx: MiddlewareContext = { message: msg(), metadata: {}, aborted: false };
    const result = await pipe.runPost(ctx);
    expect(result.aborted).toBe(true);
    expect(reached).toEqual(["abort"]);
  });

  it("middleware pre puo' modificare metadata", async () => {
    pipe.register({ name: "tag", phase: "pre", priority: 1,
      handler: async (c) => { c.metadata.tagged = true; return c; } });
    const ctx = await pipe.runPre(msg());
    expect(ctx.metadata.tagged).toBe(true);
  });

  it("rate limit resetta dopo window", async () => {
    const rl = createRateLimitMiddleware(1);
    pipe.register(rl);
    const r1 = await pipe.runPre(msg());
    expect(r1.aborted).toBe(false);
    const r2 = await pipe.runPre(msg());
    expect(r2.aborted).toBe(true);
  });
});

describe("Gateway — dispatch e lifecycle", () => {
  let gw: Gateway;
  let ch: ReturnType<typeof chan>;

  beforeEach(() => {
    gw = createGateway({ maxQueueSize: 5 });
    ch = chan("web");
    gw.router.registerChannel(ch);
    gw.router.setProvider(prov());
  });

  it("handleMessage dispatch risposta al canale corretto", async () => {
    await gw.start();
    const r = await gw.handleMessage(msg());
    expect(r.content).toBe("ok");
    expect(ch.sent).toHaveLength(1);
    await gw.stop();
  });

  it("evento error emesso su errore provider", async () => {
    const events: string[] = [];
    gw.onEvent((e) => events.push(e.type));
    gw.router.setProvider({ name: "bad", chat: async () => { throw new Error("boom"); } });
    await gw.start();
    await expect(gw.handleMessage(msg())).rejects.toThrow("boom");
    expect(events).toContain("error");
    await gw.stop();
  });

  it("evento handler che lancia non blocca il gateway", async () => {
    gw.onEvent(() => { throw new Error("handler crash"); });
    const events: string[] = [];
    gw.onEvent((e) => events.push(e.type));
    await gw.start();
    await gw.handleMessage(msg());
    expect(events.length).toBeGreaterThan(0);
    await gw.stop();
  });

  it("stop svuota la coda", async () => {
    await gw.start();
    expect(gw.queueSize()).toBe(0);
    await gw.stop();
    expect(gw.isRunning()).toBe(false);
  });

  it("logging middleware registrato di default", () => {
    const mws = gw.middleware.list("pre");
    expect(mws.some((m) => m.name === "logging")).toBe(true);
  });
});
