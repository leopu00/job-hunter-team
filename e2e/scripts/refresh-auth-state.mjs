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
 *   BASE_URL=http://localhost:3008 npx playwright test    # ora entra
 *
 * ⚠️ `localhost`, non `127.0.0.1`: contro `next dev` Next rifiuta l'upgrade
 * WebSocket dell'HMR se l'host è diverso, e senza HMR React non idrata (pagine
 * visibili, click che non fanno nulla).
 *
 * Le credenziali si cercano in ordine: variabili d'ambiente (è così che le
 * riceve la CI) → `e2e/.auth-credentials` del worktree → `~/.config/jht/
 * e2e-credentials`, che è la posizione canonica perché vale per TUTTI i
 * worktree. Se non si trovano, lo script dice dove ha guardato ed esce.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const E2E_DIR = path.resolve(HERE, "..");
const REPO = path.resolve(E2E_DIR, "..");

const OUT = path.join(E2E_DIR, "auth-state.json");

// ── Dove cercare le credenziali, in ordine ──────────────────────────────
//
// Il repo è sviluppato su più worktree in parallelo (dev1…dev8, master): un
// file di credenziali dentro *un* worktree serve solo a quello, e gli altri si
// ritroverebbero i test skippati senza capire perché. Quindi la posizione
// canonica è **fuori dai worktree**, in `~/.config/jht/` — una sola copia del
// segreto, valida ovunque.
//
// Non `~/.jht/`: quella directory è bind-mountata dentro il container degli
// agenti, e un segreto di test non ha motivo di finire sotto i loro occhi.
const XDG =
  process.env.XDG_CONFIG_HOME ||
  path.join(process.env.HOME || process.env.USERPROFILE || "", ".config");
const SHARED_CREDS = path.join(XDG, "jht", "e2e-credentials");
const LOCAL_CREDS = path.join(E2E_DIR, ".auth-credentials");

const CRED_SOURCES = [
  // 1. Ambiente: è così che le riceve la CI (dai repository secrets).
  { kind: "env", path: "(variabili d'ambiente E2E_EMAIL / E2E_PASSWORD)" },
  // 2. File del worktree corrente: sovrascrive quello condiviso, utile per
  //    provare un account diverso senza toccare gli altri worktree.
  { kind: "file", path: LOCAL_CREDS },
  // 3. File condiviso: la posizione canonica.
  { kind: "file", path: SHARED_CREDS },
];

// I domini su cui il cookie va installato: il test può girare su localhost o
// su 127.0.0.1, e per i cookie sono host distinti.
const HOSTS = ["localhost", "127.0.0.1"];

const MAX_CHUNK = 3180; // uguale a @supabase/ssr/utils/chunker
const BASE64_PREFIX = "base64-";

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function parseEnvFile(file) {
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

function readCreds() {
  for (const source of CRED_SOURCES) {
    if (source.kind === "env") {
      if (process.env.E2E_EMAIL && process.env.E2E_PASSWORD) {
        return {
          E2E_EMAIL: process.env.E2E_EMAIL,
          E2E_PASSWORD: process.env.E2E_PASSWORD,
          from: source.path,
        };
      }
      continue;
    }
    if (!fs.existsSync(source.path)) continue;
    const env = parseEnvFile(source.path);
    if (env.E2E_EMAIL && env.E2E_PASSWORD) return { ...env, from: source.path };
    console.warn(
      `[auth-state] ${source.path} esiste ma non contiene E2E_EMAIL/E2E_PASSWORD — proseguo`,
    );
  }
  fail(
    `credenziali dell'account di test non trovate. Cercate, in ordine:\n` +
      CRED_SOURCES.map((s) => `    • ${s.path}`).join("\n") +
      `\n\n  La posizione canonica è la terza: un solo file, valido da ogni worktree.\n` +
      `  Vedi e2e/README.md § Sessione.`,
  );
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

console.log(`[auth-state] credenziali da: ${creds.from}`);
console.log(`[auth-state] login su ${ref}…`);
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
  `[auth-state] ora: BASE_URL=http://localhost:3008 npx playwright test`,
);
