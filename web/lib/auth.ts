import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/workspace";
import { isCloudDeploy } from "@/lib/deploy-mode";
import { headers, cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  LOCAL_TOKEN_COOKIE,
  isLocalTokenAuthenticated,
} from "@/lib/local-token";

/**
 * Riconosce come "macchina dell'utente" gli host che il desktop
 * launcher usa per aprire il browser sulla app locale.
 */
export function isLocalhostHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/.test(
    host.toLowerCase(),
  );
}

/**
 * IP loopback (IPv4 / IPv6 / wildcard). Usato per validare forwarded
 * headers che provengono dal proxy interno di Next dev (sempre `::1`).
 */
function isLoopbackIp(ip: string): boolean {
  return /^(::1|127\.\d+\.\d+\.\d+|0\.0\.0\.0)$/.test(ip.trim());
}

/**
 * Header che indicano la presenza di un reverse-proxy. Quando uno di
 * questi header e' presente la richiesta NON puo' essere considerata
 * "direct localhost": x-forwarded-host e' client-controllable e
 * permetterebbe il bypass dell'auth su deployment esposti in rete.
 * Pattern: OpenClaw `hasForwardedRequestHeaders` (gateway/auth.ts).
 */
const FORWARDED_REQUEST_HEADERS = [
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-forwarded-host",
  "x-real-ip",
] as const;

export function hasForwardedRequestHeaders(hdrs: Headers): boolean {
  return FORWARDED_REQUEST_HEADERS.some((name) => hdrs.get(name) !== null);
}

/**
 * Variante più permissiva di `hasForwardedRequestHeaders`: ammette i
 * forwarded headers SOLO se l'origine remota è loopback (proxy interno
 * di Next dev server, che setta `x-forwarded-for=::1` su connessioni
 * dal Mac). Un attaccante remoto non può fakeare il loopback (l'IP
 * effettivo della connessione TCP non è loopback, e il proxy reverse
 * di un deploy reale lo riscrive con l'IP pubblico).
 *
 * Restituisce `true` (= proxy esterno NON-trusted, blocca) se uno dei
 * forwarded header indica origine non-loopback. `false` (= safe) se
 * mancano forwarded header o se sono tutti loopback.
 */
export function hasUntrustedForwardedHeaders(hdrs: Headers): boolean {
  // RFC 7239 `Forwarded`: difficile da parsare, conservativo: blocca se presente.
  if (hdrs.get("forwarded") !== null) return true;

  const xff = hdrs.get("x-forwarded-for");
  if (xff !== null) {
    // Lista "client, proxy1, proxy2"; il client è il primo hop.
    const firstHop = xff.split(",")[0]?.trim() ?? "";
    if (!isLoopbackIp(firstHop)) return true;
  }

  const xfh = hdrs.get("x-forwarded-host");
  if (xfh !== null && !isLocalhostHost(xfh)) return true;

  const xri = hdrs.get("x-real-ip");
  if (xri !== null && !isLoopbackIp(xri)) return true;

  // x-forwarded-proto è informativo (http/https), non identifica l'origine.
  return false;
}

/**
 * Helper sincrono che valuta una richiesta gia' parsata.
 *
 * Bypassa il check Supabase SOLO se la richiesta arriva direttamente
 * al socket dell'app (niente forwarded headers) E l'header `Host`
 * matcha localhost. Nessuna fiducia in `x-forwarded-host`.
 *
 * Usare questa variante in middleware (`proxy.ts`) e ovunque le
 * `Headers` siano gia' disponibili senza dover chiamare `headers()`.
 */
