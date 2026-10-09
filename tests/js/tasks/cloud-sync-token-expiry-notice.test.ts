/**
 * Token cloud-sync dei box: niente scadenza di default dal web, avviso prima
 * delle scadenze esistenti.
 *
 * Un box si è scollegato in silenzio quando il suo token web, creato con la
 * scadenza di default a 90 giorni, è scaduto: verifyBearerToken risponde 401
 * e niente lo diceva prima. Qui gira il codice vero delle route e della riga
 * della lista token, con Supabase finto che registra cosa viene scritto.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "@/i18n/config";

const USER = "11111111-1111-1111-1111-111111111111";
const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const DAY = 86_400_000;

const mocks = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  selected: [] as string[],
  tokenRow: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/workspace", () => ({ isSupabaseConfigured: true }));
vi.mock("@/lib/cloud-sync/rate-limit", () => ({
  checkCloudSyncRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSec: 0 })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    from: () => {
      const chain: Record<string, unknown> = {
        select(columns: string) {
          mocks.selected.push(columns);
          return chain;
        },
        eq: () => chain,
        is: () => chain,
        order: async () => ({ data: [], error: null }),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: mocks.tokenRow, error: null }),
        }),
      }),
      update: () => ({ eq: () => ({ then: () => undefined }) }),
      // POST /api/cloud-sync/tokens crea il token col service_role (093).
      insert(row: Record<string, unknown>) {
        mocks.inserted.push(row);
        return {
          select: () => ({
            single: async () => ({
              data: {
                id: "synthetic-token-id",
                name: row.name,
                token_prefix: row.token_prefix,
                created_at: new Date(NOW).toISOString(),
                expires_at: row.expires_at,
              },
              error: null,
            }),
          }),
        };
      },
    }),
  }),
}));

const REPO = path.resolve(__dirname, "../../..");
const webRequire = createRequire(path.join(REPO, "web/package.json"));
const { createElement } = webRequire("react");
const { renderToStaticMarkup } = webRequire("react-dom/server");
const LOCALES: Locale[] = ["en", "it", "hu", "es", "de", "fr", "pt"];

function postRequest(body: unknown) {
  return { json: async () => body } as never;
}

function bearerRequest(token: string) {
  return {
    headers: new Headers({ authorization: `Bearer ${token}` }),
  } as never;
}

function tokenRow(expiresAt: string | null) {
  return {
    id: "synthetic-token-id",
    user_id: USER,
    name: "box-sintetico",
    revoked_at: null,
    // Uso recente: niente UPDATE di last_used_at durante il test.
    last_used_at: new Date().toISOString(),
    expires_at: expiresAt,
    client_version: null,
    client_platform: null,
    client_capabilities: null,
  };
}

beforeEach(() => {
  mocks.inserted.length = 0;
  mocks.selected.length = 0;
  mocks.tokenRow = null;
  vi.useRealTimers();
});

describe("POST /api/cloud-sync/tokens", () => {
  it("un token creato senza scadenza non scade", async () => {
    const { POST } = await import("@/app/api/cloud-sync/tokens/route");

    const res = await POST(postRequest({ name: "box-sintetico" }));

    expect(res.status).toBe(201);
    expect(mocks.inserted).toHaveLength(1);
    expect(mocks.inserted[0].expires_at).toBeNull();
    await expect(res.json()).resolves.toMatchObject({ expires_at: null });
  });

  it("null e 0 restano «nessuna scadenza»", async () => {
    const { POST } = await import("@/app/api/cloud-sync/tokens/route");

    for (const expires_in_days of [null, 0]) {
      const res = await POST(postRequest({ name: "box", expires_in_days }));
      expect(res.status).toBe(201);
    }
    expect(mocks.inserted.map((row) => row.expires_at)).toEqual([null, null]);
  });

  it("una scadenza esplicita continua a funzionare", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const { POST } = await import("@/app/api/cloud-sync/tokens/route");

    const res = await POST(postRequest({ name: "box", expires_in_days: 30 }));

    expect(res.status).toBe(201);
    expect(mocks.inserted[0].expires_at).toBe(
      new Date(NOW + 30 * DAY).toISOString(),
    );
  });

  it("una scadenza chiesta ma non valida è rifiutata, non resa perpetua", async () => {
    const { POST } = await import("@/app/api/cloud-sync/tokens/route");

    for (const expires_in_days of [-1, "30", Number.NaN, 3651]) {
      const res = await POST(postRequest({ name: "box", expires_in_days }));
      expect(res.status).toBe(400);
    }
    expect(mocks.inserted).toHaveLength(0);
  });
});

describe("GET /api/cloud-sync/tokens", () => {
  it("la lista porta expires_at", async () => {
    const { GET } = await import("@/app/api/cloud-sync/tokens/route");

    const res = await GET();

    expect(res.status).toBe(200);
    expect(mocks.selected[0].split(/,\s*/)).toContain("expires_at");
  });
});

