/**
 * Local token: auth per il browser caricato dal desktop launcher.
 *
 * Il file `~/.jht/.local-token` contiene 32 byte random in hex (64
 * caratteri). Generato lazy al primo accesso del server.
 *
 * L'unico canale VIVO è l'header `Authorization: Bearer <token>`, usato
 * dalle chiamate da CLI/curl sul box.
 *
 * 🚫 Il cookie `jht_local_token` viene LETTO ma NON viene scritto da
 * nessuno. Qui c'era scritto che lo setta il middleware: falso, e falso
 * per costruzione — il middleware gira su Edge runtime, dove `node:fs`
 * non esiste e questo file non è importabile (vedi il commento in testa
 * a `middleware.ts`). Nessun altro punto della codebase lo scrive: cercato
 * `jht_local_token` in tutto il repo, sono tutte letture. Una frase
 * sbagliata dentro il codice di autenticazione costa più che altrove —
 * fa contare una via d'accesso che non esiste, e la fa contare a chi sta
 * ragionando su chi può entrare. Il ramo cookie resta perché il giorno
 * che un setter lato Node servirà (browser del desktop nativo) è lì
 * pronto; finché non nasce, è inerte, e `local-token-cookie-claim.test.ts`
 * fallisce se qualcuno lo scrive senza aggiornare questo commento.
 * Precedente: `app/api/profile/route.ts` ha tolto del tutto la sua corsia
 * cookie il 24/07, per lo stesso motivo.
 *
 * Su deploy CLOUD questa corsia non esiste per definizione: il token
 * significa "il browser sta parlando col box co-locato", e su Vercel un
 * box non c'e'. Prima ci si affidava al fatto che la home "tipicamente"
 * non e' scrivibile — una proprieta' dell'ambiente, non del codice: se
 * un giorno lo diventasse, il token nascerebbe da solo e riaprirebbe i
 * rami local-first (scrivi su SQLite, rispondi `source: "local"`, il
 * cloud non vede nulla). E' la stessa scelta local-first che ha rotto il
 * pulsante candidatura. Ora la porta la chiude `isCloudDeploy()`.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { JHT_HOME } from "@/lib/jht-paths";
import { isCloudDeploy } from "@/lib/deploy-mode";

const TOKEN_FILE = path.join(JHT_HOME, ".local-token");
const TOKEN_BYTES = 32;
const TOKEN_HEX_RE = /^[a-f0-9]{64}$/i;

/** Nome del cookie usato per propagare il local-token al browser. */
export const LOCAL_TOKEN_COOKIE = "jht_local_token";

// In-memory cache: la prima `getOrCreateLocalToken()` legge/crea il
// file, le successive ritornano il valore in RAM. Conseguenza: una
// rotazione manuale del file (`rm ~/.jht/.local-token`) non viene
// rilevata finche' il processo non riparte. Accettabile per ora —
// jht non offre rotation in-process.
let cached: string | null = null;

function readToken(): string | null {
  try {
    const value = fs.readFileSync(TOKEN_FILE, "utf-8").trim();
    return TOKEN_HEX_RE.test(value) ? value.toLowerCase() : null;
  } catch {
    return null;
  }
}

function createToken(): string | null {
  try {
    fs.mkdirSync(JHT_HOME, { recursive: true, mode: 0o700 });
    const value = randomBytes(TOKEN_BYTES).toString("hex");
    fs.writeFileSync(TOKEN_FILE, value, { encoding: "utf-8", mode: 0o600 });
    return value;
  } catch {
    return null;
  }
}

/**
 * Ritorna il token corrente; lo crea se manca. `null` su deploy cloud (dove
 * la corsia locale non esiste) o se il filesystem e' read-only.
 *
 * Il guard cloud sta PRIMA della cache: un processo che avesse gia' letto un
 * token non deve poterlo servire a un deploy cloud.
 */
export function getOrCreateLocalToken(): string | null {
  if (isCloudDeploy()) return null;
  if (cached) return cached;
  cached = readToken() ?? createToken();
  return cached;
}

/** Estrae il token bearer da un header `Authorization`. */
export function extractBearerToken(
  headerValue: string | null | undefined,
): string | null {
  if (!headerValue) return null;
  const match = headerValue.match(/^Bearer\s+([a-f0-9]{64})$/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Estrae il token dal cookie `jht_local_token`, se presente e ben formato.
 * Nessuno scrive quel cookie oggi: vedi la nota in testa al file.
 */
export function extractCookieToken(
  cookieValue: string | null | undefined,
): string | null {
  if (!cookieValue) return null;
  return TOKEN_HEX_RE.test(cookieValue) ? cookieValue.toLowerCase() : null;
}

function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/**
 * Verifica se la richiesta presenta un local-token valido, via header
 * `Authorization: Bearer <hex>` (l'unico canale vivo) o via cookie
 * `jht_local_token` (che nessuno scrive). Confronto in tempo costante.
 *
 * Su deploy cloud e' SEMPRE `false`: senza token atteso non c'e' confronto
 * possibile, quindi nessun chiamante puo' entrare nel ramo "solo SQLite".
 */
export function isLocalTokenAuthenticated(
  headerValue: string | null | undefined,
  cookieValue: string | null | undefined,
): boolean {
  const expected = getOrCreateLocalToken();
  if (!expected) return false;
  const fromHeader = extractBearerToken(headerValue);
  if (fromHeader && timingSafeEquals(fromHeader, expected)) return true;
  const fromCookie = extractCookieToken(cookieValue);
  if (fromCookie && timingSafeEquals(fromCookie, expected)) return true;
  return false;
}
