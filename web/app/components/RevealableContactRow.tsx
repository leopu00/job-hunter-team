"use client";

import { useState } from "react";

/**
 * Riga contatto con PII mascherata (reveal-on-click). Stesso look di ContactRow
 * ma il valore (es. telefono) è nascosto finché l'utente non clicca "Mostra".
 * Mascherato al primo render (SSR + idratazione) → nessun flash del dato.
 */
function maskValue(value: string): string {
  // tiene le ultime 3 cifre/caratteri significativi, maschera il resto
  const visible = 3;
  return value
    .split("")
    .map((ch, i) => (i >= value.length - visible || ch === " " || ch === "+" ? ch : "•"))
    .join("");
}

export default function RevealableContactRow({
  icon,
  label,
  value,
  hrefPrefix = "",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hrefPrefix?: string;
}) {
  const [revealed, setRevealed] = useState(false);

  const rowClass =
    "flex items-center gap-3 px-3 py-2 rounded bg-[var(--color-panel)] border border-[var(--color-border)] transition-colors hover:border-[var(--color-border-glow)]";

  const iconSvg = (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="flex-shrink-0"
      style={{ color: "var(--color-muted)" }}
    >
      {icon}
    </svg>
  );

  const body = (
    <div className="flex-1 min-w-0">
      <span className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-dim)] block">
        {label}
      </span>
      <span
        className={`text-[11px] truncate block ${revealed ? "text-[var(--color-bright)]" : "text-[var(--color-muted)] font-mono"}`}
      >
        {revealed ? value : maskValue(value)}
      </span>
    </div>
  );

  if (revealed) {
    return (
      <a
        href={`${hrefPrefix}${value}`}
        className={`${rowClass} no-underline`}
        target={hrefPrefix.startsWith("tel:") || hrefPrefix.startsWith("mailto:") ? undefined : "_blank"}
        rel="noopener noreferrer"
      >
        {iconSvg}
        {body}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setRevealed(true)}
      aria-label={`Mostra ${label}`}
      className={`${rowClass} w-full text-left cursor-pointer`}
    >
      {iconSvg}
      {body}
      <span className="text-[9px] font-semibold tracking-[0.1em] uppercase text-[var(--color-dim)] flex-shrink-0 border border-[var(--color-border)] rounded px-1.5 py-0.5">
        Mostra
      </span>
    </button>
  );
}
