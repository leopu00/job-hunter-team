// @vitest-environment jsdom
/**
 * La pagina «Orari e modelli del team» (web capace, fase 6): il sito non scrive
 * il config del box, chiede la porta (POST /api/team/settings) e legge da
 * GET /api/team-state se il computer ha applicato.
 *
 * Gira il codice vero della pagina, del pannello dei modelli e di
 * WorkHoursPicker (modalità cloud) con una route finta che risponde per
 * metodo e percorso. La libreria (`team-settings.ts`) ha già i suoi test in
 * web/lib: qui si prova quello che l'utente vede e quello che parte verso la porta.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cloud = vi.hoisted(() => ({ value: true as boolean | null }));

vi.mock("@/app/hooks/useIsCloud", () => ({ useIsCloud: () => cloud.value }));
vi.mock("next/link", () => {
  const { createElement } = createRequire(
    path.resolve(__dirname, "../../../web/package.json"),
  )("react");
  return {
    default: ({ href, children, ...rest }: Record<string, unknown>) =>
      createElement("a", { href, ...rest }, children),
  };
});

import TeamSettingsPage from "../../../web/app/(protected)/settings/team/page";
import { T } from "../../../web/app/(protected)/settings/team/page.i18n";
import { ToastProvider } from "../../../web/app/components/Toast";

const REPO = path.resolve(__dirname, "../../..");
const webRequire = createRequire(path.join(REPO, "web/package.json"));
const { createElement, act } = webRequire("react");
const { createRoot } = webRequire("react-dom/client");

type Answer = Response | Error;
let routes: Record<string, Answer[]>;
let calls: { key: string; body: unknown }[];
let fetchMock: ReturnType<typeof vi.fn>;

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

const STATE = "GET /api/team-state";
const SETTINGS = "POST /api/team/settings";

/** Il corpo di GET /api/team-state: la riga team_state sotto `state`. */
function state(row: Record<string, unknown>) {
  return json({ state: row });
}

let container: HTMLDivElement;
let root: { render(el: unknown): void; unmount(): void };

function setLocale(locale: "it" | "en") {
  document.cookie = `NEXT_LOCALE=${locale}`;
}

