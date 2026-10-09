// @vitest-environment jsdom
/**
 * Notifiche, canali, backup, export e provider dicono quando una scrittura NON
 * è riuscita, nella lingua della pagina, e non mostrano mai il corpo della
 * route (BACKLOG [WEB-WRITES-UNCHECKED-OR-RAW], secondo gruppo):
 * - notifiche e canali: la risposta non veniva letta, un rifiuto passava in
 *   silenzio (la lista si ricaricava, ma nessuno diceva che non era successo);
 * - backup ed export: il `error` grezzo della route a schermo, e qualunque 2xx
 *   preso per un backup fatto;
 * - provider: lo `stderr` dell'installatore o il `error` della route.
 *
 * Gira il codice vero delle pagine con una route finta per metodo e percorso.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => {
  const { createElement } = createRequire(
    path.resolve(__dirname, "../../../web/package.json"),
  )("react");
  return {
    default: ({ href, children, ...rest }: Record<string, unknown>) =>
      createElement("a", { href, ...rest }, children),
  };
});
vi.mock("@/app/hooks/useIsCloud", () => ({ useIsCloud: () => false }));

import NotificationsPage from "../../../web/app/(protected)/notifications/page";
import ChannelsPage from "../../../web/app/(protected)/channels/page";
import BackupPage from "../../../web/app/(protected)/backup/page";
import ExportPage from "../../../web/app/(protected)/export/page";
import ProvidersPage from "../../../web/app/(protected)/providers/page";

const REPO = path.resolve(__dirname, "../../..");
const webRequire = createRequire(path.join(REPO, "web/package.json"));
const { createElement, act } = webRequire("react");
const { createRoot } = webRequire("react-dom/client");

type Answer = Response | Error;
let routes: Record<string, Answer[]>;
let calls: { key: string; body?: string }[];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** `"METHOD /path"` → risposte in ordine; l'ultima si ripete. */
function route(key: string, ...answers: Answer[]) {
  routes[key] = answers;
}

let container: HTMLDivElement;
let root: { render(el: unknown): void; unmount(): void };

