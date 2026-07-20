"use client";

import { useEffect } from "react";

// Salva in localStorage la SEQUENZA (id ordinati) della lista posizioni
// così com'è filtrata e ordinata adesso. La pagina dettaglio la legge per
// offrire "precedente/prossima" senza tornare alla lista né rifare i
// filtri (scelta utente 20/07). Include TUTTE le posizioni filtrate, non
// solo la pagina corrente: la navigazione attraversa le pagine.
export const POSITIONS_DECK_KEY = "jht-positions-deck";

export default function DeckSaver({ ids }: { ids: string[] }) {
  useEffect(() => {
    try {
      localStorage.setItem(POSITIONS_DECK_KEY, JSON.stringify({ ids }));
    } catch {
      // storage pieno/negato: la navigazione prev/next semplicemente
      // non compare, nessun errore utente.
    }
  }, [ids]);
  return null;
}
