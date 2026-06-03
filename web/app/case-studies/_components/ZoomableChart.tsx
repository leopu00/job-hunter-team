"use client";

import { useRef } from "react";

type Props = {
  label: string;
  children: React.ReactNode;
};

// Wraps a chart in a clickable card that expands to a near-fullscreen <dialog>
// on click. Uses native <dialog> (no portal/state library). The chart is
// rendered twice — once inline, once inside the dialog — to keep both views
// independent (the dialog instance scales to viewport).
export function ZoomableChart({ label, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  const open = () => ref.current?.showModal();
  const close = () => ref.current?.close();

  return (
    <>
      <div className="group relative w-full overflow-hidden rounded-md transition hover:ring-2 hover:ring-emerald-400">
        {children}
        <button
          type="button"
          onClick={open}
          className="absolute right-2 top-2 rounded bg-slate-900/80 px-2 py-1 text-[10px] font-semibold text-slate-100 opacity-80 transition hover:bg-slate-800 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          aria-label={`Apri ${label} a schermo intero`}
        >
          ⤢ fullscreen
        </button>
      </div>

      <dialog
        ref={ref}
        className="rounded-lg border border-slate-700 bg-slate-900 p-0 text-slate-100 shadow-2xl backdrop:bg-black/80 backdrop:backdrop-blur-sm"
        style={{ width: "min(92vw, 1280px)", maxHeight: "92vh" }}
        onClick={(e) => {
          if (e.target === ref.current) close();
        }}
      >
        <div className="relative max-h-[92vh] overflow-y-auto overflow-x-hidden">
          <button
            type="button"
            onClick={close}
            className="absolute right-3 top-3 z-20 rounded-full bg-slate-800/90 px-3 py-1 text-sm font-medium text-slate-100 shadow-lg transition hover:bg-slate-700"
            aria-label="Chiudi (Esc)"
          >
            ✕ Esc
          </button>
          <div className="w-full p-4 sm:p-6">
            <div className="w-full">{children}</div>
          </div>
        </div>
      </dialog>
    </>
  );
}
