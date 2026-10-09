// @vitest-environment jsdom
/**
 * Chat dell'assistente, conversazioni con gli agenti e foto del profilo non
 * mostrano mai il corpo della route quando una scrittura non riesce
 * (BACKLOG [WEB-WRITES-UNCHECKED-OR-RAW], terzo gruppo):
 * - FloatingChat: il `error` della route come risposta dell'assistente;
 * - lib/messages-thread.ts: `postChat` e `postReply` rilanciavano il `error`
 *   della route (o `HTTP n`), che MessagesList e MessagesDrawer mostravano;
 * - ProfileStats: il `error` della route sotto la foto, in italiano.
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

import { readFileSync } from "node:fs";
import FloatingChat from "../../../web/app/components/FloatingChat";
import ProfileStats from "../../../web/app/components/ProfileStats";
import {
  postChat,
  postReply,
  threadWriteReason,
  ThreadWriteError,
} from "../../../web/lib/messages-thread";

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

const SERVER = "Server error, try again shortly.";

describe("assistant chat", () => {
  beforeEach(() => {
    // jsdom has no scrolling: the panel scrolls to the last message.
    Element.prototype.scrollTo = () => {};
  });

  it("a failed reply says why, never with the route's text", async () => {
    route("GET /api/ai-assistant", json({ configured: true, suggestions: [], model: "m" }));
    await open(createElement(FloatingChat));
    await click(container.querySelector('[aria-label="Open AI Assistant"]'));
    const input = container.querySelector<HTMLInputElement>('[aria-label="Write a message to the assistant"]');
    route("POST /api/ai-assistant", json({ error: "quota exceeded for key sk-abc" }, 500));
    await type(input, "help");
    await click(container.querySelector('[aria-label="Send message"]'));
    expect(calls.map((c) => c.key)).toContain("POST /api/ai-assistant");
    expect(container.textContent).toContain(`The chatbot was unable to respond at this time. ${SERVER}`);
    expect(container.textContent).not.toContain("sk-abc");
  });
});

describe("messages to the agents (lib/messages-thread)", () => {
  it.each([
    [json({ error: "riga non trovata" }, 404), 404],
    [json({ error: "Non autenticato" }, 401), 401],
    [new Error("offline"), null],
  ])("postChat and postReply throw the status, never the route's text (%#)", async (answer, status) => {
    route("POST /api/pending-messages", answer);
    route("POST /api/pending-messages/r1/reply", answer);
    for (const post of [() => postChat("capitano", "ciao"), () => postReply("r1", "ciao")]) {
      const error = await post().then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(ThreadWriteError);
      expect((error as ThreadWriteError).status).toBe(status);
      expect((error as Error).message).not.toMatch(/non trovata|autenticato/);
      expect(threadWriteReason("en", error)).not.toMatch(/non trovata|autenticato/);
    }
  });

  it("keeps only the route's codes the page turns into its own sentence", async () => {
    route("POST /api/pending-messages/r1/reply", json({ error: "closer_answer_not_exact_option" }, 409));
    const known = await postReply("r1", "remote").then(() => null, (e: unknown) => e);
    expect((known as ThreadWriteError).code).toBe("closer_answer_not_exact_option");
    route("POST /api/pending-messages/r1/reply", json({ error: "SQLITE_BUSY at /jht_home/jobs.db" }, 409));
    const other = await postReply("r1", "remote").then(() => null, (e: unknown) => e);
    expect((other as ThreadWriteError).code).toBeNull();
    expect((other as Error).message).toBe("HTTP 409");
  });

  it("the two chat surfaces say NOT sent and the reason, not the error's message", () => {
    for (const file of ["MessagesList.tsx", "MessagesDrawer.tsx"]) {
      const source = readFileSync(path.join(REPO, "web/app/components", file), "utf8");
      expect(source, file).toContain('setError(`${tr("not_sent")} ${threadWriteReason(locale, e)}`)');
      expect(source, file).not.toContain("(e as Error).message");
    }
  });
});

describe("profile photo", () => {
  async function upload(answer: Answer) {
    await open(createElement(ProfileStats, { profile: null }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*="image"]');
    expect(input, "photo input").toBeTruthy();
    route("POST /api/profile/avatar", answer);
    const file = new File(["x"], "me.gif", { type: "image/gif" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
  }

  it.each([
    ["the photo rule", json({ error: "Formato non supportato. Usa PNG, JPG o WebP." }, 400),
      "Photo NOT uploaded: use a PNG, JPG or WebP image up to 2 MB."],
    ["the server", json({ error: "EACCES /jht_home/avatar.png" }, 500), `Photo NOT uploaded: ${SERVER}`],
    ["a 200 that is not the route", new Response("<html>proxy</html>", { status: 200 }), `Photo NOT uploaded: ${SERVER}`],
  ])("%s: NOT uploaded, in the page's language", async (_case, answer, said) => {
    await upload(answer);
    expect(alerts()).toContain(said);
    expect(container.textContent).not.toMatch(/Formato non supportato|EACCES|proxy/);
  });
});
