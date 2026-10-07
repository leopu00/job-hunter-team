/**
 * Token cloud-sync: avviso «inattivo da N giorni».
 *
 * I token web dei box non scadono più, quindi la revoca a mano è l'unica
 * difesa contro un token dimenticato. La lista dei token segnala quelli che
 * nessuno usa da più di TOKEN_INACTIVITY_WARNING_DAYS giorni, con l'invito a
 * revocarli. last_used_at ha granularità di un'ora (throttle in auth.ts): qui
 * si ragiona in giorni.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "@/i18n/config";
import {
  tokenInactivity,
  TOKEN_INACTIVITY_WARNING_DAYS,
} from "@/lib/cloud-sync/token-inactivity";
import { TokenInactivityNotice } from "@/app/(protected)/settings/cloud-sync/TokenInactivityNotice";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const REPO = path.resolve(__dirname, "../../..");
const webRequire = createRequire(path.join(REPO, "web/package.json"));
const { createElement } = webRequire("react");
const { renderToStaticMarkup } = webRequire("react-dom/server");
const LOCALES: Locale[] = ["en", "it", "hu", "es", "de", "fr", "pt"];

const CASES = {
  active: { last_used_at: ago(1 * DAY), created_at: ago(200 * DAY) },
  idle: { last_used_at: ago(31 * DAY), created_at: ago(200 * DAY) },
  neverUsedOld: { last_used_at: null, created_at: ago(45 * DAY) },
  neverUsedNew: { last_used_at: null, created_at: ago(2 * HOUR) },
  revoked: {
    last_used_at: ago(90 * DAY),
    created_at: ago(200 * DAY),
    revoked_at: ago(10 * DAY),
  },
};

function render(locale: Locale, token: (typeof CASES)[keyof typeof CASES]) {
  const html: string = renderToStaticMarkup(
    createElement(TokenInactivityNotice, { locale, token, now: NOW }),
  );
  return { html, text: new JSDOM(html).window.document.body.textContent ?? "" };
}

describe("tokenInactivity", () => {
  it("la soglia ha un nome e vale 30 giorni", () => {
    expect(TOKEN_INACTIVITY_WARNING_DAYS).toBe(30);
  });

  it("attivo: usato ieri", () => {
    expect(tokenInactivity(CASES.active, NOW)).toEqual({ inactive: false });
  });

  it("inattivo: usato 31 giorni fa", () => {
    expect(tokenInactivity(CASES.idle, NOW)).toEqual({
      inactive: true,
      days: 31,
      neverUsed: false,
    });
  });

  it("mai usato e creato da più di 30 giorni: conta dalla creazione", () => {
    expect(tokenInactivity(CASES.neverUsedOld, NOW)).toEqual({
      inactive: true,
      days: 45,
      neverUsed: true,
    });
  });

  it("mai usato e appena creato: niente avviso", () => {
    expect(tokenInactivity(CASES.neverUsedNew, NOW)).toEqual({ inactive: false });
  });

  it("revocato: niente avviso, anche se fermo da 90 giorni", () => {
    expect(tokenInactivity(CASES.revoked, NOW)).toEqual({ inactive: false });
  });

  it("il confine è «più di 30 giorni»", () => {
    const at = (ms: number) => ({ last_used_at: ago(ms), created_at: ago(400 * DAY) });
    expect(tokenInactivity(at(30 * DAY), NOW)).toEqual({ inactive: false });
    expect(tokenInactivity(at(30 * DAY + HOUR), NOW)).toMatchObject({
      inactive: true,
      days: 30,
    });
  });
});

describe("TokenInactivityNotice", () => {
  it("token inattivo: avviso visibile con i giorni e l'invito a revocare, in ogni lingua", () => {
    const texts = LOCALES.map((locale) => {
      const { html, text } = render(locale, CASES.idle);
      expect(html).toContain('role="alert"');
      expect(html).toContain('data-token-inactive="idle"');
      expect(text).toContain("31");
      expect(text).toContain(CASES.idle.last_used_at.slice(0, 10));
      return text;
    });
    expect(new Set(texts).size).toBe(LOCALES.length);
    expect(render("it", CASES.idle).text).toBe(
      "Inattivo da 31 giorni (ultimo uso: 2026-09-06). Se il box non esiste più, revoca il token.",
    );
  });

  it("mai usato e vecchio: avviso che lo dice", () => {
    const { html, text } = render("it", CASES.neverUsedOld);
    expect(html).toContain('data-token-inactive="never-used"');
    expect(text).toContain("Inattivo da 45 giorni");
    expect(text).toContain("mai usato");
    expect(text).toContain("revoca il token");
  });

  it("attivo, appena creato o revocato: nessun avviso", () => {
    for (const token of [CASES.active, CASES.neverUsedNew, CASES.revoked]) {
      expect(render("en", token).html).toBe("");
    }
  });
});

const mocks = vi.hoisted(() => ({ filters: [] as [string, string, unknown][] }));

vi.mock("@/lib/workspace", () => ({ isSupabaseConfigured: true }));
vi.mock("@/lib/cloud-sync/rate-limit", () => ({
  checkCloudSyncRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSec: 0 })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "synthetic-user" } } }) },
    from: () => {
      const chain: Record<string, unknown> = {
        select(columns: string) {
          mocks.filters.push(["select", columns, null]);
          return chain;
        },
        eq: (column: string, value: unknown) => {
          mocks.filters.push(["eq", column, value]);
          return chain;
        },
        is: (column: string, value: unknown) => {
          mocks.filters.push(["is", column, value]);
          return chain;
        },
        order: async () => ({ data: [], error: null }),
      };
      return chain;
    },
  }),
}));

describe("GET /api/cloud-sync/tokens", () => {
  beforeEach(() => {
    mocks.filters.length = 0;
  });

  it("dà i campi dell'avviso e lascia fuori i token revocati", async () => {
    const { GET } = await import("@/app/api/cloud-sync/tokens/route");

    const res = await GET();

    expect(res.status).toBe(200);
    const select = mocks.filters.find(([op]) => op === "select");
    const columns = String(select?.[1]).split(/,\s*/);
    expect(columns).toEqual(expect.arrayContaining(["last_used_at", "created_at"]));
    expect(mocks.filters).toContainEqual(["is", "revoked_at", null]);
  });
});