export function isLocalRequestFromHeaders(hdrs: Headers): boolean {
  // [JHT-DASHBOARD-SPLIT] Su un deploy CLOUD nessuna richiesta è mai
  // "locale", qualunque sia l'host: le corsie locali (SQLite, tmux,
  // filesystem ~/.jht) su quel deploy non esistono. Senza questo guard un
  // dev server in modalità cloud raggiunto via localhost imboccava le
  // corsie desktop e mostrava dati vuoti/sbagliati (profilo, 21/07) —
  // classe di bug intera, non caso singolo. In produzione Vercel è già
  // così di fatto (host = dominio); qui diventa deterministico.
  if (isCloudDeploy()) return false;
  // Header `Host` deve essere localhost.
  //
  // ⚠️ Fin dove regge: DIETRO UN REVERSE PROXY. Lì un attaccante remoto che
  // setta `Host: localhost` viene comunque bloccato, perché il proxy aggiunge
  // `x-forwarded-for` con un indirizzo non-loopback e il controllo sotto lo
  // rifiuta. Su un deploy locale esposto in rete SENZA proxy davanti la stessa
  // richiesta passa: `curl -H "Host: localhost" http://<ip>:3000/...` non manda
  // forwarded header, quindi non c'è niente da rifiutare. Il compose non
  // pubblica la porta web, per cui oggi quella configurazione non esiste — ma
  // è una proprietà del deploy, non di questa funzione.
  //
  // Conseguenza: questo verdetto sceglie la CORSIA (locale vs cloud) e alza il
  // tetto del rate limit; non è una prova di località, e non va usato da solo
  // per decidere chi legge roba che vive sul box. Per quello c'è
  // `requireLocalMachine`, che chiede il local-token (#161).
  const host = hdrs.get("host") ?? "";
  if (!isLocalhostHost(host)) return false;

  // Forwarded headers ammessi se TUTTI loopback (Next dev server li aggiunge
  // automaticamente sulle request al loopback con valori `::1`/`localhost`).
  // Un proxy esterno avrà valori non-loopback → blocca.
  if (hasUntrustedForwardedHeaders(hdrs)) return false;

  return true;
}

/** Helper per server components / route handler (App Router async). */
export async function isLocalRequest(): Promise<boolean> {
  return isLocalRequestFromHeaders(await headers());
}

/**
 * Controlla autenticazione sulle API route.
 *
 * Tre vie d'accesso, in ordine:
 *   1. Senza Supabase configurato: pass-through (deploy puramente locale).
 *   2. Local-token valido, via header `Authorization: Bearer` (chiamate da
 *      CLI/curl sul box). Il cookie `jht_local_token` viene ancora LETTO, ma
 *      nessuno lo scrive: vedi `lib/local-token.ts`.
 *   3. Sessione Supabase autenticata: pass-through.
 *
 * Negli altri casi 401. La vecchia bypass "l'host e' localhost" non
 * basta: gli header `Host`/`X-Forwarded-Host` sono client-controllabili
 * e venivano sfruttati per l'auth bypass (vedi finding C1).
 *
 * ⚠️ Accerta l'IDENTITÀ, non la LOCALITÀ della macchina. Chi espone roba che
 * esiste solo sul box aggiunge `requireLocalWrite` (scritture) o
 * `requireLocalSecretAccess` (segreti in lettura).
 */
export async function requireAuth(): Promise<NextResponse | null> {
  if (!isSupabaseConfigured) return null;

  const hdrs = await headers();
  const cookieStore = await cookies();
  const tokenCookie = cookieStore.get(LOCAL_TOKEN_COOKIE)?.value;
  if (isLocalTokenAuthenticated(hdrs.get("authorization"), tokenCookie))
    return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }
  return null;
}

/**
 * Write-guard WEB-READONLY: le AZIONI DI MODIFICA si fanno solo dall'app
 * desktop (host localhost). Dal browser cloud sono sola visualizzazione →
 * 403 `read_only`. È ANCHE sicurezza: i segreti che servirebbero per quelle
 * azioni (token Hetzner che accede a tutte le macchine, chiavi SSH, dati
 * personali) restano local-only, mai sincronizzati sul web.
 *
 * Uso nelle route che mutano stato, SUBITO dopo requireAuth:
 *   const auth = await requireAuth(); if (auth) return auth;
 *   const ro = await requireLocalWrite(); if (ro) return ro;
 *
 * NON usare (restano cloud-accessibili, per scelta 2026-06-20):
 *   - auth (login/logout) e sync-infra token-based (cloud-sync/*)
 *   - azioni-posizione "leggere": feedback like/dislike, ticket, write/geocode/
 *     recheck-request, user-exclude — intenzioni che viaggiano via cloud-sync
 *     verso la VPS (l'utente le vuole anche da telefono).
 */
