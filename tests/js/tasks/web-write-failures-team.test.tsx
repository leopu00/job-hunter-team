// @vitest-environment jsdom
/**
 * Le pagine che comandano il team dicono quando una scrittura NON è riuscita,
 * nella lingua della pagina, e non fingono di averla fatta.
 *
 * Seguito di web-write-failures.test.tsx (BACKLOG [WEB-WRITES-UNCHECKED-OR-RAW]):
 * - messaggio a un agente: la risposta di /api/team/send non veniva letta,
 *   quindi un 4xx o un 500 lasciava il messaggio in chat come inviato;
 * - orari di lavoro: il corpo grezzo della route a schermo;
 * - cron: attiva/pausa e cancella cambiavano la lista senza guardare la
 *   risposta, e la creazione mostrava il `error` della route.
 *
 * Gira il codice vero dei componenti con una route finta per metodo e percorso.
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

import AgentInteraction from "../../../web/app/components/AgentInteraction";
import WorkHoursPicker from "../../../web/app/components/WorkHoursPicker";
import { ToastProvider } from "../../../web/app/components/Toast";
import CronPage from "../../../web/app/(protected)/cron/page";

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

function button(label: RegExp) {
  return [...container.querySelectorAll("button")].find((b) => label.test(b.textContent ?? ""));
}

const READ_ONLY = "This cannot be changed from here: do it from the app on the computer where the team runs.";
const SERVER = "Server error, try again shortly.";

describe("message to an agent", () => {
  async function openChat() {
    route("GET /api/team/status", json({ agents: [{ session: "SCOUT-1" }] }));
    await open(createElement(AgentInteraction, { sessionPrefix: "SCOUT", color: "#0f0", label: "Scout" }));
    const input = container.querySelector<HTMLInputElement>('input[type="text"]');
    expect(input?.placeholder).toBe("Message to SCOUT-1...");
    return input!;
  }

  it.each([
    ["a 500", json({ error: "send failed" }, 500), SERVER],
    ["the read-only web", json({ error: "read_only" }, 403), READ_ONLY],
    ["a 200 that is not the route", new Response("<html>proxy</html>", { status: 200 }), SERVER],
    ["the network", new Error("offline"), "Network error: check your connection."],
  ])("%s: the message is NOT in the chat as sent, the text stays in the box", async (_case, answer, reason) => {
    const input = await openChat();
    route("POST /api/team/send", answer);
    await type(input, "ciao scout");
    await click(button(/^send$/));
    expect(calls.map((c) => c.key)).toContain("POST /api/team/send");
    expect(input.value).toBe("ciao scout");
    expect(container.textContent).toContain(`Error: message not sent. ${reason}`);
    expect(container.textContent).not.toMatch(/send failed|read_only|proxy/);
    const bubbles = container.textContent!.split("Error: message not sent.")[0];
    expect(bubbles).not.toContain("ciao scout");
  });

  it("with { ok: true } the message is in the chat and the box is empty", async () => {
    const input = await openChat();
    route("POST /api/team/send", json({ ok: true }));
    await type(input, "ciao scout");
    await click(button(/^send$/));
    expect(input.value).toBe("");
    expect(container.textContent).toContain("ciao scout");
    expect(container.textContent).not.toContain("message not sent");
  });
});

describe("working hours", () => {
  async function openPicker() {
    route("GET /api/team/working-hours", json({ working_hours: null, preview: null, editable: true }));
    await open(createElement(ToastProvider, null, createElement(WorkHoursPicker)));
  }

  it.each([
    ["the read-only web", json({ error: "read_only" }, 403), READ_ONLY],
    ["a validation error", json({ error: "validation_error", details: {} }, 400), "Invalid data: check the fields."],
    ["a 200 that did not save", json({ working_hours: null }), SERVER],
  ])("%s: the change is NOT saved, with the reason and never the route's body", async (_case, answer, reason) => {
    await openPicker();
    route("PUT /api/team/working-hours", answer);
    await click(button(/Office \(Mon-Fri 9-18\)/));
    expect(calls.map((c) => c.key)).toContain("PUT /api/team/working-hours");
    expect(alerts().join(" ")).toContain(`Working hours change NOT saved: ${reason}`);
    expect(alerts().join(" ")).not.toMatch(/read_only|validation_error/);
    expect(document.body.textContent).not.toContain("Working hours saved");
  });

  it("with { saved: true } it says saved", async () => {
    await openPicker();
    route(
      "PUT /api/team/working-hours",
      json({ working_hours: { enabled: true, timezone: "Europe/Rome" }, preview: null, saved: true }),
    );
    await click(button(/Office \(Mon-Fri 9-18\)/));
    expect(document.body.textContent).toContain("Working hours saved");
    expect(alerts().join(" ")).not.toContain("NOT saved");
  });
});

describe("cron jobs", () => {
  const job = {
    id: "j1",
    name: "scout-linkedin",
    enabled: true,
    createdAtMs: 0,
    updatedAtMs: 0,
    schedule: { kind: "every", everyMs: 1_800_000 },
    payload: { kind: "command", command: "jht scout run" },
    state: {},
  };

  async function openCron() {
    route("GET /api/cron", json({ jobs: [job] }));
    await open(createElement(CronPage));
    expect(container.textContent).toContain("scout-linkedin");
  }

  it("a refused pause leaves the job running and says why", async () => {
    await openCron();
    route("PATCH /api/cron/j1", json({ error: "job non trovato" }, 403));
    await click(button(/^pause$/));
    expect(alerts()).toContain(`Job NOT updated: ${READ_ONLY}`);
    expect(button(/^pause$/)).toBeTruthy();
    expect(container.textContent).not.toContain("non trovato");
  });

  it("a failed delete keeps the job and says why; { ok: true } removes it", async () => {
    await openCron();
    route("DELETE /api/cron/j1", json({ error: "boom" }, 500));
    await click(button(/delete/));
    expect(alerts()).toContain(`Job NOT deleted: ${SERVER}`);
    expect(container.textContent).toContain("scout-linkedin");
    route("DELETE /api/cron/j1", json({ ok: true }));
    route("GET /api/cron", json({ jobs: [] }));
    await click(button(/delete/));
    expect(alerts()).toEqual([]);
    expect(container.textContent).not.toContain("scout-linkedin");
  });

  it("a refused creation keeps the form and never shows the route's text", async () => {
    route("GET /api/cron", json({ jobs: [] }));
    await open(createElement(CronPage));
    await click(button(/New job/));
    await type(container.querySelector<HTMLInputElement>('input[placeholder="scout-linkedin"]'), "nightly");
    await type(container.querySelector<HTMLInputElement>('input[placeholder="jht scout run"]'), "jht scout run");
    route("POST /api/cron", json({ ok: false, error: "job già esistente" }));
    await click(button(/^Create job$/));
    expect(alerts()).toContain(`Job NOT created: ${SERVER}`);
    expect(container.textContent).not.toContain("già esistente");
    expect(container.querySelector<HTMLInputElement>('input[placeholder="scout-linkedin"]')?.value).toBe("nightly");
  });
});
