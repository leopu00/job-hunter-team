// Icone della superficie /positions — SVG stroke come /swipe (viewBox 24,
// tratto 2, currentColor, round caps): niente emoji nella UI di prodotto.
//
// Perché anche i glifi «innocui» (⚙ ⚠ ↕): misurati nel browser il 2026-08-14
// con la font-stack della pagina (JetBrains Mono, cella da 27,6px a 40px di
// corpo), ⚙ e ⚠ sono `Extended_Pictographic` — cioè emoji per Unicode, e su
// Windows cadono sul font emoji a colori — mentre ↕ esce dal font del sito e
// misura 31px invece di 27,6: **la freccia di ordinamento è larga quanto
// decide il sistema operativo**. In una tabella a colonne fisse quella è una
// larghezza che non controlliamo. Un <svg> di 12px è 12px ovunque.
//
// ✓ e ✕ restano: non sono pittografici, li disegna il font del sito alla
// larghezza della cella mono, quindi non hanno nessuno dei due problemi.

import type { ReactNode } from "react";

function Svg({ children, size = 12 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="inline-block shrink-0"
    >
      {children}
    </svg>
  );
}

/** Cursori dei filtri: apre/chiude la sidebar. */
export function IconFilters({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </Svg>
  );
}

/**
 * Indicatore di ordinamento nell'intestazione di colonna.
 * `dir`: "none" = ordinabile ma non attiva · "asc"/"desc" = attiva.
 *
 * La larghezza è FISSA e nota (`SORT_ARROW_PX` in header-width.ts la mette in
 * conto): è il motivo per cui questa non è una freccia di testo.
 */
export function IconSort({
  dir,
  size,
}: {
  dir: "none" | "asc" | "desc";
  size?: number;
}) {
  if (dir === "asc") {
    return (
      <Svg size={size}>
        <path d="M12 20V5" />
        <path d="m6 11 6-6 6 6" />
      </Svg>
    );
  }
  if (dir === "desc") {
    return (
      <Svg size={size}>
        <path d="M12 4v15" />
        <path d="m6 13 6 6 6-6" />
      </Svg>
    );
  }
  return (
    <Svg size={size}>
      <path d="M12 4v16" />
      <path d="m8 8 4-4 4 4" />
      <path d="m8 16 4 4 4-4" />
    </Svg>
  );
}

/**
 * Freccia di una sezione a fisarmonica: `open` la ruota verso il basso.
 * Sostituisce ▶/▼ — la prima delle due è pittografica, la seconda no, quindi
 * lo stesso controllo aveva due destini diversi a seconda dello stato.
 */
export function IconChevron({ open, size }: { open: boolean; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 transition-transform"
      style={{ transform: open ? "rotate(90deg)" : undefined }}
    >
      <Svg size={size}>
        <path d="m9 5 7 7-7 7" />
      </Svg>
    </span>
  );
}

/** Il link esce dal sito: il segno che stava scritto «↗». */
export function IconExternal({ size = 10 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M14 4h6v6" />
      <path d="M20 4 10 14" />
      <path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10" />
    </Svg>
  );
}

/** Bandiera rossa dell'azienda: avviso, non allarme di sistema. */
export function IconAlert({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M12 3.5 22 20H2Z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </Svg>
  );
}
