// @vitest-environment jsdom
/**
 * La pagina dei token considera revocato un token SOLO se la route lo dice.
 *
 * Fino al 09/10 `handleRevoke` non leggeva la risposta del DELETE: una revoca
 * fallita (rete, 404, 500, la 093 applicata prima del deploy) lasciava il
 * token attivo, e la pagina non lo diceva. Lo provava lo stack locale: con la
 * route vecchia il DELETE dava `permission denied` e la lista ricaricata non
 * mostrava nessun errore. Chi revoca è proprio chi teme che il token sia
 * uscito.
 *
 * Qui gira la pagina vera, con la route finta: una revoca che fallisce lascia
 * il token in lista con il pulsante di revoca e una frase che dice che è
 * ancora attivo; «Genera token» non mostra mai il corpo grezzo (`internal`);
 * una lista che non si carica non diventa «Nessun token attivo».
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

import CloudTokensClient from "../../../web/app/(protected)/settings/cloud-sync/CloudTokensClient";

const REPO = path.resolve(__dirname, "../../..");
const webRequire = createRequire(path.join(REPO, "web/package.json"));
const { createElement, act } = webRequire("react");
const { createRoot } = webRequire("react-dom/client");

const TOKEN = {
  id: "token-1",
  name: "box-sintetico",
  token_prefix: "jht_sync_ab",
  last_used_at: null,
  created_at: "2026-10-01T10:00:00Z",
  expires_at: null,
  client_version: null,
  client_platform: null,
  client_capabilities: null,
  client_seen_at: null,
};

type Answer = Response | Error;
let answers: Record<string, Answer[]>;
let calls: string[];

function answer(method: string, ...list: Answer[]) {
  answers[method] = list;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let container: HTMLDivElement;
let root: { render(el: unknown): void; unmount(): void };

beforeEach(() => {
  answers = {};
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push(method);
      const next = answers[method]?.shift();
      if (!next) throw new Error(`no answer for ${method}`);
      if (next instanceof Error) throw next;
      return next;
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
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
  }
}

async function open() {
  await act(async () => {
    root.render(createElement(CloudTokensClient));
  });
  await settle();
}

function revokeButton() {
  return [...container.querySelectorAll("li button")].find((b) =>
    /Revoke|Revoca/.test(b.textContent ?? ""),
  ) as HTMLButtonElement | undefined;
}

async function click(button: HTMLElement | undefined) {
  expect(button, "button not found").toBeTruthy();
  await act(async () => {
    button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

function alerts() {
  return [...container.querySelectorAll('[role="alert"]')].map((a) => a.textContent);
}

describe("Revoke", () => {
  it.each([
    ["the route answers 500 (the 093 before the deploy)", json({ error: "internal" }, 500), "Server error"],
    ["the route answers 404", json({ error: "Token non trovato" }, 404), "Token not found"],
    ["the session expired", json({ error: "Non autenticato" }, 401), "Session expired"],
    ["rate limited", json({ error: "Rate limit superato" }, 429), "Too many requests"],
    ["the network fails", new TypeError("Failed to fetch"), "Network error"],
    ["a 200 that is not the route's answer", new Response("<html>proxy</html>", { status: 200 }), "Server error"],
  ])("%s: the token stays listed as active, with the error", async (_name, failure, reason) => {
    answer("GET", json({ tokens: [TOKEN] }));
    answer("DELETE", failure);
    await open();

    await click(revokeButton());

    expect(container.textContent).toContain("box-sintetico");
    expect(revokeButton()?.textContent).toBe("Revoke");
    expect(revokeButton()?.disabled).toBe(false);
    expect(alerts()).toEqual([
      expect.stringContaining("The token was NOT revoked: it is still active."),
    ]);
    expect(alerts()[0]).toContain(reason);
    expect(container.textContent).not.toContain("No active tokens");
    expect(container.textContent).not.toContain("internal");
  });

  it("only { ok: true } revokes: the token leaves the list, no error", async () => {
    answer("GET", json({ tokens: [TOKEN] }), json({ tokens: [] }));
    answer("DELETE", json({ ok: true }));
    await open();

    await click(revokeButton());

    expect(calls).toEqual(["GET", "DELETE", "GET"]);
    expect(container.textContent).not.toContain("box-sintetico");
    expect(container.textContent).toContain("No active tokens.");
    expect(alerts()).toEqual([]);
  });

  it("speaks the page's language", async () => {
    document.cookie = "NEXT_LOCALE=it";
    answer("GET", json({ tokens: [TOKEN] }));
    answer("DELETE", json({ error: "internal" }, 500));
    await open();

    await click(revokeButton());

    expect(alerts()).toEqual([
      "Il token NON è stato revocato: è ancora attivo. Errore del server, riprova tra poco.",
    ]);
  });
});

describe("Token list", () => {
  it("a list that does not load is an error, not «No active tokens»", async () => {
    answer("GET", json({ error: "internal" }, 500));
    await open();

    expect(alerts()).toEqual(["Could not load the tokens: reload the page."]);
    expect(container.textContent).not.toContain("No active tokens");
  });
});

describe("Generate token", () => {
  async function create(...posts: Answer[]) {
    answer("GET", json({ tokens: [] }), json({ tokens: [] }));
    answer("POST", ...posts);
    await open();
    const input = container.querySelector<HTMLInputElement>("#token_name")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(input, "box-nuovo");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await settle();
  }

  it.each([
    [json({ error: "internal" }, 500), "Token not created. Server error, try again shortly."],
    [json({ error: "Rate limit superato. Riprova tra poco." }, 429), "Token not created. Too many requests: try again in a minute."],
    [json({ error: "Nome obbligatorio (1-100 caratteri)" }, 400), "Token not created. Name required (1-100 characters)."],
    [new TypeError("Failed to fetch"), "Token not created. Network error: check your connection."],
  ])("a failure is a sentence, never the raw body (%#)", async (failure, sentence) => {
    await create(failure);

    expect(alerts()).toEqual([sentence]);
    expect(container.textContent).not.toContain("internal");
    expect(container.textContent).not.toContain("Failed to fetch");
  });

  it("the control: a created token is shown once, with no error", async () => {
    await create(json({ id: "t2", name: "box-nuovo", token: "jht_sync_synthetic" }, 201));

    expect(alerts()).toEqual([]);
    expect(container.textContent).toContain("jht cloud enable --token jht_sync_synthetic");
  });
});
