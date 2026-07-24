"use client";

import { useEffect, useState } from "react";
import { isSeen, SEEN_EVENT } from "@/lib/seen-positions";
import { useTheme } from "@/app/theme-provider";

// I titoli delle posizioni sono verdi, quindi il badge NON può esserlo: si
// confondeva col titolo. Ambra — l'unica tinta libera sulla riga, la scala
// score usa verde→giallo→arancio→rosso. Literal hex e non una var CSS: una
// variabile referenziata solo da style inline viene potata dalla build
// (Tailwind v4 / Lightning CSS), stesso motivo di BUDGET_LINE nei grafici
// case-studies. Su fondo chiaro serve la stessa tinta più scura per leggerla.
const NEW_BADGE = { dark: "#f5a623", light: "#b26a00" } as const;

type Props = {
  id: string;
  // Tooltip/aria localizzato, passato dal chiamante (dict della pagina).
  label: string;
  // true = il server sa già che è vista (position_views): pallino mai
  // mostrato. undefined/false → decide il client via localStorage, che
  // copre anche la finestra tra il mark-seen e il prossimo render server.
  initialSeen?: boolean;
};

// Tag "NEW" in coda al titolo per le posizioni non ancora viste (era un
// pallino, poco leggibile e disallineato — scelta utente 20/07). Parte
// nascosto anche lato client e compare solo dopo il mount: localStorage
// non esiste in SSR e un render speculativo darebbe hydration mismatch.
export default function UnseenDot({ id, label, initialSeen }: Props) {
  const [unseen, setUnseen] = useState(false);
  const { resolvedTheme } = useTheme();
  const color = NEW_BADGE[resolvedTheme] ?? NEW_BADGE.dark;

  useEffect(() => {
    if (initialSeen) return;
    const update = () => setUnseen(!isSeen(id));
    update();
    // SEEN_EVENT = stessa tab (es. ritorno da una detail page in-app);
    // "storage" = altre tab dello stesso browser.
    window.addEventListener(SEEN_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(SEEN_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, [id, initialSeen]);

  if (!unseen) return null;
  return (
    <span
      title={label}
      aria-label={label}
      // display:inline (NON inline-block): dentro il titolo delle card, che è
      // un -webkit-box con line-clamp, un inline-block è un atomic inline e
      // WebKit lo conta come contenuto oltre il taglio → stampa un "…" anche
      // quando il titolo ci sta tutto. In inline bordo e padding si disegnano
      // uguale; nei contenitori flex (tabelle) resta un flex item come prima.
      // In inline il box NON allarga la riga: se è più alto della line-box del
      // titolo, l'overflow:hidden del line-clamp gli rade il bordo inferiore.
      // Con py-[1px] e vertical-align sollevato di 1px sta dentro i ~17.9px
      // della riga (titolo 13px × leading-snug).
      className="inline shrink-0 self-center rounded border px-1 py-[1px] text-[8px] font-bold uppercase tracking-wider leading-none"
      style={{
        color,
        borderColor: color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        verticalAlign: "1px",
      }}
    >
      NEW
    </span>
  );
}
