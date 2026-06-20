"use client";

// Tooltip isolato per i grafici: vive in un proprio componente con stato
// interno e portal su <body>, così l'hover aggiorna SOLO questo layer e MAI i
// grafici → niente re-render delle celle e niente loop scrollbar (la pagina non
// "trema"). Condiviso tra /team/attivita e /case-studies.

import { forwardRef, useImperativeHandle, useState } from "react";
import { createPortal } from "react-dom";

export type TipRow = { color: string; label: string; value: string };

export type TooltipHandle = {
  show: (x: number, y: number, title: string, rows: TipRow[]) => void;
  move: (x: number, y: number) => void;
  hide: () => void;
};

export const TooltipLayer = forwardRef<TooltipHandle>(
  function TooltipLayer(_props, ref) {
    const [tip, setTip] = useState<{
      x: number;
      y: number;
      title: string;
      rows: TipRow[];
    } | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        show: (x, y, title, rows) => setTip({ x, y, title, rows }),
        move: (x, y) => setTip((t) => (t ? { ...t, x, y } : t)),
        hide: () => setTip(null),
      }),
      [],
    );

    if (!tip || typeof document === "undefined") return null;

    // Il box si apre sempre VERSO il centro dello schermo: ancoriamo a `right`
    // quando il cursore è nella metà destra (e a `bottom` nella metà bassa), così
    // non esce mai dai bordi qualunque sia la larghezza del contenuto — niente
    // stima di larghezza, niente scrollbar.
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const onRight = tip.x > vw / 2;
    const onBottom = tip.y > vh / 2;
    const pos: React.CSSProperties = onRight
      ? { right: Math.max(8, vw - tip.x + 14) }
      : { left: Math.max(8, tip.x + 14) };
    if (onBottom) pos.bottom = Math.max(8, vh - tip.y + 14);
    else pos.top = tip.y + 14;

    return createPortal(
      <div
        className="fixed z-[9999] pointer-events-none rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2.5 py-1.5 shadow-lg"
        style={{ ...pos, maxWidth: 240 }}
      >
        <div className="text-[10px] font-semibold text-[var(--color-white)] mb-0.5 whitespace-nowrap">
          {tip.title}
        </div>
        {tip.rows.map((r, i) => (
          <div key={i} className="flex items-center gap-1.5 whitespace-nowrap">
            <span
              className="inline-block w-2 h-2 rounded-sm shrink-0"
              style={{ background: r.color }}
            />
            <span className="text-[10px] text-[var(--color-muted)]">
              {r.label}
            </span>
            {r.value !== "" && (
              <span className="text-[10px] font-bold text-[var(--color-white)] tabular-nums ml-1">
                {r.value}
              </span>
            )}
          </div>
        ))}
      </div>,
      document.body,
    );
  },
);