beforeEach(() => {
  routes = {};
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${String(input).split("?")[0]}`;
      calls.push({ key, body: typeof init?.body === "string" ? init.body : undefined });
      const list = routes[key];
      if (!list?.length) return json({}, 404);
      const next = list.length > 1 ? list.shift()! : list[0];
      if (next instanceof Error) throw next;
      return next.clone();
    }),
  );
  vi.stubGlobal("confirm", () => true);
  document.cookie = "NEXT_LOCALE=en";
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
  }
}

async function open(element: unknown) {
  await act(async () => {
    root.render(element);
  });
  await settle();
}

async function click(el: Element | null | undefined) {
  expect(el, "element not found").toBeTruthy();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

async function type(el: HTMLInputElement | null | undefined, value: string) {
  expect(el, "input not found").toBeTruthy();
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(el, value);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function alerts() {
  return [...document.querySelectorAll('[role="alert"]')].map((a) => a.textContent);
}

/** The LAST button that matches: the row's own, after the page's filters. */
function button(label: RegExp) {
  return [...container.querySelectorAll("button")]
    .filter((b) => label.test(b.textContent ?? "") || label.test(b.getAttribute("aria-label") ?? ""))
    .at(-1);
}

const READ_ONLY = "This cannot be changed from here: do it from the app on the computer where the team runs.";
const SERVER = "Server error, try again shortly.";

describe("notifications", () => {
  const notification = {
    id: "n1", type: "warning", priority: "normal", title: "Limit near", message: "80%",
    createdAt: Date.now(), read: false,
  };

  it.each([
    ["mark as read", /^read$/, "PATCH /api/notifications", "Notification NOT marked as read:"],
    ["delete", /Delete notification/, "DELETE /api/notifications", "Notification NOT deleted:"],
  ])("a refused %s says so, with the reason and never the route's text", async (_case, label, key, said) => {
    route("GET /api/notifications", json({ notifications: [notification], unreadCount: 1 }));
    await open(createElement(NotificationsPage));
    route(key, json({ ok: false, error: "notifica non trovata" }, 403));
    await click(button(label));
    expect(alerts()).toContain(`${said} ${READ_ONLY}`);
    expect(container.textContent).not.toContain("non trovata");
    expect(container.textContent).toContain("Limit near");
  });

  it("with { ok: true } no error is shown", async () => {
    route("GET /api/notifications", json({ notifications: [notification], unreadCount: 1 }));
    await open(createElement(NotificationsPage));
    route("PATCH /api/notifications", json({ ok: true, notification: { ...notification, read: true } }));
    await click(button(/^read$/));
    expect(alerts()).toEqual([]);
  });
});

describe("channels", () => {
  const channel = {
    id: "telegram", name: "Telegram", description: "bot", connected: true, enabled: true,
    capabilities: { markdown: true, streaming: false, attachments: true, push: true },
    stats: { messagesSent: 0, messagesReceived: 0, lastActivityAt: null, errors: 0 },
  };

  it("a refused toggle says the channel was NOT updated, and why", async () => {
    route("GET /api/channels", json({ channels: [channel], connectedCount: 1 }));
    await open(createElement(ChannelsPage));
    route("PUT /api/channels", json({ error: "Canale telegram non trovato" }, 404));
    await click(button(/Disable/));
    expect(calls.map((c) => c.key)).toContain("PUT /api/channels");
    expect(alerts()).toContain("Channel NOT updated: Item not found: reload the page.");
    expect(container.textContent).not.toContain("non trovato");
  });
});

describe("backup", () => {
  const backup = { id: "bk-20261009-0800", createdAt: Date.now(), sizeBytes: 2048, sources: ["db"], compressed: true };

  async function openBackup() {
    route("GET /api/backup", json({ backups: [backup], totalSize: 2048 }));
    await open(createElement(BackupPage));
  }

  it.each([
    ["create", /create backup/, "POST /api/backup", json({ error: "ENOSPC: no space left" }, 500), `Backup NOT created: ${SERVER}`],
    ["create, a 200 without the backup", /create backup/, "POST /api/backup", json({}), `Backup NOT created: ${SERVER}`],
    ["restore", /^restore$/, "PATCH /api/backup", json({ error: "restore: tar exited 2" }, 404), "Backup NOT restored: Item not found: reload the page."],
    ["delete", /^delete$/, "DELETE /api/backup", json({ error: "Backup non trovato" }, 403), `Backup NOT deleted: ${READ_ONLY}`],
  ])("%s: NOT done, with the reason and never the route's text", async (_case, label, key, answer, said) => {
    await openBackup();
    route(key, answer);
    await click(button(label));
    expect(calls.map((c) => c.key)).toContain(key);
    expect(alerts()).toContain(said);
    expect(container.textContent).not.toMatch(/ENOSPC|tar exited|non trovato/);
  });

  it("a delete the route confirms says deleted", async () => {
    await openBackup();
    route("DELETE /api/backup", json({ deleted: backup.id, remaining: 0 }));
    await click(button(/^delete$/));
    expect(alerts()).toContain("Backup deleted");
  });
});

describe("export", () => {
  it.each([
    ["a 500", json({ error: "SQLITE_BUSY: database is locked" }, 500), SERVER],
    ["the network", new Error("offline"), "Network error: check your connection."],
  ])("%s: NOT done, never the route's text", async (_case, answer, reason) => {
    await open(createElement(ExportPage));
    route("GET /api/export", answer);
    await click(button(/^Export$/));
    expect(alerts()).toContain(`Export NOT done: ${reason}`);
    expect(container.textContent).not.toContain("SQLITE_BUSY");
  });
});

describe("providers", () => {
  const provider = {
    id: "codex", label: "Codex", available: true, active: false, authMethod: "subscription",
    models: [], keySource: null, installedVersion: "0.1.0", targetVersion: "0.2.0", updateAvailable: true,
    updatable: true,
  };

  it.each([
    ["the installer's failure", json({ ok: false, stderr: "npm ERR! EACCES /jht_home/.npm-global" }, 500), SERVER],
    ["the read-only web", json({ error: "read_only" }, 403), READ_ONLY],
    ["the network", new Error("offline"), "Network error: check your connection."],
  ])("%s: the CLI is NOT updated, and stderr never reaches the page", async (_case, answer, reason) => {
    route("GET /api/providers", json({ providers: [provider], activeProvider: "codex", configLoaded: true }));
    await open(createElement(ProvidersPage));
    route("POST /api/providers", answer);
    await click(button(/Update/));
    expect(calls.map((c) => c.key)).toContain("POST /api/providers");
    expect(alerts()).toContain(`CLI NOT updated: ${reason}`);
    expect(container.textContent).not.toMatch(/npm ERR|EACCES|read_only/);
  });
});
