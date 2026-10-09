// @vitest-environment jsdom
/**
 * Le pagine che scrivono qualcosa di delicato dicono quando la scrittura NON
 * è riuscita, nella lingua della pagina, e non fingono di averla fatta.
 *
 * Passata del 09/10 sul web, dopo la pagina dei token:
 * - secrets: la cancellazione toglieva la riga anche quando la route
 *   rifiutava (il web in sola lettura risponde 403), e il salvataggio
 *   svuotava il modulo, valore compreso, anche quando falliva;
 * - credenziali dei provider: il corpo della route in italiano a schermo, la
 *   rimozione fallita in silenzio;
 * - avatar e CV: cancellazioni che toglievano la foto o il documento a
 *   schermo senza guardare la risposta, caricamenti falliti in silenzio;
 * - sincronizzazione (pagina Cloud sync e banner): il corpo grezzo della
 *   route (`sqlite_read_failed`, messaggi in italiano) o il testo
 *   dell'eccezione.
 *
 * Gira il codice vero delle pagine con una route finta che risponde per
 * metodo e percorso.
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
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: async () => ({}) } }),
}));

import { attemptWrite, writeFailureReason } from "../../../web/lib/write-failure";
import { isSyncResult, syncFailureMessage } from "../../../web/lib/sync-failure";
import SecretsPage from "../../../web/app/(protected)/secrets/page";
import CredentialsPage from "../../../web/app/(protected)/credentials/page";
import SettingsProfile from "../../../web/app/components/SettingsProfile";
import CloudSyncClient from "../../../web/app/(protected)/settings/cloud-sync/CloudSyncClient";
import CloudSyncStatusBanner from "../../../web/app/components/CloudSyncStatusBanner";

const REPO = path.resolve(__dirname, "../../..");
const webRequire = createRequire(path.join(REPO, "web/package.json"));
const { createElement, act } = webRequire("react");
const { createRoot } = webRequire("react-dom/client");

type Answer = Response | Error;
let routes: Record<string, Answer[]>;
let calls: string[];

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
      calls.push(key);
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

async function open(component: unknown) {
  await act(async () => {
    root.render(createElement(component));
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

async function type(el: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function alerts() {
  return [...container.querySelectorAll('[role="alert"]')].map((a) => a.textContent);
}

function button(label: RegExp) {
  return [...container.querySelectorAll("button")].find((b) =>
    label.test(b.textContent ?? "") || label.test(b.getAttribute("aria-label") ?? ""),
  );
}

describe("write-failure", () => {
  it.each([
    [400, "Invalid data: check the fields."],
    [401, "Session expired: reload the page and sign in again."],
    [403, "This cannot be changed from here: do it from the app on the computer where the team runs."],
    [404, "Item not found: reload the page."],
    [429, "Too many requests: try again in a minute."],
    [500, "Server error, try again shortly."],
    [null, "Network error: check your connection."],
  ])("status %s has its reason", (status, reason) => {
    expect(writeFailureReason("en", status)).toBe(reason);
  });

  it("speaks the page's language", () => {
    expect(writeFailureReason("it", 403)).toBe(
      "Da qui non si può modificare: fallo dall'app sul computer dove gira il team.",
    );
  });

  it("a { ok: false } with a 200 is a failure, and expectOk wants { ok: true }", async () => {
    route("POST /x", json({ ok: false, error: "no" }));
    expect(await attemptWrite("en", "/x", { method: "POST" })).toMatchObject({ ok: false, status: 500 });
    route("POST /y", new Response("<html>proxy</html>", { status: 200 }));
    expect(await attemptWrite("en", "/y", { method: "POST" })).toMatchObject({ ok: true });
    expect(await attemptWrite("en", "/y", { method: "POST" }, { expectOk: true })).toMatchObject({ ok: false });
    route("POST /z", json({ ok: true, id: "1" }, 201));
    expect(await attemptWrite("en", "/z", { method: "POST" }, { expectOk: true })).toMatchObject({
      ok: true,
      body: { ok: true, id: "1" },
    });
  });

  it("the sync result is the route's (it always has `empty`)", () => {
    expect(isSyncResult({ empty: false, positions: {} })).toBe(true);
    expect(isSyncResult({ error: "sqlite_read_failed" })).toBe(false);
    expect(isSyncResult(null)).toBe(false);
    expect(syncFailureMessage("en", 404)).toBe(
      "Sync NOT done. The local database does not exist yet: start the team at least once.",
    );
  });
});

const SECRET = { id: "s1", name: "chiave-sintetica", type: "api_key", value: "••••", masked: true, createdAt: 0 };

describe("secrets", () => {
  it("a refused delete keeps the secret listed and says so", async () => {
    route("GET /api/secrets", json({ secrets: [SECRET] }));
    route("DELETE /api/secrets", json({ error: "read_only" }, 403));
    await open(SecretsPage);

    await click(button(/Delete|Elimina|delete/i));

    expect(container.textContent).toContain("chiave-sintetica");
    expect(alerts()).toEqual([
      "Secret NOT deleted: it is still stored. This cannot be changed from here: do it from the app on the computer where the team runs.",
    ]);
    expect(container.textContent).not.toContain("read_only");
  });

  it("the control: { ok: true } removes it", async () => {
    route("GET /api/secrets", json({ secrets: [SECRET] }));
    route("DELETE /api/secrets", json({ ok: true }));
    await open(SecretsPage);

    await click(button(/Delete|Elimina|delete/i));

    expect(container.textContent).not.toContain("chiave-sintetica");
    expect(alerts()).toEqual([]);
  });

  it("a failed save keeps the form and the typed value", async () => {
    route("GET /api/secrets", json({ secrets: [] }));
    route("POST /api/secrets", json({ ok: false, error: "internal" }, 500));
    await open(SecretsPage);
    await click(button(/new secret/i));
    const [nameInput, valueInput] = [...container.querySelectorAll<HTMLInputElement>("input")];
    await type(nameInput, "nuova");
    await type(valueInput, "valore-sintetico");

    await click(button(/^save$/));

    expect(alerts()).toEqual(["Secret NOT saved. Server error, try again shortly."]);
    expect(valueInput.isConnected).toBe(true);
    expect(valueInput.value).toBe("valore-sintetico");
  });
});

const PROVIDERS = [
  { provider: "openai", type: "api_key", configured: true, source: "file", savedAt: 0, envVar: null },
];

describe("credentials", () => {
  it("a failed removal says the key is still stored", async () => {
    route("GET /api/credentials", json({ providers: PROVIDERS }));
    route("DELETE /api/credentials", json({ ok: false, error: "Nessuna credenziale salvata" }, 404));
    await open(CredentialsPage);

    await click(button(/Remove|Rimuovi|remove|delete/i));

    expect(alerts()).toEqual(["Key NOT removed: it is still stored. Item not found: reload the page."]);
    expect(container.textContent).not.toContain("Nessuna credenziale");
  });
});

describe("profile documents", () => {
  function profileRoutes() {
    route("GET /api/profile", json({ profile: {} }));
    route("GET /api/profile/avatar", new Response(null, { status: 204 }));
    route("GET /api/profile/files", json({ files: [{ name: "cv-sintetico.pdf", size: 10, mtime: 0 }] }));
    route("GET /api/applications", json({ applications: [] }));
  }

  it("a refused CV delete keeps the document and says so", async () => {
    profileRoutes();
    route("DELETE /api/profile/files", json({ error: "read_only" }, 403));
    await open(SettingsProfile);
    expect(container.textContent).toContain("cv-sintetico.pdf");

    await click(button(/^Delete$/));

    expect(calls).toContain("DELETE /api/profile/files");
    expect(container.textContent).toContain("cv-sintetico.pdf");
    expect(alerts()).toEqual([
      "Document NOT deleted: it is still stored. This cannot be changed from here: do it from the app on the computer where the team runs.",
    ]);
  });
});

describe("sync", () => {
  it.each([
    [json({ error: "Database locale non trovato (~/.jht/jobs.db). Avvia il team almeno una volta." }, 404),
      "Sync NOT done. The local database does not exist yet: start the team at least once."],
    [json({ error: "sqlite_read_failed" }, 500), "Sync NOT done. Server error, try again shortly."],
    [new TypeError("Failed to fetch"), "Sync NOT done. Network error: check your connection."],
    [new Response("<html>proxy</html>", { status: 200 }), "Sync NOT done. Server error, try again shortly."],
  ])("Cloud sync page: a failure is a sentence (%#)", async (failure, sentence) => {
    route("GET /api/local/health", json({ local: true, logged_in: true, user_email: "e2e@example.com", user_id: "u" }));
    route("GET /api/local/sync/status", json({}, 500));
    route("POST /api/local/sync", failure);
    await open(CloudSyncClient);

    await click(button(/Sync now|Sincronizza/i));

    expect(alerts()).toEqual([sentence]);
    expect(container.textContent).not.toMatch(/sqlite_read_failed|Failed to fetch|jobs\.db/);
  });

  it("the banner says it in the page's language", async () => {
    document.cookie = "NEXT_LOCALE=it";
    const counts = { positions: 1, scores: 1, applications: 0 };
    route("GET /api/local/sync/status", json({
      local: true, logged_in: true, remote: false, last_sync: null,
      local_counts: counts, cloud_counts: counts, in_sync: false,
    }));
    route("POST /api/local/sync", json({ error: "sqlite_read_failed" }, 500));
    await open(CloudSyncStatusBanner);

    await click(button(/Sync now|Sincronizza/i));

    expect(alerts()).toEqual(["Sincronizzazione NON fatta. Errore del server, riprova tra poco."]);
  });
});
