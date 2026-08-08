// Lettura dell'header `X-JHT-Client` che ogni box appone alle chiamate
// cloud-sync (`cli/src/lib/client-identity.js`). Formato in chiaro:
//
//   version=0.3.5; platform=linux; capabilities=chat,file-bridge
//
// Il parsing è deliberatamente severo: l'header arriva da un client che non
// controlliamo, e quello che passa di qui finisce in una colonna letta da una
// dashboard. Chiavi fuori dalla whitelist, valori fuori forma o header
// abnormi vengono scartati senza far fallire la request — la telemetria è
// un di più, non una condizione per sincronizzare.

export interface ClientIdentity {
  version: string | null;
  platform: string | null;
  capabilities: string[];
}

export interface StoredClientIdentity {
  client_version?: string | null;
  client_platform?: string | null;
  client_capabilities?: string[] | null;
}

// Oltre questa soglia l'header non è più una dichiarazione ma un tentativo:
// tre campi corti non arrivano lontanamente a 512 caratteri.
const MAX_HEADER_LENGTH = 512;
const MAX_CAPABILITIES = 32;

const VERSION_RE = /^[A-Za-z0-9._+-]{1,32}$/;
const CAPABILITY_RE = /^[a-z0-9-]{1,32}$/;
// Allineato al CHECK di `client_platform` in 064: un valore fuori lista
// verrebbe rifiutato dal DB, quindi lo normalizziamo qui.
const PLATFORMS = new Set(["linux", "macos", "windows", "unknown"]);

export function parseClientHeader(raw: string | null): ClientIdentity | null {
  if (!raw || raw.length > MAX_HEADER_LENGTH) return null;

  let version: string | null = null;
  let platform: string | null = null;
  const capabilities: string[] = [];

  for (const segment of raw.split(";")) {
    const eq = segment.indexOf("=");
    if (eq < 0) continue;
    const key = segment.slice(0, eq).trim().toLowerCase();
    const value = segment.slice(eq + 1).trim();

    if (key === "version" && VERSION_RE.test(value)) {
      version = value;
    } else if (key === "platform" && PLATFORMS.has(value.toLowerCase())) {
      platform = value.toLowerCase();
    } else if (key === "capabilities") {
      for (const cap of value.split(",")) {
        const flag = cap.trim().toLowerCase();
        if (!CAPABILITY_RE.test(flag)) continue;
        if (capabilities.includes(flag)) continue;
        if (capabilities.length >= MAX_CAPABILITIES) break;
        capabilities.push(flag);
      }
    }
  }

  if (!version && !platform && capabilities.length === 0) return null;
  return { version, platform, capabilities };
}

/**
 * Vero quando la dichiarazione differisce da quella già registrata. Un box
 * ripete lo stesso header per settimane: senza questo confronto pagheremmo
 * una UPDATE per ogni aggiornamento di `last_used_at` senza imparare nulla.
 */
export function clientIdentityChanged(
  stored: StoredClientIdentity,
  incoming: ClientIdentity,
): boolean {
  return (
    (stored.client_version ?? null) !== incoming.version ||
    (stored.client_platform ?? null) !== incoming.platform ||
    (stored.client_capabilities ?? []).join(",") !==
      incoming.capabilities.join(",")
  );
}

/**
 * Le colonne aggiunte dalla migration 064, come lista per una `select`.
 *
 * Esistono separate perché il codice che le legge può andare in produzione
 * PRIMA che la migration sia applicata — il deploy del web e quello dello
 * schema sono due gesti distinti, in quest'ordine o nell'altro. Chiederle a
 * un database che non le ha ancora significherebbe far fallire ogni
 * chiamata cloud-sync per una colonna di telemetria: la stessa trappola per
 * cui `useChatLaneLive` tratta le colonne `chat_*` come opzionali.
 */
export const CLIENT_COLUMNS =
  "client_version, client_platform, client_capabilities, client_seen_at";

/**
 * L'errore dice «quella colonna non esiste» — cioè la 064 non è ancora
 * passata. `42703` è `undefined_column` di Postgres; il controllo sul testo
 * copre i casi in cui PostgREST non propaga il codice.
 */
export function missingClientColumns(
  error: {
    code?: string | null;
    message?: string | null;
  } | null,
): boolean {
  if (!error) return false;
  if (error.code === "42703") return true;
  const message = String(error.message ?? "").toLowerCase();
  return (
    message.includes("client_version") ||
    message.includes("client_capabilities")
  );
}

/** Colonne da scrivere su `cloud_sync_tokens` per questa dichiarazione. */
export function clientIdentityPatch(
  incoming: ClientIdentity,
  seenAt: string,
): Record<string, unknown> {
  return {
    client_version: incoming.version,
    client_platform: incoming.platform,
    client_capabilities: incoming.capabilities,
    client_seen_at: seenAt,
  };
}
