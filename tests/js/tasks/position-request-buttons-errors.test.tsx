// @vitest-environment jsdom
/**
 * I pulsanti di richiesta sulla posizione cambiano stato solo se la route
 * CONFERMA, e un fallimento è una frase nella lingua della pagina.
 *
 * Sono il punto in cui l'utente autorizza una candidatura o chiede un'azione
 * al team. Fino al 09/10 CV, verifica e geocoding cambiavano stato prima della
 * risposta (update ottimistico), e quasi tutti mostravano il corpo della route
 * così com'era (`query_failed`, messaggi in italiano, `HTTP 500`, il testo di
 * un'eccezione). Il caso peggiore è il ritiro dell'autorizzazione: se fallisce
 * in silenzio, il team può ancora inviare la candidatura.
 *
 * Qui girano i pulsanti veri con la route finta: ogni scrittura che fallisce
 * (status, rete, un 2xx che non conferma) lascia lo stato com'era, con la
 * frase; la risposta che conferma lo cambia.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
// Come in web-realtime-user-filter: `next` vive in web/node_modules, e il mock
// deve colpire il modulo che il componente risolve davvero.
vi.mock("../../../web/node_modules/next/navigation.js", () => ({
  useRouter: () => router,
}));
vi.mock("../../../web/node_modules/next/link.js", () => {
  const { createElement } = createRequire(
    path.resolve(__dirname, "../../../web/package.json"),
  )("react");
  return {
    default: ({ href, children, ...rest }: Record<string, unknown>) =>
      createElement("a", { href, ...rest }, children),
  };
});

import { WriteRequestButton } from "../../../web/app/(protected)/positions/[id]/WriteRequestButton";
import { CoverLetterRequestButton } from "../../../web/app/(protected)/positions/[id]/CoverLetterRequestButton";
import { RescoreRequestButton } from "../../../web/app/(protected)/positions/[id]/RescoreRequestButton";
import { RecheckButton } from "../../../web/app/(protected)/positions/[id]/RecheckButton";
import { GeocodeRequestButton } from "../../../web/app/(protected)/positions/[id]/GeocodeRequestButton";
import { ApplyRequestButton } from "../../../web/app/(protected)/positions/[id]/ApplyRequestButton";

const REPO = path.resolve(__dirname, "../../..");
const webRequire = createRequire(path.join(REPO, "web/package.json"));
const { createElement, act } = webRequire("react");
const { createRoot } = webRequire("react-dom/client");

let answers: (Response | Error)[];
let calls: string[];
let container: HTMLDivElement;
let root: { render(el: unknown): void; unmount(): void };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  answers = [];
  calls = [];
  router.refresh.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${input}`);
      const next = answers.shift();
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
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
  }
}

async function render(component: unknown, props: Record<string, unknown>) {
  await act(async () => {
    root.render(createElement(component, props));
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

function alerts() {
  return [...document.querySelectorAll('[role="alert"]')].map((a) => a.textContent);
}

const active = () => container.textContent!.includes("✓");
const REQUEST_NOT = "Request NOT registered: the team does not see it.";
const CANCEL_NOT = "Cancellation NOT registered: the team still sees the request.";
const SERVER = "Server error, try again shortly.";
const NETWORK = "Network error: check your connection.";

describe("toggle buttons: CV, recheck, geocoding", () => {
  const BUTTONS = [
    ["CV", WriteRequestButton, (v: boolean) => ({ position: { write_requested: v } })],
    ["recheck", RecheckButton, (v: boolean) => ({ recheck_requested: v })],
    ["geocoding", GeocodeRequestButton, (v: boolean) => ({ position: { geocode_requested: v } })],
  ] as const;

  for (const [name, Button, confirmed] of BUTTONS) {
    describe(name, () => {
      it.each([
        ["a 500", json({ error: "query_failed" }, 500), SERVER],
        ["the network", new TypeError("Failed to fetch"), NETWORK],
        ["a 200 that does not confirm", json({}), SERVER],
        ["a 200 that says the opposite", json(confirmed(false)), SERVER],
      ])("asking fails on %s: still not requested, with the sentence", async (_n, failure, reason) => {
        answers.push(failure);
        await render(Button, { legacyId: 7, initialRequested: false });

        await click(container.querySelector("button"));

        expect(active()).toBe(false);
        expect(alerts()).toEqual([`${REQUEST_NOT} ${reason}`]);
        expect(router.refresh).not.toHaveBeenCalled();
        expect(container.textContent).not.toMatch(/query_failed|Failed to fetch|HTTP/);
      });

      it("cancelling fails: still requested, and the team still sees it", async () => {
        answers.push(json({ error: "read_only" }, 403));
        await render(Button, { legacyId: 7, initialRequested: true });

        await click(container.querySelector("button"));

        expect(active()).toBe(true);
        expect(alerts()).toEqual([
          `${CANCEL_NOT} This cannot be changed from here: do it from the app on the computer where the team runs.`,
        ]);
      });

      it("while the route has not answered, the button is not yet requested", async () => {
        // Niente update ottimistico: «richiesto» solo dopo la conferma.
        vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
        await render(Button, { legacyId: 7, initialRequested: false });

        await click(container.querySelector("button"));

        expect(active()).toBe(false);
        expect(container.querySelector("button")!.disabled).toBe(true);
      });

      it("the control: the route's confirmation changes the state", async () => {
        answers.push(json(confirmed(true)));
        await render(Button, { legacyId: 7, initialRequested: false });

        await click(container.querySelector("button"));

        expect(active()).toBe(true);
        expect(alerts()).toEqual([]);
        expect(router.refresh).toHaveBeenCalledTimes(1);
      });
    });
  }

  it("a 409 says the position is not in the right state", async () => {
    answers.push(json({ error: "Posizione in stato 'new': richiesta CV ammessa solo per 'scored'" }, 409));
    await render(WriteRequestButton, { legacyId: 7, initialRequested: false });

    await click(container.querySelector("button"));

    expect(alerts()).toEqual([
      `${REQUEST_NOT} The position is not in the right state for this request: reload the page.`,
    ]);
  });

  it("speaks the page's language", async () => {
    document.cookie = "NEXT_LOCALE=it";
    answers.push(json({ error: "query_failed" }, 500));
    await render(WriteRequestButton, { legacyId: 7, initialRequested: false });

    await click(container.querySelector("button"));

    expect(alerts()).toEqual([
      "Richiesta NON registrata: il team non la vede. Errore del server, riprova tra poco.",
    ]);
  });
});

describe("cover letter", () => {
  it("the 409 without an application has its own reason", async () => {
    answers.push(json({ error: "cover_letter_requires_application" }, 409));
    await render(CoverLetterRequestButton, { legacyId: 7, initialRequested: false });

    await click(container.querySelector("button"));

    expect(active()).toBe(false);
    expect(alerts()).toEqual([`${REQUEST_NOT} Available after the CV is created`]);
  });

  it("a 200 for the CV, not the letter, is not confirmed", async () => {
    answers.push(json({ position: { write_requested: true, write_request_kind: "cv" } }));
    await render(CoverLetterRequestButton, { legacyId: 7, initialRequested: false });

    await click(container.querySelector("button"));

    expect(active()).toBe(false);
    expect(alerts()).toEqual([`${REQUEST_NOT} The team did not confirm the request`]);
  });
});

describe("rescore", () => {
  it("a failed ticket leaves the button available, with the sentence", async () => {
    answers.push(json({ error: "La richiesta non può essere vuota" }, 400));
    await render(RescoreRequestButton, { legacyId: 7, initialStatus: null });

    await click(container.querySelector("button"));

    expect(container.querySelector("button")!.disabled).toBe(false);
    expect(alerts()).toEqual([`${REQUEST_NOT} Invalid data: check the fields.`]);
  });

  it("the control: an open ticket is the requested state", async () => {
    answers.push(json({ id: 3, status: "open" }));
    await render(RescoreRequestButton, { legacyId: 7, initialStatus: null });

    await click(container.querySelector("button"));

    expect(alerts()).toEqual([]);
    expect(container.querySelector("button")!.disabled).toBe(true);
  });
});

describe("the application", () => {
  const byAction = (action: string) =>
    document.querySelector(`[data-action="${action}"]`);

  it("a failed withdrawal says the team can still send it", async () => {
    answers.push(json({ error: "update_failed" }, 500));
    await render(ApplyRequestButton, { legacyId: 7, state: { kind: "authorised", at: null } });

    await click(byAction("withdraw"));

    expect(alerts()).toEqual([
      `Authorisation NOT withdrawn: the team can still send the application. ${SERVER}`,
    ]);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("a withdrawal answered without apply_requested: false is not a withdrawal", async () => {
    answers.push(json({ apply_requested: true }));
    await render(ApplyRequestButton, { legacyId: 7, state: { kind: "authorised", at: null } });

    await click(byAction("withdraw"));

    expect(alerts()).toEqual([
      `Authorisation NOT withdrawn: the team can still send the application. ${SERVER}`,
    ]);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("a refused authorisation gives the route's reason, translated", async () => {
    answers.push(json({ error: "already_submitted", detail: "La candidatura è già stata inviata" }, 409));
    await render(ApplyRequestButton, { legacyId: 7, state: { kind: "available" } });

    await click(byAction("authorise"));
    await click(byAction("confirm"));

    expect(calls).toEqual(["POST /api/positions/7/apply-request"]);
    expect(alerts()).toEqual([
      "Application NOT authorised: the team will not send it. The application has already been sent.",
    ]);
    expect(document.body.textContent).not.toContain("già stata inviata");
  });

  it("the control: the route's apply_requested: true refreshes the page", async () => {
    answers.push(json({ apply_requested: true }));
    await render(ApplyRequestButton, { legacyId: 7, state: { kind: "available" } });

    await click(byAction("authorise"));
    await click(byAction("confirm"));

    expect(alerts()).toEqual([]);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});
