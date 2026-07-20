"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import { POSITIONS_DECK_KEY } from "../DeckSaver";

// Precedente/Prossima tra le posizioni della lista così come l'utente
// l'ha filtrata e ordinata (sequenza salvata da DeckSaver in
// localStorage). Se questa posizione non è nella sequenza (arrivo
// diretto da link esterno, filtri cambiati) i bottoni non compaiono.
const T: Record<Locale, { prev: string; next: string }> = {
  it: { prev: "Precedente", next: "Prossima" },
  en: { prev: "Previous", next: "Next" },
  hu: { prev: "Előző", next: "Következő" },
  es: { prev: "Anterior", next: "Siguiente" },
  de: { prev: "Zurück", next: "Weiter" },
  fr: { prev: "Précédent", next: "Suivant" },
  pt: { prev: "Anterior", next: "Próxima" },
};

export default function PrevNextNav({ id }: { id: string }) {
  const t = T[useLocale()] ?? T.en;
  const [nav, setNav] = useState<{
    prev: string | null;
    next: string | null;
  } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(POSITIONS_DECK_KEY);
      if (!raw) return;
      const ids: string[] = JSON.parse(raw)?.ids ?? [];
      const i = ids.indexOf(id);
      if (i === -1) return;
      setNav({
        prev: i > 0 ? ids[i - 1] : null,
        next: i < ids.length - 1 ? ids[i + 1] : null,
      });
    } catch {
      // sequenza illeggibile → niente navigazione
    }
  }, [id]);

  if (!nav || (!nav.prev && !nav.next)) return null;

  // Link testuali senza bordi (scelta utente 20/07): la sottolineatura
  // arriva dall'a:hover globale al tap/hover, come ogni altro link.
  const cls = "inline-flex items-center gap-1 text-[12px] font-semibold";
  return (
    <div className="flex items-center justify-between gap-4">
      {nav.prev ? (
        <Link
          href={`/positions/${nav.prev}`}
          className={cls}
          style={{ color: "var(--color-base)" }}
        >
          ‹ {t.prev}
        </Link>
      ) : (
        <span
          className={`${cls} opacity-40`}
          style={{ color: "var(--color-dim)" }}
        >
          ‹ {t.prev}
        </span>
      )}
      {nav.next ? (
        <Link
          href={`/positions/${nav.next}`}
          className={cls}
          style={{ color: "var(--color-green)" }}
        >
          {t.next} ›
        </Link>
      ) : (
        <span
          className={`${cls} opacity-40`}
          style={{ color: "var(--color-dim)" }}
        >
          {t.next} ›
        </span>
      )}
    </div>
  );
}
