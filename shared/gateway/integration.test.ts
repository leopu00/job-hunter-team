/**
 * Test di integrazione — Flow completo config → provider → gateway → channel.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Gateway, createGateway } from "./gateway.js";
import type { ChannelHandler, ProviderHandler } from "./router.js";
import type { ChannelId, GatewayEvent, GatewayMessage, GatewayResponse } from "./types.js";

type MockProviderConfig = { name: string; model: string; apiKey: string };
type MockConfig = {
  activeProvider: string;
  providers: Record<string, MockProviderConfig>;
  channels: ChannelId[];
};

function createMockConfig(): MockConfig {
  return {
    activeProvider: "claude",
    providers: {
      claude: { name: "claude", model: "claude-opus-4-6", apiKey: "sk-test" },
      openai: { name: "openai", model: "gpt-4o", apiKey: "sk-oai-test" },
    },
    channels: ["web", "cli"],
  };
}

function createMockProvider(config: MockProviderConfig): ProviderHandler {
  let callCount = 0;
  return {
    name: config.name,
    chat: async (msg: GatewayMessage): Promise<GatewayResponse> => {
      callCount++;
      return {
        id: `resp-${callCount}`,
        messageId: msg.id,
        content: `[${config.model}] Risposta a: ${msg.content}`,
        role: "assistant",
        timestamp: new Date(),
        streaming: false,
        usage: { inputTokens: msg.content.length, outputTokens: 20 },
      };
    },
  };
}

function createMockChannel(id: ChannelId): ChannelHandler & {
  sent: GatewayResponse[];
  connected: boolean;
} {
  const sent: GatewayResponse[] = [];
  let connected = false;
  return {
    id,
    sent,
    get connected() { return connected; },
    connect: async () => { connected = true; },
    disconnect: async () => { connected = false; },
    send: async (r: GatewayResponse) => { sent.push(r); },
    status: () => ({ id, connected }),
  };
}

function mockMessage(channel: ChannelId, content: string): GatewayMessage {
  return {
    id: `msg-${Date.now()}`,
    channel,
    role: "user",
    content,
    timestamp: new Date(),
  };
}

describe("Integration: config → provider → gateway → channel", () => {
  let config: MockConfig;
  let gw: Gateway;
  let webChannel: ReturnType<typeof createMockChannel>;
  let cliChannel: ReturnType<typeof createMockChannel>;

  beforeEach(() => {
    config = createMockConfig();
    gw = createGateway({ channels: config.channels });
    webChannel = createMockChannel("web");
    cliChannel = createMockChannel("cli");
    gw.router.registerChannel(webChannel);
    gw.router.registerChannel(cliChannel);
    gw.router.setProvider(createMockProvider(config.providers[config.activeProvider]));
  });

  it("bootstrap: config carica provider e canali", () => {
    assert.equal(gw.router.getProvider()?.name, "claude");
    assert.equal(gw.router.listChannels().length, 2);
  });

  it("flow completo: web → provider → risposta → web", async () => {
    await gw.start();
    const msg = mockMessage("web", "Ciao team!");
    const resp = await gw.handleMessage(msg);

    assert.ok(resp.content.includes("claude-opus-4-6"));
    assert.ok(resp.content.includes("Ciao team!"));
    assert.equal(webChannel.sent.length, 1);
    assert.equal(cliChannel.sent.length, 0);
    await gw.stop();
  });

  it("flow CLI: messaggio da CLI arriva solo a CLI", async () => {
    await gw.start();
    const resp = await gw.handleMessage(mockMessage("cli", "status"));

    assert.equal(cliChannel.sent.length, 1);
    assert.equal(webChannel.sent.length, 0);
    assert.ok(resp.content.includes("status"));
    await gw.stop();
  });

  it("switch provider: cambiare provider cambia le risposte", async () => {
    await gw.start();

    // Prima con Claude
    const r1 = await gw.handleMessage(mockMessage("web", "test"));
    assert.ok(r1.content.includes("claude-opus-4-6"));

    // Switch a OpenAI
    const oaiCfg = config.providers["openai"];
    gw.router.setProvider(createMockProvider(oaiCfg));
    const r2 = await gw.handleMessage(mockMessage("web", "test"));
    assert.ok(r2.content.includes("gpt-4o"));

    await gw.stop();
  });

  it("token usage viene tracciato nella risposta", async () => {
    await gw.start();
    const resp = await gw.handleMessage(mockMessage("web", "hello"));

    assert.ok(resp.usage);
    assert.equal(resp.usage!.inputTokens, 5); // "hello".length
    assert.equal(resp.usage!.outputTokens, 20);
    await gw.stop();
  });

  it("middleware pre modifica messaggio prima del provider", async () => {
    gw.middleware.register({
      name: "prefix", phase: "pre", priority: 50,
      handler: async (ctx) => {
        ctx.message = { ...ctx.message, content: `[FILTRATO] ${ctx.message.content}` };
        return ctx;
      },
    });
    await gw.start();
    const resp = await gw.handleMessage(mockMessage("web", "ciao"));
    assert.ok(resp.content.includes("[FILTRATO] ciao"));
    await gw.stop();
  });

  it("middleware post modifica risposta prima del canale", async () => {
    gw.middleware.register({
      name: "suffix", phase: "post", priority: 50,
      handler: async (ctx) => {
        if (ctx.response) {
          ctx.response = { ...ctx.response, content: ctx.response.content + " [VERIFICATO]" };
        }
        return ctx;
      },
    });
    await gw.start();
    await gw.handleMessage(mockMessage("web", "test"));
    assert.ok(webChannel.sent[0].content.endsWith("[VERIFICATO]"));
    await gw.stop();
  });

  it("eventi coprono l'intero ciclo di vita", async () => {
    const events: GatewayEvent[] = [];
    gw.onEvent((e) => events.push(e));
    await gw.start();
    await gw.handleMessage(mockMessage("web", "ping"));
    await gw.stop();

    const types = events.map((e) => e.type);
    assert.deepEqual(types, [
      "channel.connected",
      "message.received",
      "response.started",
      "response.completed",
      "channel.disconnected",
    ]);
  });

  it("messaggi multipli su canali diversi in sequenza", async () => {
    await gw.start();
    await gw.handleMessage(mockMessage("web", "msg1"));
    await gw.handleMessage(mockMessage("cli", "msg2"));
    await gw.handleMessage(mockMessage("web", "msg3"));

    assert.equal(webChannel.sent.length, 2);
    assert.equal(cliChannel.sent.length, 1);
    await gw.stop();
  });
});
