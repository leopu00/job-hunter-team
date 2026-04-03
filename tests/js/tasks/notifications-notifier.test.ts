import { describe, it, expect, beforeEach } from "vitest";
import {
  subscribe, unsubscribe, getSubscription, findSubscription,
  listSubscriptions, listSubscriptionsByChannel,
  pruneOneShot, subscriptionCount, clearSubscriptions,
} from "../../../shared/notifications/notifier.js";

beforeEach(() => clearSubscriptions());

describe("subscribe", () => {
  it("crea sottoscrizione persistente di default", () => {
    const sub = subscribe("desktop", "user-1");
    expect(sub.id).toBeTruthy();
    expect(sub.channel).toBe("desktop");
    expect(sub.target).toBe("user-1");
    expect(sub.mode).toBe("persistent");
  });

  it("crea sottoscrizione one-shot", () => {
    const sub = subscribe("telegram", "chat-123", { mode: "once" });
    expect(sub.mode).toBe("once");
  });

  it("riusa sottoscrizione esistente per stesso canale+target", () => {
    const a = subscribe("desktop", "user-1");
    const b = subscribe("desktop", "user-1");
    expect(a.id).toBe(b.id);
  });

  it("aggiorna mode di sottoscrizione esistente", () => {
    subscribe("desktop", "user-1", { mode: "persistent" });
    const updated = subscribe("desktop", "user-1", { mode: "once" });
    expect(updated.mode).toBe("once");
  });
});

describe("unsubscribe / getSubscription", () => {
  it("rimuove sottoscrizione", () => {
    const sub = subscribe("web", "endpoint-1");
    expect(unsubscribe(sub.id)).toBe(true);
    expect(getSubscription(sub.id)).toBeUndefined();
  });

  it("ritorna false per id inesistente", () => {
    expect(unsubscribe("fake")).toBe(false);
  });
});

describe("findSubscription", () => {
  it("trova per canale e target", () => {
    subscribe("telegram", "chat-456");
    const found = findSubscription("telegram", "chat-456");
    expect(found).toBeDefined();
    expect(found!.target).toBe("chat-456");
  });

  it("ritorna undefined se non trovata", () => {
    expect(findSubscription("desktop", "nope")).toBeUndefined();
  });
});

describe("listSubscriptions", () => {
  it("filtra per canale", () => {
    subscribe("desktop", "u1");
    subscribe("telegram", "u2");
    subscribe("desktop", "u3");
    expect(listSubscriptions({ channel: "desktop" })).toHaveLength(2);
  });

  it("filtra per userId", () => {
    subscribe("desktop", "t1", { userId: "alice" });
    subscribe("telegram", "t2", { userId: "bob" });
    subscribe("web", "t3", { userId: "alice" });
    expect(listSubscriptions({ userId: "alice" })).toHaveLength(2);
  });
});

describe("listSubscriptionsByChannel", () => {
  it("lista solo sottoscrizioni del canale", () => {
    subscribe("web", "e1");
    subscribe("web", "e2");
    subscribe("desktop", "d1");
    expect(listSubscriptionsByChannel("web")).toHaveLength(2);
  });
});

describe("pruneOneShot", () => {
  it("rimuove solo sottoscrizioni one-shot", () => {
    subscribe("desktop", "u1", { mode: "persistent" });
    subscribe("telegram", "u2", { mode: "once" });
    subscribe("web", "u3", { mode: "once" });
    const removed = pruneOneShot();
    expect(removed).toBe(2);
    expect(subscriptionCount()).toBe(1);
  });
});

describe("subscriptionCount", () => {
  it("conta tutte le sottoscrizioni", () => {
    subscribe("desktop", "u1");
    subscribe("telegram", "u2");
    expect(subscriptionCount()).toBe(2);
  });

  it("conta per canale specifico", () => {
    subscribe("desktop", "u1");
    subscribe("desktop", "u2");
    subscribe("telegram", "u3");
    expect(subscriptionCount("desktop")).toBe(2);
  });
});