export async function requireLocalWrite(): Promise<NextResponse | null> {
  // [JHT-DASHBOARD-SPLIT] Decisione DURA a build: su un deploy `cloud` la
  // scrittura di controllo/config/dati è disabilitata SEMPRE, a prescindere
  // dagli header (che sono client-controllabili). È la stessa conclusione di
  // isLocalRequest() sul cloud (host = dominio → false), ma resa deterministica
  // dal flag di build, non dedotta dalla richiesta. La corsia richieste async
  // (ticket/feedback/azioni-posizione leggere) NON passa di qui → resta cloud.
  if (isCloudDeploy()) return readOnlyResponse();
  if (await isLocalRequest()) return null;
  return readOnlyResponse();
}

/**
 * Gate di LOCALITÀ per le superfici che espongono il filesystem del box:
 * i segreti (`~/.jht/secrets.json`, che il codice attorno descrive come token
 * VPS e chiavi SSH) e i metadati che dicono cosa quel filesystem contiene.
 *
 * Perché non basta `requireAuth`: quello accerta CHI SEI, mai che la macchina
 * sia la tua. Una sessione Supabase valida è sufficiente ad arrivare in fondo
 * a una route.
 *
 * Perché non basta nemmeno l'header `Host`, che era la prima versione di
 * questo gate (#158): su un deploy locale raggiungibile in rete SENZA reverse
 * proxy davanti, `curl -H "Host: localhost" http://<ip>:3000/...` la supera —
 * curl non manda forwarded header, quindi `hasUntrustedForwardedHeaders` non
 * trova niente da rifiutare. Per "sei su questa macchina" un header non è una
 * prova: è un campo che scrive il client.
 *
 * La prova è il POSSESSO DEL LOCAL-TOKEN: 32 byte random in
 * `~/.jht/.local-token`, leggibili solo da chi è su quel filesystem. Non si
 * falsifica scrivendo un header, e dal #154 è fail-closed su deploy cloud
 * (`getOrCreateLocalToken` ritorna `null` lì, quindi nessun confronto può
 * riuscire) — per questo qui non serve un secondo guard su `isCloudDeploy`.
 *
 * ⚠️ Conseguenza dichiarata: un BROWSER non presenta il token, perché il
 * cookie `jht_local_token` oggi non lo scrive nessuno (#158 punto 2). Queste
 * superfici sono quindi raggiungibili da CLI/curl sul box, non dalle pagine —
 * che per `/secrets`, `/credentials` e `/backup` sono già desktop-only nel
 * layout `(protected)` e sul deploy cloud vengono rediratte. Il giorno che il
 * launcher vorrà autenticare il browser locale, il ponte è il setter Node del
 * cookie descritto in `lib/local-token.ts`, non un ritorno all'header.
 *
 * Distinta da `requireLocalWrite` di proposito: quella parla di scritture e
 * risponde "si fa dall'app desktop", che per una lettura sarebbe un consiglio
 * sbagliato. Qui la risposta non racconta cosa c'è dall'altra parte.
 */
export function requireLocalMachine(req: NextRequest): NextResponse | null {
  const proven = isLocalTokenAuthenticated(
    req.headers.get("authorization"),
    req.cookies.get(LOCAL_TOKEN_COOKIE)?.value,
  );
  return proven ? null : secretsUnavailableResponse();
}

function secretsUnavailableResponse(): NextResponse {
  return NextResponse.json({ error: "local_only" }, { status: 403 });
}

function readOnlyResponse(): NextResponse {
  return NextResponse.json(
    {
      error: "read_only",
      message:
        "Questa azione si fa dall'app desktop. Dal browser è sola visualizzazione.",
    },
    { status: 403 },
  );
}

/** Regex per path sicuri: alfanumerici, slash, underscore, trattino, punto, tilde, spazi, due punti */
const SAFE_PATH_RE = /^[a-zA-Z0-9\/_\-.~ :]+$/;

/**
 * Valida che un path non contenga traversal o caratteri pericolosi.
 */
export function isValidPath(p: string): boolean {
  return SAFE_PATH_RE.test(p) && !p.includes("..");
}
