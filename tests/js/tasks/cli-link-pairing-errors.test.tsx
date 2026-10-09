// @vitest-environment jsdom
/**
 * /cli-link dice «collegato» solo se la route lo dice, e un errore è una frase.
 *
 * La pagina conferma l'abbinamento del box (il codice che `jht cloud login`
 * mostra nel terminale). Fino al 09/10 mostrava il corpo della route così
 * com'era: messaggi in italiano su una pagina inglese, o `internal` per un
 * errore del database. E bastava un 200 qualunque, anche non della route, per
 * la schermata verde «Pairing completato».
 *
 * Qui gira la pagina vera, con la route finta: ogni status della route
 * (400, 401, 404, 409, 410, 429, 500) e la rete che cade danno «Dispositivo
 * NON collegato» col motivo, nella lingua della pagina, senza il corpo grezzo;
 * un 200 senza `{ ok: true }` non è un abbinamento.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));

import CliLinkClient from "../../../web/app/(protected)/cli-link/CliLinkClient";

const REPO = path.resolve(__dirname, "../../..");
const webRequire = createRequire(path.join(REPO, "web/package.json"));
const { createElement, act } = webRequire("react");
const { createRoot } = webRequire("react-dom/client");

let posts: (Response | Error)[];
let container: HTMLDivElement;
let root: { render(el: unknown): void; unmount(): void };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  posts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const next = posts.shift();
      if (!next) throw new Error("no answer");
      if (next instanceof Error) throw next;
      return next;
    }),
  );
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

async function confirm(answer: Response | Error) {
  posts.push(answer);
  await act(async () => {
    root.render(createElement(CliLinkClient));
  });
  // Il codice come lo scrive l'utente: è quello che la pagina controlla.
  const input = container.querySelector<HTMLInputElement>("#code")!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input, "ABCD-1234");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(input.value).toBe("ABCD-1234");
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
  }
}

function alerts() {
  return [...container.querySelectorAll('[role="alert"]')].map((a) => a.textContent);
}

describe("/cli-link", () => {
  it.each([
    [400, { error: "user_code malformato (atteso AAAA-1234)" }, "Malformed code. Expected format: AAAA-1234."],
    [401, { error: "Non autenticato" }, "Session expired: reload the page and sign in again."],
    [404, { error: "Codice non valido o gia' usato. Riprova dal terminale." }, "Invalid or already used code: run jht cloud login again in the terminal."],
    [409, { error: "Sessione gia' confermata da un'altra finestra. Riavvia dal terminale." }, "Code already confirmed in another window: run jht cloud login again in the terminal."],
    [410, { error: "Codice scaduto. Riavvia jht cloud login dal terminale." }, "Code expired: run jht cloud login again in the terminal."],
    [429, { error: "Troppi tentativi. Riprova più tardi." }, "Too many attempts: try again in a few minutes."],
    [500, { error: "internal" }, "Server error, try again shortly."],
  ])("status %i: not linked, with the reason in the page's language", async (status, body, reason) => {
    await confirm(json(body, status));

    expect(alerts()).toEqual([`Device NOT linked. ${reason}`]);
    expect(container.textContent).not.toContain((body as { error: string }).error);
    expect(container.querySelector("form")).not.toBeNull();
  });

  it("the network fails: not linked, never the exception's text", async () => {
    await confirm(new TypeError("Failed to fetch"));

    expect(alerts()).toEqual(["Device NOT linked. Network error: check your connection."]);
    expect(container.textContent).not.toContain("Failed to fetch");
  });

  it("a 200 without { ok: true } is not a pairing", async () => {
    await confirm(new Response("<html>proxy</html>", { status: 200 }));

    expect(alerts()).toEqual(["Device NOT linked. Server error, try again shortly."]);
    expect(container.textContent).not.toContain("Pairing complete");
  });

  it("speaks the page's language", async () => {
    document.cookie = "NEXT_LOCALE=it";
    await confirm(json({ error: "Codice scaduto. Riavvia jht cloud login dal terminale." }, 410));

    expect(alerts()).toEqual([
      "Dispositivo NON collegato. Codice scaduto: riavvia jht cloud login dal terminale.",
    ]);
  });

  it("the control: the route's { ok: true } is the green screen, with the token", async () => {
    await confirm(json({ ok: true, token_name: "cli-box", token_prefix: "jht_sync_ab" }));

    expect(alerts()).toEqual([]);
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("cli-box");
    expect(container.textContent).toContain("jht_sync_ab");
  });
});
