"use client";

import { useEffect, useState } from "react";
import { isSeen, SEEN_EVENT } from "@/lib/seen-positions";

type Props = {
  id: string;
  // Tooltip/aria localizzato, passato dal chiamante (dict della pagina).
  label: string;
};

// Pallino "non ancora vista" accanto al titolo. Parte nascosto anche
// lato client e compare solo dopo il mount: localStorage non esiste in
// SSR e un render speculativo darebbe hydration mismatch.
export default function UnseenDot({ id, label }: Props) {
  const [unseen, setUnseen] = useState(false);

  useEffect(() => {
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
  }, [id]);

  if (!unseen) return null;
  return (
    <span
      title={label}
      aria-label={label}
      className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
      style={{ background: "var(--color-green)" }}
    />
  );
}
