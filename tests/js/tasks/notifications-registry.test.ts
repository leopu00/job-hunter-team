import { describe, it, expect, beforeEach } from "vitest";
import {
  registerAdapter, unregisterAdapter, getAdapter, listAdapters,
  listAvailableChannels, clearAdapters, createNotification,
  send, broadcast, onNotificationEvent,
} from "../../../shared/notifications/registry.js";
import type { NotificationAdapter, Notification, NotificationResult } from "../../../shared/notifications/types.js";

function mockAdapter(channel: "desktop" | "telegram" | "web", available = true): NotificationAdapter {
  return {
    channel,
    isAvailable: () => available,
    send: async (n: Notification): Promise<NotificationResult> => ({
      channel, success: true, messageId: `msg-${n.id}`, sentAtMs: Date.now(),
    }),
  };
}

beforeEach(() => clearAdapters());

describe("registerAdapter / getAdapter", () => {
  it("registra e recupera un adapter", () => {
    const adapter = mockAdapter("desktop");
    registerAdapter(adapter);
    expect(getAdapter("desktop")).toBe(adapter);
  });

  it("ritorna undefined per adapter non registrato", () => {
    expect(getAdapter("telegram")).toBeUndefined();
  });
});

describe("unregisterAdapter", () => {
  it("rimuove un adapter registrato", () => {
    registerAdapter(mockAdapter("web"));
    expect(unregisterAdapter("web")).toBe(true);
    expect(getAdapter("web")).toBeUndefined();
  });

  it("ritorna false per adapter inesistente", () => {
    expect(unregisterAdapter("desktop")).toBe(false);
  });
});

describe("listAdapters / listAvailableChannels", () => {
  it("lista tutti gli adapter registrati", () => {
    registerAdapter(mockAdapter("desktop"));
    registerAdapter(mockAdapter("telegram"));
    expect(listAdapters()).toHaveLength(2);
  });

  it("filtra solo canali disponibili", () => {
    registerAdapter(mockAdapter("desktop", true));
    registerAdapter(mockAdapter("telegram", false));
    const available = listAvailableChannels();
    expect(available).toEqual(["desktop"]);
  });
});

describe("createNotification", () => {
  it("crea notifica con valori default", () => {
    const n = createNotification("desktop", "Titolo", "Corpo");
    expect(n.id).toBeTruthy();
    expect(n.channel).toBe("desktop");
    expect(n.title).toBe("Titolo");
    expect(n.body).toBe("Corpo");
    expect(n.priority).toBe("normal");
    expect(n.timestamp).toBeGreaterThan(0);
  });

  it("crea notifica con opzioni personalizzate", () => {
    const n = createNotification("telegram", "T", "B", {
      priority: "urgent", agentId: "scout", meta: { key: "val" },
    });
    expect(n.priority).toBe("urgent");
    expect(n.agentId).toBe("scout");
    expect(n.meta).toEqual({ key: "val" });
  });
});

describe("send", () => {
  it("invia con successo tramite adapter disponibile", async () => {
    registerAdapter(mockAdapter("desktop"));
    const n = createNotification("desktop", "Test", "Body");
    const result = await send(n);
    expect(result.success).toBe(true);
    expect(result.messageId).toContain("msg-");
  });

  it("fallisce se adapter non disponibile", async () => {
    registerAdapter(mockAdapter("telegram", false));
    const n = createNotification("telegram", "T", "B");
    const result = await send(n);
    expect(result.success).toBe(false);
    expect(result.error).toContain("non disponibile");
  });

  it("fallisce se nessun adapter registrato per il canale", async () => {
    const n = createNotification("web", "T", "B");
    const result = await send(n);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Nessun adapter");
  });

  it("emette evento notification.sent su successo", async () => {
    registerAdapter(mockAdapter("desktop"));
    const events: string[] = [];
    onNotificationEvent((e) => events.push(e.type));
    const n = createNotification("desktop", "T", "B");
    await send(n);
    expect(events).toContain("notification.sent");
  });
});

describe("broadcast", () => {
  it("invia a tutti i canali disponibili", async () => {
    registerAdapter(mockAdapter("desktop"));
    registerAdapter(mockAdapter("telegram"));
    const results = await broadcast("Alert", "Messaggio");
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
  });

  it("invia solo ai canali specificati", async () => {
    registerAdapter(mockAdapter("desktop"));
    registerAdapter(mockAdapter("telegram"));
    const results = await broadcast("A", "B", { channels: ["desktop"] });
    expect(results).toHaveLength(1);
    expect(results[0].channel).toBe("desktop");
  });
});
