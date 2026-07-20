"use client";

import { useEffect, useState } from "react";
import { isSeen, SEEN_EVENT } from "@/lib/seen-positions";

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
      className="inline-block shrink-0 self-center rounded border px-1 text-[8px] font-bold uppercase tracking-wider leading-[13px]"
      style={{
        color: "var(--color-green)",
        borderColor: "var(--color-green)",
        background: "color-mix(in srgb, var(--color-green) 10%, transparent)",
      }}
    >
      NEW
    </span>
  );
}
