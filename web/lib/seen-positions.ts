"use client";

// Stato "posizione vista" — SOLO client-side (localStorage), per browser.
// "Nuova" qui significa "mai aperta dall'utente", NON "trovata da poco":
// il marker sparisce quando l'utente resta sulla pagina della posizione
// per qualche secondo (vedi MarkSeenAfterView), mai per anzianità.
//
// Scelta deliberata per la prima iterazione: niente scritture server
// ([JHT-WEB-READONLY] resta intatto), niente migration. Se servirà lo
// stato cross-device si promuove a tabella Supabase con RLS user_id e
// questo modulo diventa il fallback offline.

const KEY = "jht.seen-positions.v1";
const MAX_ENTRIES = 5000;
export const SEEN_EVENT = "jht:seen-positions-changed";

type SeenMap = Record<string, number>;

function read(): SeenMap {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as SeenMap) : {};
  } catch {
    return {};
  }
}

export function isSeen(id: string): boolean {
  return read()[id] != null;
}

export function markSeen(id: string): void {
  if (typeof window === "undefined") return;
  const map = read();
  if (map[id] != null) return;
  map[id] = Date.now();
  // Cap: oltre MAX_ENTRIES si scartano le viste più vecchie — al peggio
  // qualche posizione antica torna a mostrare il pallino.
  const ids = Object.keys(map);
  if (ids.length > MAX_ENTRIES) {
    ids.sort((a, b) => map[a] - map[b]);
    for (const old of ids.slice(0, ids.length - MAX_ENTRIES)) delete map[old];
  }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // Quota piena / storage negato: il marker resta, nessun errore utente.
  }
  window.dispatchEvent(new CustomEvent(SEEN_EVENT, { detail: { id } }));
}
