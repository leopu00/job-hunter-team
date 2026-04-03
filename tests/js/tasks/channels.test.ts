/**
 * Test unitari — shared/channels (vitest)
 *
 * Channel interface, registry edge cases, adapters web/cli/telegram,
 * message dispatch, onAnyMessage, broadcast errori.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { CHANNEL_IDS, createMessageId, buildInboundMessage, buildOutboundMessage } from "../../../shared/channels/channel.js";
import { ChannelRegistry, getDefaultRegistry, resetDefaultRegistry } from "../../../shared/channels/registry.js";
import { WebChannel } from "../../../shared/channels/web-channel.js";
import { TelegramChannel } from "../../../shared/channels/telegram-channel.js";
import type { ChannelMessage } from "../../../shared/channels/channel.js";

function mockTgChannel(chatId = "123"): TelegramChannel {
  const sent: string[] = [];
  return new TelegramChannel({ chatId, sendFn: async (p) => { sent.push(p.text); } });
}

describe("Channel helpers — edge cases", () => {
  it("createMessageId contiene timestamp numerico", () => {
    const id = createMessageId();
    const parts = id.split("_");
    expect(parts[0]).toBe("msg");
    expect(Number(parts[1])).toBeGreaterThan(0);
  });

  it("buildInboundMessage imposta direction inbound per qualsiasi canale", () => {
    for (const ch of CHANNEL_IDS) {
      const m = buildInboundMessage(ch, { text: "t", sender: "s" });
      expect(m.direction).toBe("inbound");
      expect(m.channelId).toBe(ch);
    }
  });

  it("buildOutboundMessage preserva recipient opzionale", () => {
    const m = buildOutboundMessage("web", { text: "t", sender: "bot", recipient: "user-1" });
    expect(m.recipient).toBe("user-1");
  });
});

describe("ChannelRegistry — edge cases avanzati", () => {
  let reg: ChannelRegistry;
  beforeEach(() => { reg = new ChannelRegistry(); resetDefaultRegistry(); });

  it("register sovrascrive canale esistente", () => {
    const web1 = new WebChannel({ maxQueueSize: 10 });
    const web2 = new WebChannel({ maxQueueSize: 20 });
    reg.register(web1);
    reg.register(web2);
    expect(reg.size).toBe(1);
    expect(reg.get("web")).toBe(web2);
  });

  it("sendTo a canale non registrato ritorna null", async () => {
    const result = await reg.sendTo("telegram", { text: "t", sender: "s" });
    expect(result).toBeNull();
  });

  it("broadcast ignora errori di singoli canali", async () => {
    const web = new WebChannel();
    await web.connect();
    const broken = mockTgChannel("fail");
    broken.setSendFn(async () => { throw new Error("send failed"); });
    await broken.connect();
    reg.register(web);
    reg.register(broken);
    const results = await reg.broadcast({ text: "test", sender: "sys" });
    // Web succede, telegram fallisce silenziosamente
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((m) => m.channelId === "web")).toBe(true);
  });

  it("onAnyMessage riceve da tutti i canali registrati", async () => {
    const web = new WebChannel();
    const tg = mockTgChannel();
    reg.register(web);
    reg.register(tg);
    await web.connect();
    await tg.connect();
    const received: ChannelMessage[] = [];
    reg.onAnyMessage(async (m) => { received.push(m); });
    await web.receiveFromAPI({ text: "from web", sender: "u1" });
    await tg.receiveFromBot({ text: "from tg", sender: "u2", chatId: "123" });
    expect(received).toHaveLength(2);
    expect(received[0].channelId).toBe("web");
    expect(received[1].channelId).toBe("telegram");
  });

  it("onAnyMessage unsubscribe rimuove handler", async () => {
    const web = new WebChannel();
    reg.register(web);
    await web.connect();
    const received: string[] = [];
    const unsub = reg.onAnyMessage(async (m) => { received.push(m.text); });
    await web.receiveFromAPI({ text: "prima", sender: "u" });
    unsub();
    await web.receiveFromAPI({ text: "dopo", sender: "u" });
    expect(received).toEqual(["prima"]);
  });

  it("getDefaultRegistry singleton persiste tra chiamate", () => {
    const a = getDefaultRegistry();
    const b = getDefaultRegistry();
    expect(a).toBe(b);
    resetDefaultRegistry();
    expect(getDefaultRegistry()).not.toBe(a);
  });

  it("connectAll report contiene tutti i canali", async () => {
    reg.register(new WebChannel());
    reg.register(new TelegramChannel({ chatId: "ok" }));
    const report = await reg.connectAll();
    expect(report.connected).toContain("web");
    expect(report.connected).toContain("telegram");
    expect(report.errors).toHaveLength(0);
  });
});

describe("WebChannel — dispatch avanzato", () => {
  let web: WebChannel;
  beforeEach(() => { web = new WebChannel({ maxQueueSize: 10 }); });

  it("drainOutbound con clear=false non svuota", async () => {
    await web.connect();
    await web.send({ text: "msg1", sender: "bot" });
    const first = web.drainOutbound({ clear: false });
    expect(first).toHaveLength(1);
    expect(web.queueSize).toBe(1);
    const second = web.drainOutbound();
    expect(second).toHaveLength(1);
    expect(web.queueSize).toBe(0);
  });

  it("handler multipli ricevono tutti lo stesso messaggio", async () => {
    await web.connect();
    const r1: string[] = [];
    const r2: string[] = [];
    web.onMessage(async (m) => { r1.push(m.text); });
    web.onMessage(async (m) => { r2.push(m.text); });
    await web.receiveFromAPI({ text: "multi", sender: "u" });
    expect(r1).toEqual(["multi"]);
    expect(r2).toEqual(["multi"]);
  });

  it("disconnect svuota handlers e coda", async () => {
    await web.connect();
    const r: string[] = [];
    web.onMessage(async (m) => { r.push(m.text); });
    await web.send({ text: "queued", sender: "bot" });
    await web.disconnect();
    expect(web.queueSize).toBe(0);
    expect(web.connected).toBe(false);
  });
});

describe("TelegramChannel — dispatch avanzato", () => {
  it("receiveFromBot propaga meta chatId e messageId", async () => {
    const tg = mockTgChannel("999");
    await tg.connect();
    const received: ChannelMessage[] = [];
    tg.onMessage(async (m) => { received.push(m); });
    await tg.receiveFromBot({ text: "hi", sender: "mario", chatId: "999", messageId: 77 });
    expect(received[0].meta).toEqual({ chatId: "999", messageId: 77 });
  });

  it("handler multipli su telegram ricevono tutti", async () => {
    const tg = mockTgChannel();
    await tg.connect();
    const r1: string[] = [];
    const r2: string[] = [];
    tg.onMessage(async (m) => { r1.push(m.text); });
    tg.onMessage(async (m) => { r2.push(m.text); });
    await tg.receiveFromBot({ text: "both", sender: "u", chatId: "123" });
    expect(r1).toEqual(["both"]);
    expect(r2).toEqual(["both"]);
  });
});
