import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Canarino di produzione — SOLA LETTURA.
 *
 * Domanda: «l'Auth vera e l'account di test funzionano, e /dashboard si apre
 * sul sito vivo?». Non è un gate di PR (quello, se l'operatore lo sceglie,
 * gira su un Supabase locale: job `e2e-local-supabase`). Gira solo dal job
 * `smoke` (cron o dispatch con `smoke: true`).
 *
 * Cosa fa, e basta:
 *   1. login email+password su /auth/v1/token (una sessione);
 *   2. GET /dashboard con quella sessione, pretende 200 e la pagina resa;
 *   3. logout con scope=local: revoca SOLO questa sessione (lo scope di
 *      default, global, butterebbe fuori anche un job `e2e` in corso con lo
 *      stesso account), e verifica che il token non valga più.
 * Nessuna scrittura sulle tabelle: niente POST/PATCH/DELETE alle route API.
 */

const ENABLED = process.env.E2E_PROD_CANARY === "1";

/** URL e anon key: env, poi gli stessi default dell'app. */
function supabaseConfig(): { url: string; key: string } {
  const src = fs.readFileSync(
    path.resolve(__dirname, "..", "..", "web", "lib", "supabase", "config.ts"),
    "utf8",
  );
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    src.match(/DEFAULT_URL\s*=\s*"([^"]+)"/)?.[1];
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    src.match(/DEFAULT_ANON_KEY\s*=\s*\n?\s*"([^"]+)"/)?.[1];
  if (!url || !key) throw new Error("URL/anon key Supabase non ricavabili");
  return { url, key };
}

/** Stesso formato di @supabase/ssr (vedi e2e/scripts/refresh-auth-state.mjs). */
function sessionCookies(session: Record<string, unknown>, supabaseUrl: string, siteUrl: string) {
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  const payload = JSON.stringify({
    access_token: session.access_token,
    token_type: session.token_type ?? "bearer",
    expires_in: session.expires_in,
    expires_at:
      Math.floor(Date.now() / 1000) + Number(session.expires_in ?? 3600),
    refresh_token: session.refresh_token,
    user: session.user,
  });
  const encoded = "base64-" + Buffer.from(payload, "utf8").toString("base64url");
  const MAX_CHUNK = 3180;
  const parts: string[] = [];
  for (let i = 0; i < encoded.length; i += MAX_CHUNK)
    parts.push(encoded.slice(i, i + MAX_CHUNK));
  const base = `sb-${ref}-auth-token`;
  return parts.map((value, i) => ({
    name: parts.length === 1 ? base : `${base}.${i}`,
    value,
    url: siteUrl,
  }));
}

test.describe("canarino produzione @prod-canary", () => {
  test.skip(!ENABLED, "solo dal job smoke (E2E_PROD_CANARY=1)");

  test("login, /dashboard reso, logout @prod-canary", async ({
    page,
    baseURL,
    playwright,
  }) => {
    const email = process.env.E2E_EMAIL;
    const password = process.env.E2E_PASSWORD;
    expect(email && password, "E2E_EMAIL/E2E_PASSWORD mancanti").toBeTruthy();

    const cfg = supabaseConfig();
    const auth = await playwright.request.newContext({
      baseURL: cfg.url,
      extraHTTPHeaders: { apikey: cfg.key },
    });

    const login = await auth.post("/auth/v1/token?grant_type=password", {
      data: { email, password },
    });
    expect(login.status(), "login rifiutato dall'Auth di produzione").toBe(200);
    const session = await login.json();
    const bearer = { Authorization: `Bearer ${session.access_token}` };

    try {
      await page.context().addCookies([
        ...sessionCookies(session, cfg.url, baseURL!),
        // L'account di test è vuoto: senza, /dashboard rimanda al wizard.
        { name: "jht_welcome_seen", value: "1", url: baseURL! },
      ]);

      const probe = await page.request.get("/dashboard", { maxRedirects: 0 });
      expect(probe.status(), "/dashboard non risponde 200 con la sessione").toBe(200);

      const res = await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
      expect(res?.status()).toBe(200);
      expect(new URL(page.url()).pathname).toBe("/dashboard");
      await expect(page.locator("body")).not.toContainText("Application error");
      await expect(page.locator("body")).not.toBeEmpty();
    } finally {
      // Il logout gira anche se l'asserzione sopra è rossa: una sessione
      // lasciata viva in produzione è proprio quello che il canarino evita.
      const logout = await auth.post("/auth/v1/logout?scope=local", {
        headers: bearer,
      });
      expect(logout.status(), "logout non riuscito").toBe(204);
      const after = await auth.get("/auth/v1/user", { headers: bearer });
      expect(after.status(), "la sessione vale ancora dopo il logout").not.toBe(200);
      await auth.dispose();
    }
  });
});
