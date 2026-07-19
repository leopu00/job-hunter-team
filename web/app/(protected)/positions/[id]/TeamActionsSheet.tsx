"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

// Popup "Feedback e richieste": raccoglie in un'unica finestra il giudizio
// dell'utente (scala a 4 come /swipe) e tutte le azioni utente→team della
// posizione (geocodifica, recheck, CV, esclusione, ticket liberi). Su
// telefono sale dal basso come bottom-sheet, su desktop è un modal centrato.
// Prima erano 4+ bottoni impilati nell'header.
const T: Record<Locale, { label: string; close: string }> = {
  it: { label: "Feedback e richieste", close: "Chiudi" },
  en: { label: "Feedback & requests", close: "Close" },
  es: { label: "Feedback y solicitudes", close: "Cerrar" },
  fr: { label: "Feedback et demandes", close: "Fermer" },
  de: { label: "Feedback & Anfragen", close: "Schließen" },
  hu: { label: "Visszajelzés és kérések", close: "Bezárás" },
  pt: { label: "Feedback e pedidos", close: "Fechar" },
};

function IconSend({ size = 15 }: { size?: number }) {
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
    >
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

function IconClose({ size = 18 }: { size?: number }) {
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
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function TeamActionsSheet({
  feedback,
  actions,
  tickets,
  active = false,
}: {
  // Sezione giudizio (FeedbackButtons) in testa al popup — assente in
  // local mode, dove position_feedback non esiste.
  feedback?: ReactNode;
  actions: ReactNode;
  tickets?: ReactNode;
  // true quando c'è già qualcosa in corso (flag richiesti o ticket aperti):
  // accende il pallino sul trigger così l'utente sa che dentro c'è attività.
  active?: boolean;
}) {
  const t = T[useLocale()];
  const [open, setOpen] = useState(false);
  // Portal su document.body: il wrapper di pagina è animato con transform
  // (fade-in) e resterebbe il containing block dei fixed → l'overlay
  // coprirebbe il contenitore, non il viewport. mounted evita il portal in SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-[11px] font-semibold transition-colors hover:bg-[var(--color-row)]"
        style={{
          borderColor: "var(--color-purple)",
          color: "var(--color-purple)",
        }}
      >
        <IconSend />
        {t.label}
        {active && (
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: "var(--color-green)" }}
            aria-hidden="true"
          />
        )}
      </button>

      {open &&
        mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
            role="dialog"
            aria-modal="true"
            aria-label={t.label}
          >
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setOpen(false)}
            />
            <div
              className="relative w-full sm:max-w-md max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-2xl sm:rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
              style={{ animation: "fade-in 0.2s ease both" }}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="section-label">{t.label}</div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t.close}
                  className="p-1.5 rounded-lg text-[var(--color-dim)] hover:text-[var(--color-base)] hover:bg-[var(--color-row)] transition-colors"
                >
                  <IconClose />
                </button>
              </div>
              {feedback && (
                <div className="mb-4 pb-4 border-b border-[var(--color-border)]">
                  {feedback}
                </div>
              )}
              {/* items-stretch sui wrapper dei bottoni (nascono items-end per
                l'header largo): nel popup diventano righe a tutta larghezza. */}
              <div className="flex flex-col gap-2.5 [&>div]:items-stretch">
                {actions}
              </div>
              {tickets && (
                <div className="mt-5 pt-4 border-t border-[var(--color-border)]">
                  {tickets}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
