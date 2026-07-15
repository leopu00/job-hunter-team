"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  POSITIONS_COLUMNS,
  POSITIONS_COLS_COOKIE,
  DEFAULT_POSITIONS_COLUMNS,
  type PositionsColumnKey,
} from "./columns";

type Props = {
  // Coppie chiave→label localizzata, nell'ordine di render della tabella.
  columns: { key: PositionsColumnKey; label: string }[];
  // Colonne visibili al momento del render server (dal cookie).
  visible: PositionsColumnKey[];
  texts: { button: string; reset: string };
};

function writeCookie(cols: PositionsColumnKey[] | null) {
  // null = torna al default → si cancella il cookie invece di salvare la
  // lista default: così un futuro cambio di default vale anche per chi
  // non ha mai personalizzato.
  document.cookie =
    cols === null
      ? `${POSITIONS_COLS_COOKIE}=; path=/; max-age=0; SameSite=Lax`
      : `${POSITIONS_COLS_COOKIE}=${encodeURIComponent(cols.join(","))}; path=/; max-age=31536000; SameSite=Lax`;
}

// Picker colonne: bottone-pillola nella toolbar → pannello a checkbox.
// Ogni toggle riscrive il cookie e fa refresh del server component; la
// spunta locale si aggiorna subito (optimistic) per non aspettare l'RSC.
export default function ColumnsPicker({ columns, visible, texts }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Set<PositionsColumnKey>>(
    () => new Set(visible),
  );
  const [, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  // Il server resta la fonte: se il cookie cambia altrove (altro tab,
  // reset) il prossimo render server ci riallinea.
  useEffect(() => setChecked(new Set(visible)), [visible]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const apply = (next: Set<PositionsColumnKey>) => {
    setChecked(next);
    // Persisti nell'ordine canonico della tabella, non in ordine di click.
    writeCookie(POSITIONS_COLUMNS.filter((k) => next.has(k)));
    startTransition(() => router.refresh());
  };

  const toggle = (key: PositionsColumnKey) => {
    if (key === "title") return; // il titolo è il link: sempre visibile
    const next = new Set(checked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    next.add("title");
    apply(next);
  };

  const reset = () => {
    setChecked(new Set(DEFAULT_POSITIONS_COLUMNS));
    writeCookie(null);
    startTransition(() => router.refresh());
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="px-2 py-0.5 text-[10px] font-semibold rounded-full border transition-colors cursor-pointer"
        style={
          open
            ? {
                color: "var(--color-bright)",
                borderColor: "var(--color-green)",
                background: "var(--color-card)",
              }
            : {
                color: "var(--color-dim)",
                borderColor: "var(--color-border)",
                background: "transparent",
              }
        }
      >
        {texts.button} ▾
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-2 z-50 min-w-[200px] rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] py-2 shadow-xl"
          role="menu"
        >
          {columns.map(({ key, label }) => (
            <label
              key={key}
              className={`flex items-center gap-2.5 px-3 py-1.5 text-[11px] ${
                key === "title"
                  ? "text-[var(--color-dim)] cursor-default"
                  : "text-[var(--color-base)] cursor-pointer hover:bg-[var(--color-row)]"
              }`}
            >
              <input
                type="checkbox"
                checked={checked.has(key)}
                disabled={key === "title"}
                onChange={() => toggle(key)}
                className="accent-[var(--color-green)]"
              />
              {label}
            </label>
          ))}
          <div className="border-t border-[var(--color-border)] mt-1.5 pt-1.5 px-3">
            <button
              type="button"
              onClick={reset}
              className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-bright)] transition-colors cursor-pointer"
            >
              {texts.reset}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
