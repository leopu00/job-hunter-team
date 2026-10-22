/**
 * CSRF guard per richieste mutanti.
 *
 * Pattern: OpenClaw `browserMutationGuardMiddleware`
 * (extensions/browser/src/browser/csrf.ts).
 *
 * Su richieste GET/HEAD/OPTIONS lasciamo passare (lo Same-Origin
 * Policy + auth bastano: niente effetto collaterale).
 *
 * Sui metodi mutanti (POST/PUT/PATCH/DELETE) controlliamo, in
 * ordine:
 *   1. `Sec-Fetch-Site === 'cross-site'` → reject (segnale forte
 *      del browser).
 *   2. Header `Origin` o `Referer` presente e combacia con
 *      `hostOrigin` (l'origin del server stesso, dedotto dai
 *      forwarded headers) → pass. Questa è la definizione canonica
 *      di same-origin: il browser dichiara che la richiesta parte
 *      dal nostro stesso dominio.
 *   3. Header `Origin` presente: deve essere in allowlist statica.
 *   4. Header `Referer` presente (e Origin assente): host estratto
 *      deve essere in allowlist statica.
 *   5. Niente Origin né Referer → pass (CLI / curl / Node script).
 *
 * Allowlist statica (fallback quando hostOrigin non disponibile,
 * tipicamente dev locale):
 *   - `http://localhost:{3000,3001,3002}` (dev locale)
 *   - `http://127.0.0.1:{3000,3001,3002}` (loopback IP-form)
 *   - origin pubblico cloud-sync, se settato in `JHT_PUBLIC_ORIGIN`
 *     (es. `https://jobhunter.team`).
 */

const STATIC_ALLOWED = new Set([
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:3002",
]);

function isMutatingMethod(method: string): boolean {
  const m = method.trim().toUpperCase();
  return m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE";
}

function publicOrigin(): string | null {
  const value = process.env.JHT_PUBLIC_ORIGIN?.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

export function isAllowedOrigin(value: string | null | undefined): boolean {
  const v = (value ?? "").trim();
  if (!v || v === "null") return false;
  if (STATIC_ALLOWED.has(v)) return true;
  const prod = publicOrigin();
  return prod !== null && v === prod;
}

function originFromReferer(referer: string): string | null {
  try {
    const url = new URL(referer);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

export interface MutationCheck {
  method: string;
  origin?: string | null;
  referer?: string | null;
  secFetchSite?: string | null;
  /**
   * Origin del server (es. `https://jobhunterteam.ai`), tipicamente
   * ricavato dai forwarded headers nel proxy. Quando l'Origin/Referer
   * della richiesta combaciano con questo, la richiesta è same-origin
   * per definizione e va lasciata passare anche se il dominio prod non
   * è in `STATIC_ALLOWED`/`JHT_PUBLIC_ORIGIN`.
   */
  hostOrigin?: string | null;
}

/**
 * Ritorna `true` se la richiesta deve essere rifiutata (403).
 * Esposta separatamente per i test unit.
 */
export function shouldRejectBrowserMutation(params: MutationCheck): boolean {
  if (!isMutatingMethod(params.method)) return false;

  const sfs = (params.secFetchSite ?? "").trim().toLowerCase();
  if (sfs === "cross-site") return true;

  const hostOrigin = (params.hostOrigin ?? "").trim();
  const origin = (params.origin ?? "").trim();
  if (origin) {
    if (hostOrigin && origin === hostOrigin) return false;
    return !isAllowedOrigin(origin);
  }

  const referer = (params.referer ?? "").trim();
  if (referer) {
    const ref = originFromReferer(referer);
    if (ref === null) return true;
    if (hostOrigin && ref === hostOrigin) return false;
    return !isAllowedOrigin(ref);
  }

  // Niente Origin né Referer: client non-browser. Pass-through.
  return false;
}

/**
 * Controllo STRETTO per le azioni che comandano la squadra o escono verso l'esterno
 * (L2/L3 di `lib/request-action.ts`, P1 della proposta «web capace»).
 *
 * Differisce da `shouldRejectBrowserMutation` in quattro punti, tutti voluti:
 *   - solo POST;
 *   - l'`Origin` è OBBLIGATORIO (l'assenza di Origin e Referer NON passa: un browser lo manda
 *     sempre su un POST, e chi non è un browser non ha un cookie di sessione da sfruttare);
 *   - il `Referer` non conta: solo l'Origin;
 *   - il corpo è `application/json` (un form o un `text/plain` cross-site non lo è).
 *
 * L'Origin deve combaciare con l'origin pubblico del sito. Se `JHT_PUBLIC_ORIGIN` è impostato è
 * l'UNICO ammesso: gli header `X-Forwarded-*` li scrive il proxy ma chi parla direttamente al
 * server li può inventare, e l'elenco dei localhost è per lo sviluppo. Senza quella variabile
 * valgono l'origin dedotto dal proxy e l'elenco dei localhost, come per il resto del sito.
 */
export type StrictRefusal =
  | "method_not_allowed"
  | "cross_site"
  | "origin_required"
  | "origin_not_allowed"
  | "origin_not_configured"
  | "unsupported_media_type";

export interface StrictMutationCheck extends MutationCheck {
  contentType?: string | null;
  /**
   * Sul deploy cloud l'origin pubblico DEVE essere configurato: senza, l'origin "giusto" si
   * ricaverebbe da `X-Forwarded-Host`, che chi parla direttamente al server può inventare.
   */
  requirePublicOrigin?: boolean;
}

export function strictMutationRefusal(
  params: StrictMutationCheck,
): StrictRefusal | null {
  if (params.method.trim().toUpperCase() !== "POST")
    return "method_not_allowed";

  // Un browser dice da dove parte la richiesta: se non è questo stesso sito, basta.
  const sfs = (params.secFetchSite ?? "").trim().toLowerCase();
  if (sfs && sfs !== "same-origin") return "cross_site";

  const origin = (params.origin ?? "").trim();
  if (!origin || origin === "null") return "origin_required";

  const configured = publicOrigin();
  if (configured === null && params.requirePublicOrigin) {
    return "origin_not_configured";
  }
  if (configured !== null) {
    if (origin !== configured) return "origin_not_allowed";
  } else {
    const hostOrigin = (params.hostOrigin ?? "").trim();
    const same = hostOrigin !== "" && origin === hostOrigin;
    if (!same && !STATIC_ALLOWED.has(origin)) return "origin_not_allowed";
  }

  const mediaType = (params.contentType ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json") return "unsupported_media_type";

  return null;
}