describe("token con scadenza esplicita ancora valido", () => {
  it("verifyBearerToken lo accetta e ping ne restituisce la scadenza al box", async () => {
    const expiresAt = new Date(Date.now() + 10 * DAY).toISOString();
    mocks.tokenRow = tokenRow(expiresAt);
    const { verifyBearerToken } = await import("@/lib/cloud-sync/auth");

    const verified = await verifyBearerToken(bearerRequest("jht_sync_synthetic_valid"));
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error("valid token rejected");
    expect(verified.data.expiresAt).toBe(expiresAt);

    const { GET } = await import("@/app/api/cloud-sync/ping/route");
    const res = await GET(bearerRequest("jht_sync_synthetic_valid"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toEqual({
      id: "synthetic-token-id",
      name: "box-sintetico",
      expires_at: expiresAt,
    });
    expect(JSON.stringify(body)).not.toContain("jht_sync_");
  });

  it("ping dice expires_at null per un token senza scadenza", async () => {
    mocks.tokenRow = tokenRow(null);
    const { GET } = await import("@/app/api/cloud-sync/ping/route");

    const res = await GET(bearerRequest("jht_sync_synthetic_forever"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      token: { expires_at: null },
    });
  });
});

describe("avviso di scadenza nella lista token", () => {
  async function expiryLib() {
    return import("@/lib/cloud-sync/token-expiry");
  }

  it("la soglia è dichiarata e il confine sta a 14 giorni", async () => {
    const { tokenExpiry, TOKEN_EXPIRY_WARNING_DAYS } = await expiryLib();
    expect(TOKEN_EXPIRY_WARNING_DAYS).toBe(14);

    const at = (days: number) => new Date(NOW + days * DAY).toISOString();
    expect(tokenExpiry(at(15), NOW)).toMatchObject({ kind: "active", daysLeft: 15, warning: false });
    expect(tokenExpiry(at(14), NOW)).toMatchObject({ kind: "active", daysLeft: 14, warning: true });
    expect(tokenExpiry(at(0.5), NOW)).toMatchObject({ kind: "active", daysLeft: 1, warning: true });
    expect(tokenExpiry(at(0), NOW)).toMatchObject({ kind: "expired" });
    expect(tokenExpiry(at(-3), NOW)).toMatchObject({ kind: "expired" });
    expect(tokenExpiry(null, NOW)).toEqual({ kind: "none" });
    expect(tokenExpiry("non-una-data", NOW)).toEqual({ kind: "unknown" });
  });

  async function render(locale: Locale, expiresAt: string | null) {
    const { TokenExpiryNotice } = await import(
      "@/app/(protected)/settings/cloud-sync/TokenExpiryNotice"
    );
    const html: string = renderToStaticMarkup(
      createElement(TokenExpiryNotice, { locale, expiresAt, now: NOW }),
    );
    const doc = new JSDOM(html).window.document;
    return { html, text: doc.body.textContent ?? "" };
  }

  it("sotto la soglia la riga diventa un avviso visibile, in ogni lingua", async () => {
    const expiresAt = new Date(NOW + 5 * DAY).toISOString();
    const texts = [];
    for (const locale of LOCALES) {
      const { html, text } = await render(locale, expiresAt);
      expect(html).toContain('role="alert"');
      expect(html).toContain('data-token-expiry="warning"');
      expect(text).toContain("2026-10-12");
      expect(text).toContain("5");
      expect(text).toContain("jht cloud enable --token");
      texts.push(text);
    }
    expect(new Set(texts).size).toBe(LOCALES.length);
  });

  it("sopra la soglia mostra data e giorni rimasti senza allarme", async () => {
    // Il caso reale: un token che scade il 25/10, visto il 07/10.
    const { html, text } = await render("it", "2026-10-25T00:00:00+00:00");
    expect(html).not.toContain('role="alert"');
    expect(html).toContain('data-token-expiry="active"');
    expect(text).toBe("Scadenza: 2026-10-25 · giorni rimasti: 18");
  });

  it("un token scaduto è un avviso, uno senza scadenza lo dice", async () => {
    const expired = await render("en", "2026-10-01T00:00:00.000Z");
    expect(expired.html).toContain('role="alert"');
    expect(expired.html).toContain('data-token-expiry="expired"');
    expect(expired.text).toContain("Expired on 2026-10-01");

    const none = await render("en", null);
    expect(none.html).not.toContain('role="alert"');
    expect(none.text).toBe("Expires: no expiry");
  });
});
