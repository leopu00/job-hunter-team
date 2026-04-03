/**
 * Test cross-modulo — Templates + Notifications
 *
 * Verifica integrazione: template genera body notifica,
 * broadcast con template, adapter riceve contenuto renderizzato.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  substituteVariables, extractVariableNames, hasVariables,
  createSection, composePrompt, renderTemplate, formatContextFile,
} from "../../../shared/templates/template-engine.js";
import {
  registerAdapter, clearAdapters, createNotification,
  send, broadcast, onNotificationEvent,
} from "../../../shared/notifications/registry.js";
import {
  subscribe, clearSubscriptions, listSubscriptionsByChannel,
  pruneOneShot, subscriptionCount,
} from "../../../shared/notifications/notifier.js";
import type { Notification, NotificationAdapter, NotificationResult } from "../../../shared/notifications/types.js";

let sentPayloads: Notification[] = [];

function spyAdapter(channel: "desktop" | "telegram" | "web", available = true): NotificationAdapter {
  return {
    channel, isAvailable: () => available,
    send: async (n: Notification): Promise<NotificationResult> => {
      sentPayloads.push(n);
      return { channel, success: true, messageId: `msg-${n.id}`, sentAtMs: Date.now() };
    },
  };
}

beforeEach(() => { clearAdapters(); clearSubscriptions(); sentPayloads = []; });

describe("Template → Notifica (render + send)", () => {
  it("renderTemplate genera body e send lo consegna all'adapter", async () => {
    registerAdapter(spyAdapter("desktop"));
    const body = renderTemplate("Job {titolo} trovato per {utente}", { titolo: "Backend Dev", utente: "Leo" });
    const n = createNotification("desktop", "Nuovo Job", body);
    const result = await send(n);
    expect(result.success).toBe(true);
    expect(sentPayloads[0].body).toBe("Job Backend Dev trovato per Leo");
  });

  it("substituteVariables case-insensitive nel body notifica", async () => {
    registerAdapter(spyAdapter("telegram"));
    const body = substituteVariables("Agente {NOME} ha completato {Task}", { nome: "scout", task: "ricerca" });
    const n = createNotification("telegram", "Completamento", body, { agentId: "scout" });
    await send(n);
    expect(sentPayloads[0].body).toBe("Agente scout ha completato ricerca");
    expect(sentPayloads[0].agentId).toBe("scout");
  });

  it("variabili non risolte restano nel body notifica", async () => {
    registerAdapter(spyAdapter("web"));
    const body = renderTemplate("Status: {stato}, Dettaglio: {dettaglio}", { stato: "completato" });
    const n = createNotification("web", "Report", body);
    await send(n);
    expect(sentPayloads[0].body).toContain("completato");
    expect(sentPayloads[0].body).toContain("{dettaglio}");
  });

  it("extractVariableNames identifica variabili per meta notifica", () => {
    const template = "Agente {agente} su sessione {session_id}: {messaggio}";
    const vars = extractVariableNames(template);
    expect(vars).toContain("agente");
    expect(vars).toContain("session_id");
    expect(vars).toContain("messaggio");
    const n = createNotification("desktop", "Info", "body", { meta: { templateVars: vars } });
    expect((n.meta as any).templateVars).toHaveLength(3);
  });

  it("hasVariables filtra template prima di render + notifica", async () => {
    registerAdapter(spyAdapter("desktop"));
    const tpl = "Messaggio statico senza variabili";
    const body = hasVariables(tpl) ? renderTemplate(tpl, {}) : tpl;
    const n = createNotification("desktop", "Statico", body);
    await send(n);
    expect(sentPayloads[0].body).toBe("Messaggio statico senza variabili");
  });
});

describe("composePrompt → Notifica (sezioni + budget)", () => {
  it("composePrompt con sezioni prioritizzate genera body notifica", async () => {
    registerAdapter(spyAdapter("desktop"));
    const result = composePrompt({
      sections: [
        createSection("header", "Nuovi job trovati: 5", 90),
        createSection("detail", "Backend, Frontend, DevOps", 50),
      ],
    });
    const n = createNotification("desktop", "Report", result.text, { priority: "high" });
    await send(n);
    expect(sentPayloads[0].body).toContain("Nuovi job trovati: 5");
    expect(sentPayloads[0].body).toContain("Backend, Frontend, DevOps");
    expect(sentPayloads[0].priority).toBe("high");
  });

  it("composePrompt minimal esclude sezioni bassa priorita dal body", async () => {
    registerAdapter(spyAdapter("telegram"));
    const result = composePrompt({
      mode: "minimal",
      sections: [
        createSection("urgent", "ERRORE CRITICO", 90),
        createSection("info", "Dettagli extra", 30),
      ],
    });
    const n = createNotification("telegram", "Alert", result.text, { priority: "urgent" });
    await send(n);
    expect(sentPayloads[0].body).toContain("ERRORE CRITICO");
    expect(sentPayloads[0].body).not.toContain("Dettagli extra");
  });

  it("composePrompt con maxChars genera notifica body troncato", async () => {
    registerAdapter(spyAdapter("web"));
    const result = composePrompt({
      maxChars: 40,
      sections: [createSection("big", "A".repeat(100), 90)],
    });
    const n = createNotification("web", "Troncato", result.text);
    await send(n);
    expect(sentPayloads[0].body.length).toBeLessThanOrEqual(100);
  });

  it("composePrompt applica variabili + context file nel body notifica", async () => {
    registerAdapter(spyAdapter("desktop"));
    const result = composePrompt({
      sections: [createSection("greet", "Ciao {nome}, ecco il contesto:", 80)],
      variables: { nome: "Leo" },
      contextFiles: [{ path: "job.md", content: "Backend Developer @Roma" }],
    });
    const n = createNotification("desktop", "Contesto", result.text);
    await send(n);
    expect(sentPayloads[0].body).toContain("Ciao Leo");
    expect(sentPayloads[0].body).toContain("Backend Developer @Roma");
  });

  it("formatContextFile nel meta della notifica", async () => {
    registerAdapter(spyAdapter("telegram"));
    const ctx = formatContextFile({ path: "cv.md", content: "Esperienza: 5 anni" });
    const n = createNotification("telegram", "CV", "Allegato", { meta: { context: ctx } });
    await send(n);
    expect((sentPayloads[0].meta as any).context).toContain("cv.md");
  });
});

describe("Broadcast con Template", () => {
  it("broadcast invia body template a tutti i canali", async () => {
    registerAdapter(spyAdapter("desktop"));
    registerAdapter(spyAdapter("telegram"));
    registerAdapter(spyAdapter("web"));
    const body = renderTemplate("Alert: {tipo} alle {ora}", { tipo: "nuovo job", ora: "14:30" });
    const results = await broadcast("Alert Team", body);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);
    expect(sentPayloads.every((p) => p.body === "Alert: nuovo job alle 14:30")).toBe(true);
  });

  it("broadcast canali specifici con template composto", async () => {
    registerAdapter(spyAdapter("desktop"));
    registerAdapter(spyAdapter("telegram"));
    const composed = composePrompt({
      sections: [createSection("s1", "Sintesi: 3 candidature inviate", 90)],
    });
    const results = await broadcast("Report", composed.text, { channels: ["desktop"] });
    expect(results).toHaveLength(1);
    expect(sentPayloads[0].channel).toBe("desktop");
    expect(sentPayloads[0].body).toContain("3 candidature inviate");
  });

  it("broadcast emette evento notification.broadcast con body template", async () => {
    registerAdapter(spyAdapter("desktop"));
    const events: string[] = [];
    const unsub = onNotificationEvent((e) => events.push(e.type));
    const body = renderTemplate("Batch {n} completato", { n: "42" });
    await broadcast("Batch", body);
    expect(events).toContain("notification.sent");
    expect(events).toContain("notification.broadcast");
    unsub();
  });

  it("broadcast con adapter non disponibile emette failed per quel canale", async () => {
    registerAdapter(spyAdapter("desktop", true));
    registerAdapter(spyAdapter("telegram", false));
    const events: string[] = [];
    onNotificationEvent((e) => events.push(`${e.type}:${e.notification.channel}`));
    const body = renderTemplate("Test {x}", { x: "fallimento" });
    const results = await broadcast("Test", body, { channels: ["desktop", "telegram"] });
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(events).toContain("notification.sent:desktop");
    expect(events).toContain("notification.failed:telegram");
  });
});

describe("Subscription + Template Notification", () => {
  it("subscribe canale → send notifica con template body", async () => {
    registerAdapter(spyAdapter("desktop"));
    subscribe("desktop", "user-leo", { userId: "leo" });
    const subs = listSubscriptionsByChannel("desktop");
    expect(subs).toHaveLength(1);
    const body = renderTemplate("Ciao {nome}, hai {n} nuovi job", { nome: "Leo", n: "7" });
    const n = createNotification("desktop", "Aggiornamento", body, { sessionId: "s-1" });
    const result = await send(n);
    expect(result.success).toBe(true);
    expect(sentPayloads[0].body).toBe("Ciao Leo, hai 7 nuovi job");
  });

  it("one-shot subscription + template → pruneOneShot dopo invio", async () => {
    registerAdapter(spyAdapter("telegram"));
    subscribe("telegram", "chat-99", { mode: "once", userId: "guest" });
    expect(subscriptionCount("telegram")).toBe(1);
    const body = renderTemplate("Benvenuto {nome}!", { nome: "Guest" });
    const n = createNotification("telegram", "Welcome", body);
    await send(n);
    expect(sentPayloads[0].body).toBe("Benvenuto Guest!");
    const removed = pruneOneShot();
    expect(removed).toBe(1);
    expect(subscriptionCount("telegram")).toBe(0);
  });

  it("subscribe multi-canale + broadcast template a tutti", async () => {
    registerAdapter(spyAdapter("desktop"));
    registerAdapter(spyAdapter("telegram"));
    subscribe("desktop", "user-a", { userId: "a" });
    subscribe("telegram", "chat-a", { userId: "a" });
    const body = renderTemplate("Job {id} aggiornato: {stato}", { id: "J-100", stato: "intervista" });
    const results = await broadcast("Update", body);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
    expect(sentPayloads.every((p) => p.body.includes("J-100"))).toBe(true);
  });

  it("composePrompt mode none → body vuoto, notifica inviata comunque", async () => {
    registerAdapter(spyAdapter("desktop"));
    const composed = composePrompt({ mode: "none", sections: [createSection("x", "testo", 90)] });
    expect(composed.text).toBe("");
    const n = createNotification("desktop", "Vuoto", composed.text);
    const result = await send(n);
    expect(result.success).toBe(true);
    expect(sentPayloads[0].body).toBe("");
  });

  it("renderTemplate con variabili agente popola notifica completa", async () => {
    registerAdapter(spyAdapter("telegram"));
    subscribe("telegram", "chat-ops", { userId: "ops" });
    const vars = { agente: "scout", sessione: "s-42", azione: "ricerca completata" };
    const body = renderTemplate("[{agente}] sessione {sessione}: {azione}", vars);
    const n = createNotification("telegram", "Agent Event", body, {
      agentId: vars.agente, sessionId: vars.sessione, meta: { action: vars.azione },
    });
    const result = await send(n);
    expect(result.success).toBe(true);
    expect(sentPayloads[0].body).toBe("[scout] sessione s-42: ricerca completata");
    expect(sentPayloads[0].agentId).toBe("scout");
    expect(sentPayloads[0].sessionId).toBe("s-42");
  });

  it("pipeline completa: compose → subscribe → broadcast → prune", async () => {
    registerAdapter(spyAdapter("desktop"));
    registerAdapter(spyAdapter("web"));
    subscribe("desktop", "u1", { mode: "persistent" });
    subscribe("web", "endpoint-1", { mode: "once" });
    const composed = composePrompt({
      sections: [
        createSection("title", "Report giornaliero {data}", 90),
        createSection("body", "{n} candidature, {m} risposte", 50),
      ],
      variables: { data: "2026-04-04", n: "12", m: "3" },
    });
    const results = await broadcast("Daily", composed.text);
    expect(results).toHaveLength(2);
    expect(sentPayloads[0].body).toContain("Report giornaliero 2026-04-04");
    expect(sentPayloads[0].body).toContain("12 candidature, 3 risposte");
    const pruned = pruneOneShot();
    expect(pruned).toBe(1);
    expect(subscriptionCount()).toBe(1);
  });
});
