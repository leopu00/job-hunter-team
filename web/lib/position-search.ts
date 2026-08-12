// O-60 — cosa vuol dire "cercare una posizione".
//
// La richiesta dell'operatore era: un campo dove scrivere «nome azienda, id,
// ecc.» e trovare l'offerta. Le tre cose che rendono una ricerca inutile, e
// che qui sono decise una volta sola per web e per il resto:
//
//   1. cercare solo su quello che è già a schermo. La lista mostra una pagina
//      per volta e, di default, solo le posizioni con un punteggio: cercare
//      lì dentro risponde «nessun risultato» su un database che quel
//      risultato ce l'ha. Per questo il match scende nella query, e chi
//      cerca vede TUTTE le posizioni;
//   2. non accettare l'ID nella forma in cui l'utente lo legge. In tabella e
//      nell'URL l'identificativo appare come "JHT-042": chi lo copia se lo
//      porta dietro con il prefisso e con gli zeri;
//   3. cercare sul testo troncato. I titoli in tabella finiscono con
//      l'ellissi ("AI Automations Product Engi…"): il match va fatto sul
//      dato, mai su ciò che si vede.

/** Cosa è stato riconosciuto in una query. */
export type PositionQuery = {
  /** Testo normalizzato (minuscolo, senza spazi ai bordi). Vuoto = nessuna ricerca. */
  text: string;
  /** L'id numerico, se la query lo nomina: "42", "JHT-042", "jht 42". */
  legacyId: number | null;
};

// "JHT-042" · "jht042" · "JHT 42" · "#42" · "42" → 42. Gli zeri iniziali
// spariscono perché nel database l'id è un intero: chi copia l'etichetta
// dalla tabella non deve accorgersi della differenza.
const ID_PATTERNS = [
  /^jht[\s\-_#]*0*(\d{1,9})$/i,
  /^#\s*0*(\d{1,9})$/,
  /^0*(\d{1,9})$/,
];

export function parsePositionQuery(
  raw: string | undefined | null,
): PositionQuery {
  const text = (raw ?? "").trim().toLowerCase();
  if (!text) return { text: "", legacyId: null };
  for (const re of ID_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      // L'id resta insieme al testo, non al suo posto: "42" può essere anche
      // un pezzo di titolo ("Junior Java 42h"), e scartare quel caso
      // renderebbe la ricerca meno capace proprio sul dato più corto.
      if (Number.isSafeInteger(n) && n > 0) return { text, legacyId: n };
    }
  }
  return { text, legacyId: null };
}

/** I campi su cui si cerca, nell'ordine in cui la gente li nomina. */
export type SearchableRow = {
  legacy_id?: number | null;
  title?: string | null;
  company?: string | null;
  loc_city?: string | null;
  loc_country?: string | null;
  role_family?: string | null;
  source?: string | null;
};

/**
 * Il match, applicato in memoria. È la stessa regola che le query spingono
 * nel database: vive qui perché i due rami — Supabase e SQLite — non
 * possano rispondere due cose diverse alla stessa domanda.
 */
export function matchesPositionQuery(
  row: SearchableRow,
  q: PositionQuery,
): boolean {
  if (!q.text) return true;
  if (q.legacyId != null && row.legacy_id === q.legacyId) return true;
  const hay = [
    row.title,
    row.company,
    row.loc_city,
    row.loc_country,
    row.role_family,
    row.source,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q.text);
}

/** Il testo per le clausole LIKE/ILIKE, con i caratteri jolly neutralizzati. */
export function likePattern(text: string): string {
  // `%` e `_` in una query utente non devono diventare jolly: chi cerca
  // "50%_remote" cerca quella stringa, non "50 qualsiasi cosa remote".
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
