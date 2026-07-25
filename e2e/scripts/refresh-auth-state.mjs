#!/usr/bin/env node
/**
 * Genera `e2e/auth-state.json` — lo storage state che sblocca gli spec
 * dell'area riservata — SENZA browser e SENZA OAuth.
 *
 * Perché non si fa il login a mano nella finestra di Playwright:
 *   1. Google rifiuta l'OAuth dai browser automatizzati ("this browser may not
 *      be secure"), e Chrome for Testing è uno di quelli.
 *   2. La porta di sviluppo non è tra i redirect URL autorizzati sul progetto
 *      Supabase, quindi anche superando il punto 1 il ritorno fallirebbe.
 *   3. Ogni sessione scade: un flusso manuale andrebbe rifatto a mano ogni ora.
 *
 * Come funziona invece: login email+password dell'account riservato ai test
 * contro l'endpoint `/auth/v1/token`, poi la sessione viene scritta nel cookie
 * nello stesso formato che usa @supabase/ssr (`base64-` + base64url del JSON,
 * spezzato in chunk da 3180 byte come fa il suo chunker). Nessun segreto in
 * più: la anon key è pubblica per costruzione (la sicurezza sta in RLS).
 *
 * Uso:
 *   node e2e/scripts/refresh-auth-state.mjs
 *   BASE_URL=http://127.0.0.1:3008 npx playwright test    # ora entra
 *
 * Le credenziali stanno in `e2e/.auth-credentials` (gitignored). Se il file
 * manca, questo script dice come ricrearlo e esce senza rumore.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const E2E_DIR = path.resolve(HERE, "..");
const REPO = path.resolve(E2E_DIR, "..");

const CREDS = path.join(E2E_DIR, ".auth-credentials");
const OUT = path.join(E2E_DIR, "auth-state.json");

// I domini su cui il cookie va installato: il test può girare su localhost o
// su 127.0.0.1, e per i cookie sono host distinti.
const HOSTS = ["localhost", "127.0.0.1"];

const MAX_CHUNK = 3180; // uguale a @supabase/ssr/utils/chunker
const BASE64_PREFIX = "base64-";

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function readCreds() {
  if (!fs.existsSync(CREDS)) {
    fail(
      `credenziali non trovate: ${CREDS}\n` +
        `  Il file è gitignored e contiene E2E_EMAIL / E2E_PASSWORD dell'account\n` +
        `  riservato ai test. Vedi e2e/README.md § Sessione.`,
    );
  }
  const env = {};
  for (const line of fs.readFileSync(CREDS, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  if (!env.E2E_EMAIL || !env.E2E_PASSWORD)
    fail(`${CREDS} non contiene E2E_EMAIL e E2E_PASSWORD`);
  return env;
}

/** URL e anon key: gli stessi default che usa l'app (web/lib/supabase/config.ts). */
function readSupabaseConfig() {
  const src = fs.readFileSync(
    path.join(REPO, "web", "lib", "supabase", "config.ts"),
    "utf8",
  );
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    src.match(/DEFAULT_URL\s*=\s*"([^"]+)"/)?.[1];
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    src.match(/DEFAULT_ANON_KEY\s*=\s*\n?\s*"([^"]+)"/)?.[1];
  if (!url || !key)
    fail("non riesco a ricavare URL/anon key da web/lib/supabase/config.ts");
  return { url, key };
}

function projectRef(url) {
  const m = url.match(/^https?:\/\/([^.]+)\./);
  if (!m) fail(`URL Supabase inatteso: ${url}`);
  return m[1];
}

/** base64url senza padding, come stringToBase64URL di @supabase/ssr. */
function toBase64Url(s) {
  return Buffer.from(s, "utf8").toString("base64url");
}

function chunk(value) {
  if (value.length <= MAX_CHUNK) return [value];
  const out = [];
  for (let i = 0; i < value.length; i += MAX_CHUNK)
    out.push(value.slice(i, i + MAX_CHUNK));
  return out;
}

async function signIn({ url, key }, email, password) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) {
    fail(
      `login rifiutato (HTTP ${res.status}): ${JSON.stringify(body).slice(0, 200)}`,
    );
  }
  return body;
}

function sessionToCookies(session, ref) {
  // auth-js serializza la sessione con JSON.stringify e @supabase/ssr la
  // riscrive come `base64-<base64url>`, spezzandola se supera MAX_CHUNK.
  const payload = JSON.stringify({
    access_token: session.access_token,
    token_type: session.token_type ?? "bearer",
    expires_in: session.expires_in,
    expires_at: Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600),
    refresh_token: session.refresh_token,
    user: session.user,
  });
  const encoded = BASE64_PREFIX + toBase64Url(payload);
  const parts = chunk(encoded);
  const base = `sb-${ref}-auth-token`;
  const names =
    parts.length === 1 ? [base] : parts.map((_, i) => `${base}.${i}`);

  const cookies = [];
  for (const host of HOSTS) {
    names.forEach((name, i) => {
      cookies.push({
        name,
        value: parts[i],
        domain: host,
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
        httpOnly: false,
        secure: false,
        sameSite: "Lax",
      });
    });
  }
  return { cookies, chunks: parts.length };
}

const creds = readCreds();
const cfg = readSupabaseConfig();
const ref = projectRef(cfg.url);

console.log(`[auth-state] login come ${creds.E2E_EMAIL} su ${ref}…`);
const session = await signIn(cfg, creds.E2E_EMAIL, creds.E2E_PASSWORD);
const { cookies, chunks } = sessionToCookies(session, ref);

fs.writeFileSync(
  OUT,
  JSON.stringify({ cookies, origins: [] }, null, 2) + "\n",
  { mode: 0o600 },
);

const mins = Math.round((session.expires_in ?? 3600) / 60);
console.log(
  `[auth-state] scritto ${path.relative(REPO, OUT)} — ` +
    `${cookies.length} cookie (${chunks} chunk × ${HOSTS.length} host), ` +
    `sessione valida ~${mins} min`,
);
console.log(
  `[auth-state] ora: BASE_URL=http://127.0.0.1:3008 npx playwright test`,
);