beforeEach(() => {
  routes = {};
  calls = [];
  cloud.value = true;
  fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input).split("?")[0]}`;
    calls.push({
      key,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });
    const list = routes[key];
    if (!list?.length) return json({}, 404);
    const next = list.length > 1 ? list.shift()! : list[0];
    if (next instanceof Error) throw next;
    return next.clone();
  });
  vi.stubGlobal("fetch", fetchMock);
  setLocale("en");
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

async function openPage() {
  await act(async () => {
    root.render(createElement(ToastProvider, null, createElement(TeamSettingsPage)));
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

const text = () => container.textContent ?? "";

/** Il bottone che finisce con quel testo: i preset hanno l'icona davanti, «Save» non prende «Save custom». */
function button(label: string) {
  return [...container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").trim().endsWith(label),
  ) as HTMLButtonElement | undefined;
}

function select(role: string, col: "Model" | "Effort") {
  return container.querySelector(
    `select[aria-label="${role}: ${col}"]`,
  ) as HTMLSelectElement;
}

async function choose(el: HTMLSelectElement, value: string) {
  expect(el, "select not found").toBeTruthy();
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  await act(async () => {
    set.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

const posts = () => calls.filter((c) => c.key === SETTINGS).map((c) => c.body as { params: Record<string, unknown> });

/** Le frasi del dizionario nella lingua data. */
const phrase = (key: keyof typeof T, locale: "it" | "en") => T[key][locale];

/** I preset colorati come «quello attuale» di WorkHoursPicker. */
const highlighted = () =>
  [...container.querySelectorAll("button")]
    .filter((b) => b.className.includes("border-orange-500 bg-orange-500/10"))
    .map((b) => b.textContent);

/** Le ore a settimana mostrate sopra «/ week». */
function weeklyHours() {
  const label = [...container.querySelectorAll("div")].find((d) => d.textContent === "/ week");
  return label?.previousElementSibling?.textContent;
}

const OFFICE = {
  timezone: "Europe/Rome",
  windows: [{ days: ["mon", "tue", "wed", "thu", "fri"], start: "09:00", end: "18:00" }],
};

describe("stato: cosa ha chiesto il sito e se il computer l'ha applicato", () => {
  it("senza desiderio dice che dal sito non è stato chiesto niente", async () => {
    setLocale("it");
    route(STATE, state({}));
    await openPage();

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toBe(phrase("status_none", "it"));
    expect(status?.textContent).toContain("Dal sito non hai ancora chiesto niente");
  });

  it("un desiderio più nuovo dell'applicato è «In attesa»", async () => {
    setLocale("it");
    route(
      STATE,
      state({
        desired_settings: { role_models: { scout: { model: "sol" } } },
        desired_settings_at: "2026-10-22T10:00:00Z",
        settings_applied_at: "2026-10-22T09:00:00Z",
      }),
    );
    await openPage();

    expect(container.querySelector('[role="status"]')?.textContent).toBe(phrase("status_pending", "it"));
    expect(text()).toContain("In attesa");
  });

  it("un desiderio mai applicato (nessun settings_applied_at) è in attesa", async () => {
    route(
      STATE,
      state({ desired_settings: { working_hours: null }, desired_settings_at: "2026-10-22T10:00:00Z" }),
    );
    await openPage();

    expect(container.querySelector('[role="status"]')?.textContent).toBe(phrase("status_pending", "en"));
  });

  it("applicato (stampo uguale o più nuovo) dice quando, con la data del computer", async () => {
    const applied = "2026-10-22T10:00:00Z";
    route(
      STATE,
      state({
        desired_settings: { role_models: { scout: { model: "sol" } } },
        desired_settings_at: applied,
        settings_applied_at: applied,
      }),
    );
    await openPage();

    const when = new Date(applied).toLocaleString("en");
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      phrase("status_applied", "en").replace("{when}", when),
    );
    expect(text()).not.toContain("{when}");
  });

  it("la lettura dello stato che fallisce dice che non riesce a leggere, e non mostra i moduli", async () => {
    route(STATE, json({ error: "boom" }, 500));
    await openPage();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(phrase("load_error", "en"));
    expect(container.querySelectorAll("select")).toHaveLength(0);
  });
});

describe("RoleModelsPanel: cosa parte verso la porta", () => {
  const SAVED = {
    desired_settings: {
      role_models: { scout: { model: "sol" }, scrittore: { effort: "high" } },
    },
    desired_settings_at: "2026-10-22T10:00:00Z",
    settings_applied_at: "2026-10-22T10:00:00Z",
  };

  it("mostra i ruoli già salvati nei menu, gli altri su Predefinito", async () => {
    route(STATE, state(SAVED));
    await openPage();

    expect(select("Scout", "Model").value).toBe("sol");
    expect(select("Writer", "Effort").value).toBe("high");
    expect(select("Captain", "Model").value).toBe("");
    expect(select("Captain", "Effort").value).toBe("");
    expect(select("Scout", "Effort").value).toBe("");
  });

  it("Salva è disabilitato finché non c'è una modifica, e Annulla modifiche non compare", async () => {
    route(STATE, state(SAVED));
    await openPage();

    expect(button("Save")!.disabled).toBe(true);
    expect(button("Discard changes")).toBeUndefined();
  });

  it("cambio un ruolo: parte il ruolo cambiato più i già salvati, mai un {} per un ruolo non toccato", async () => {
    route(STATE, state(SAVED));
    route(SETTINGS, json({ ok: true }));
    await openPage();

    await choose(select("Captain", "Model"), "terra");
    expect(button("Save")!.disabled).toBe(false);
    await click(button("Save"));

    expect(posts()).toHaveLength(1);
    const sent = posts()[0].params;
    expect(Object.keys(sent)).toEqual(["role_models"]);
    // toEqual distingue {} da «assente»: i ruoli non toccati e non salvati non compaiono.
    expect(sent.role_models).toEqual({
      capitano: { model: "terra" },
      scout: { model: "sol" },
      scrittore: { effort: "high" },
    });
  });

  it("senza nulla di salvato parte solo il ruolo cambiato", async () => {
    route(STATE, state({}));
    route(SETTINGS, json({ ok: true }));
    await openPage();

    await choose(select("Closer", "Effort"), "low");
    await click(button("Save"));

    expect(posts()[0].params.role_models).toEqual({ closer: { effort: "low" } });
  });

  it("un ruolo riportato a Predefinito parte come {} solo lui; gli altri salvati restano com'erano", async () => {
    route(STATE, state(SAVED));
    route(SETTINGS, json({ ok: true }));
    await openPage();

    await choose(select("Scout", "Model"), "");
    await click(button("Save"));

    const sent = posts()[0].params.role_models as Record<string, unknown>;
    expect(sent).toEqual({ scout: {}, scrittore: { effort: "high" } });
    expect(sent.scout).toEqual({});
  });

  it("cambiare e rimettere il valore di prima torna a non avere modifiche", async () => {
    route(STATE, state(SAVED));
    await openPage();

    await choose(select("Scout", "Model"), "luna");
    expect(button("Save")!.disabled).toBe(false);
    await choose(select("Scout", "Model"), "sol");

    expect(button("Save")!.disabled).toBe(true);
    expect(button("Discard changes")).toBeUndefined();
  });

  it("«Annulla modifiche» ripristina i menu, spegne Salva e non manda niente", async () => {
    route(STATE, state(SAVED));
    await openPage();

    await choose(select("Scout", "Model"), "luna");
    await choose(select("Captain", "Effort"), "medium");
    expect(select("Scout", "Model").value).toBe("luna");

    await click(button("Discard changes"));

    expect(select("Scout", "Model").value).toBe("sol");
    expect(select("Captain", "Effort").value).toBe("");
    expect(button("Save")!.disabled).toBe(true);
    expect(button("Discard changes")).toBeUndefined();
    expect(posts()).toHaveLength(0);
  });

  it("dopo il salvataggio dice «Request sent», rilegge lo stato e i menu mostrano il nuovo salvato", async () => {
    route(
      STATE,
      state(SAVED),
      state({
        ...SAVED,
        desired_settings: {
          role_models: { capitano: { model: "terra" }, scout: { model: "sol" }, scrittore: { effort: "high" } },
        },
        desired_settings_at: "2026-10-22T11:00:00Z",
      }),
    );
    route(SETTINGS, json({ ok: true }));
    await openPage();

    await choose(select("Captain", "Model"), "terra");
    await click(button("Save"));

    expect(text()).toContain(phrase("saved", "en"));
    expect(calls.filter((c) => c.key === STATE)).toHaveLength(2);
    expect(select("Captain", "Model").value).toBe("terra");
    expect(button("Save")!.disabled).toBe(true);
    // il nuovo desiderio è più recente di quanto applicato
    expect(container.querySelector('[role="status"]')?.textContent).toBe(phrase("status_pending", "en"));
  });
});

describe("RoleModelsPanel: un nuovo salvato dal database", () => {
  const BEFORE = {
    desired_settings: { role_models: { scout: { model: "sol" }, scrittore: { effort: "high" } } },
    desired_settings_at: "2026-10-22T10:00:00Z",
    settings_applied_at: "2026-10-22T10:00:00Z",
  };
  // La rilettura porta role_models DIVERSI da quelli di partenza (scritti, per esempio, dal desktop).
  const AFTER = {
    desired_settings: { role_models: { capitano: { model: "luna" }, scrittore: { effort: "low" } } },
    desired_settings_at: "2026-10-22T11:00:00Z",
    settings_applied_at: "2026-10-22T10:00:00Z",
  };

  it("senza modifiche nel pannello, i menu seguono il nuovo salvato (anche dopo un salvataggio degli orari)", async () => {
    route(STATE, state(BEFORE), state(AFTER));
    route(SETTINGS, json({ ok: true }));
    await openPage();
    expect(select("Scout", "Model").value).toBe("sol");

    await click(button("Office (Mon-Fri 9-18)"));

    expect(calls.filter((c) => c.key === STATE)).toHaveLength(2);
    expect(select("Captain", "Model").value).toBe("luna");
    expect(select("Scout", "Model").value).toBe("");
    expect(select("Writer", "Effort").value).toBe("low");
    expect(button("Save")!.disabled).toBe(true);
  });

  it("con una modifica in corso nel pannello, il nuovo salvato NON la cancella", async () => {
    route(STATE, state(BEFORE), state(AFTER));
    route(SETTINGS, json({ ok: true }));
    await openPage();

    await choose(select("Closer", "Model"), "terra");
    await click(button("Office (Mon-Fri 9-18)"));

    expect(calls.filter((c) => c.key === STATE)).toHaveLength(2);
    expect(select("Closer", "Model").value).toBe("terra");
    expect(button("Save")!.disabled).toBe(false);
    expect(button("Discard changes")).toBeTruthy();
  });
});

describe("rifiuti della porta: la frase giusta, nella lingua della pagina", () => {
  const REFUSALS: [string, () => Response | Error, keyof typeof T][] = [
    ["reauth_required", () => json({ ok: false, error: "reauth_required" }, 401), "err_reauth_required"],
    ["unauthenticated", () => json({ ok: false, error: "unauthenticated" }, 401), "err_unauthenticated"],
    ["rate_limited", () => json({ ok: false, error: "rate_limited" }, 429), "err_rate_limited"],
    ["invalid_params", () => json({ ok: false, error: "invalid_params" }, 400), "err_invalid_params"],
    ["rete giù", () => new TypeError("Failed to fetch"), "err_network"],
    ["codice sconosciuto", () => json({ ok: false, error: "level_mismatch" }, 500), "err_generic"],
    ["risposta non JSON", () => new Response("<html>proxy</html>", { status: 502 }), "err_generic"],
  ];

  describe.each(["en", "it"] as const)("lingua %s", (locale) => {
    it.each(REFUSALS)("modelli, %s", async (_name, answer, key) => {
      setLocale(locale);
      route(STATE, state({}));
      route(SETTINGS, answer());
      await openPage();

      const [model, optionOf] = locale === "en" ? ["Captain: Model", "terra"] : ["Capitano: Modello", "terra"];
      await choose(container.querySelector(`select[aria-label="${model}"]`) as HTMLSelectElement, optionOf);
      await click(button(locale === "en" ? "Save" : "Salva"));

      const alerts = [...container.querySelectorAll('[role="alert"]')].map((a) => a.textContent);
      expect(alerts).toEqual([phrase(key, locale)]);
      // la porta ha rifiutato: i menu tengono la scelta e si può riprovare
      expect((container.querySelector(`select[aria-label="${model}"]`) as HTMLSelectElement).value).toBe("terra");
      expect(button(locale === "en" ? "Save" : "Salva")!.disabled).toBe(false);
      // e non è partita nessuna rilettura «a successo»
      expect(calls.filter((c) => c.key === STATE)).toHaveLength(1);
    });

    it.each(REFUSALS)("orari, %s", async (_name, answer, key) => {
      setLocale(locale);
      route(STATE, state({}));
      route(SETTINGS, answer());
      await openPage();

      await click(button(locale === "en" ? "24/7 (always on)" : "24/7 (sempre attivo)"));

      const sentence = phrase(key, locale);
      const toasts = [...container.querySelectorAll('[role="alert"]')].map((a) => a.textContent ?? "");
      expect(toasts).toHaveLength(1);
      expect(toasts[0]).toContain(sentence);
      // il prefisso del picker dice che NON è salvato
      expect(toasts[0]).toMatch(locale === "en" ? /NOT saved/ : /NON salvata/);
      expect(toasts[0]).not.toContain("{msg}");
      expect(text()).not.toContain(phrase("saved", locale));
    });
  });

  it("le frasi in italiano e in inglese sono diverse e piene (nessuna chiave nuda)", () => {
    for (const key of Object.keys(T).filter((k) => k.startsWith("err_")) as (keyof typeof T)[]) {
      expect(T[key].it.length).toBeGreaterThan(10);
      expect(T[key].en.length).toBeGreaterThan(10);
      expect(T[key].it).not.toBe(T[key].en);
    }
  });
});

describe("WorkHoursPicker in cloud", () => {
  const picker = () => container.querySelector("h2");

  it("prima di ogni richiesta: nessun preset evidenziato e «—» al posto delle ore", async () => {
    route(STATE, state({}));
    await openPage();

    expect(picker()?.textContent).toContain("Working hours");
    expect(highlighted()).toEqual([]);
    expect(weeklyHours()).toBe("—");
  });

  it("un orario salvato malformato conta come mai chiesto", async () => {
    route(
      STATE,
      state({
        desired_settings: { working_hours: { timezone: "Europe/Rome", windows: "nope" } },
        desired_settings_at: "2026-10-22T10:00:00Z",
      }),
    );
    await openPage();

    expect(highlighted()).toEqual([]);
    expect(weeklyHours()).toBe("—");
  });

  it("dopo una richiesta del sito evidenzia il preset e mostra le ore (Office = 45h)", async () => {
    route(STATE, state({ desired_settings: { working_hours: OFFICE }, desired_settings_at: "2026-10-22T10:00:00Z" }));
    await openPage();

    expect(highlighted()).toEqual([expect.stringContaining("Office (Mon-Fri 9-18)")]);
    expect(weeklyHours()).toBe("45h");
  });

  it("chiesto 24/7 (working_hours null) evidenzia 24/7 con 168h, non «—»", async () => {
    route(STATE, state({ desired_settings: { working_hours: null }, desired_settings_at: "2026-10-22T10:00:00Z" }));
    await openPage();

    expect(highlighted()).toEqual([expect.stringContaining("24/7 (always on)")]);
    expect(weeklyHours()).toBe("168h");
  });

  it("scegliere un preset manda params.working_hours con la finestra del preset", async () => {
    route(STATE, state({}));
    route(SETTINGS, json({ ok: true }));
    await openPage();

    await click(button("Office (Mon-Fri 9-18)"));

    expect(posts()).toHaveLength(1);
    expect(Object.keys(posts()[0].params)).toEqual(["working_hours"]);
    expect(posts()[0].params.working_hours).toEqual({
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      windows: [{ days: ["mon", "tue", "wed", "thu", "fri"], start: "09:00", end: "18:00" }],
    });
    expect(text()).toContain(phrase("saved", "en"));
  });

  it("il preset notturno attraversa la mezzanotte (22:00 → 07:00, tutti i giorni)", async () => {
    route(STATE, state({}));
    route(SETTINGS, json({ ok: true }));
    await openPage();

    await click(button("Night (22-07)"));

    expect(posts()[0].params.working_hours).toMatchObject({
      windows: [{ days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], start: "22:00", end: "07:00" }],
    });
  });

  it("con un orario già chiesto il preset tiene il suo fuso orario, non quello della macchina", async () => {
    // Un fuso diverso da quello della macchina: con lo stesso, il codice che
    // rimette il fuso locale darebbe lo stesso risultato e il test passerebbe a vuoto.
    const asked = { ...OFFICE, timezone: "Pacific/Auckland" };
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).not.toBe(asked.timezone);
    route(STATE, state({ desired_settings: { working_hours: asked }, desired_settings_at: "2026-10-22T10:00:00Z" }));
    route(SETTINGS, json({ ok: true }));
    await openPage();

    await click(button("Weekend (Sat-Sun 9-18)"));

    expect(posts()[0].params.working_hours).toEqual({
      timezone: "Pacific/Auckland",
      windows: [{ days: ["sat", "sun"], start: "09:00", end: "18:00" }],
    });
  });

  it("24/7 manda working_hours null (non un oggetto vuoto)", async () => {
    route(STATE, state({ desired_settings: { working_hours: OFFICE }, desired_settings_at: "2026-10-22T10:00:00Z" }));
    route(SETTINGS, json({ ok: true }));
    await openPage();

    await click(button("24/7 (always on)"));

    expect(posts()).toHaveLength(1);
    expect(posts()[0]).toEqual({ params: { working_hours: null } });
  });

  it("richiesta passata: rilegge lo stato, il preset scelto si evidenzia con le sue ore", async () => {
    route(
      STATE,
      state({}),
      state({
        desired_settings: { working_hours: { ...OFFICE, windows: [{ days: ["sat", "sun"], start: "09:00", end: "18:00" }] } },
        desired_settings_at: "2026-10-22T11:00:00Z",
      }),
    );
    route(SETTINGS, json({ ok: true }));
    await openPage();
    expect(weeklyHours()).toBe("—");

    await click(button("Weekend (Sat-Sun 9-18)"));

    expect(calls.filter((c) => c.key === STATE)).toHaveLength(2);
    expect(highlighted()).toEqual([expect.stringContaining("Weekend (Sat-Sun 9-18)")]);
    expect(weeklyHours()).toBe("18h");
  });

  it("richiesta rifiutata: nessun preset si evidenzia e le ore restano «—»", async () => {
    route(STATE, state({}));
    route(SETTINGS, json({ ok: false, error: "rate_limited" }, 429));
    await openPage();

    await click(button("Office (Mon-Fri 9-18)"));

    expect(highlighted()).toEqual([]);
    expect(weeklyHours()).toBe("—");
  });

  it("non chiama mai le route locali (/api/team/working-hours): il sito non scrive il config", async () => {
    route(STATE, state({}));
    route(SETTINGS, json({ ok: true }));
    await openPage();
    await click(button("Office (Mon-Fri 9-18)"));

    const keys = calls.map((c) => c.key);
    expect(keys.some((k) => k.includes("/api/team/working-hours"))).toBe(false);
    expect(new Set(keys)).toEqual(new Set([STATE, SETTINGS]));
  });
});

describe("fuori dal cloud", () => {
  it.each(["it", "en"] as const)("%s: solo il messaggio cloud_only e nessuna fetch", async (locale) => {
    setLocale(locale);
    cloud.value = false;
    route(STATE, state({}));
    await openPage();

    expect(text()).toContain(phrase("cloud_only", locale));
    expect(container.querySelectorAll("select")).toHaveLength(0);
    expect(container.querySelector("h2")).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("finché non si sa se è cloud (null) non legge niente e non mostra il messaggio cloud_only", async () => {
    cloud.value = null;
    route(STATE, state({}));
    await openPage();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(text()).not.toContain(phrase("cloud_only", "en"));
    expect(container.querySelectorAll("select")).toHaveLength(0);
  });
});
