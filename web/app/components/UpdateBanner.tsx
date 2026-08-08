"use client";

// [NO-UPDATE-SIGNAL-TO-THE-USER] La fascia che dice a un utente che il suo
// box è rimasto indietro.
//
// Misurato in produzione il 2026-08-03: un account attivo pairato il giorno
// prima della 0.3.0, nessuna traccia di un aggiornamento, tag corrente
// 0.3.3 — e nel frattempo la release che sistemava proprio quello che stava
// incontrando era fuori da giorni. Non c'era alcun canale: nessun avviso
// nel sito, nessuna riga nel terminale, e il one-liner di installazione è
// una cosa che si lancia una volta sola.
//
// Tre scelte da non disfare:
//
//  · **si aggiorna a mano.** Qui si dice il numero e il comando; nessun
//    self-update, men che meno su una macchina che lavora da sola la notte.
//    Il difetto che si sta curando è *non saperlo*, non *non aver aggiornato*.
//  · **si può chiudere, e resta chiusa** — ma solo per quella versione. Il
//    consenso a ignorare 0.3.4 non vale per 0.4.0: quando esce qualcosa di
//    nuovo la fascia torna, altrimenti un utente che ha cliccato la X una
//    volta non riceverebbe più nessun avviso per sempre.
//  · **tace su ogni dubbio.** Box senza versione dichiarata, GitHub
//    irraggiungibile, versioni pari o box più avanti della release (build
//    di sviluppo): niente fascia. Un avviso sbagliato insegna a ignorare
//    gli avvisi.

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/use-locale";
import { useBoxClient } from "@/app/hooks/useBoxClient";
import { makeT } from "@/lib/i18n-dict";
import { UPDATE_BANNER_T } from "@/lib/update-banner.i18n";
import { updateAvailable } from "../../../shared/release/version.js";

// La chiave porta la versione: chiudere un avviso non zittisce i prossimi.
const dismissKey = (version: string) => `jht_update_dismissed_${version}`;

export default function UpdateBanner() {
  const locale = useLocale();
  const t = makeT(UPDATE_BANNER_T, locale);
  const box = useBoxClient();
  const [latest, setLatest] = useState<{
    version: string;
    page: string;
  } | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/latest-release");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setLatest(data.release ?? null);
      } catch {
        /* offline: nessun avviso, che è meglio di un avviso incerto */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Il dismiss si legge DOPO il mount: `localStorage` non esiste sul server
  // e leggerlo in render disallineerebbe l'idratazione. Parte da "chiusa"
  // così la fascia non lampeggia addosso a chi l'aveva già chiusa.
  useEffect(() => {
    if (!latest?.version) return;
    try {
      setDismissed(
        window.localStorage.getItem(dismissKey(latest.version)) === "1",
      );
    } catch {
      setDismissed(false);
    }
  }, [latest?.version]);

  const current = box?.client_version ?? null;
  const stale = !!current && !!latest && updateAvailable(latest.version, current);
  if (!stale || dismissed || !latest) return null;

  const close = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(dismissKey(latest.version), "1");
    } catch {
      /* storage negato: la fascia torna al prossimo caricamento, pazienza */
    }
  };

  return (
    <div
      className="sticky top-14 z-20 border-b px-4 py-2"
      style={{
        background:
          "color-mix(in srgb, var(--color-blue) 12%, var(--color-panel))",
        borderColor: "color-mix(in srgb, var(--color-blue) 35%, transparent)",
      }}
      role="status"
    >
      <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.14em] uppercase shrink-0"
          style={{ color: "var(--color-blue)" }}
        >
          {/* freccia verso l'alto in una scatola: aggiornamento disponibile */}
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M12 17V5" />
            <path d="M6.5 10.5 12 5l5.5 5.5" />
            <path d="M4 20h16" />
          </svg>
          {t("label")}
        </span>
        <span className="text-[11px] text-[var(--color-muted)] min-w-0">
          {t("text")
            .replace("{latest}", latest.version)
            .replace("{current}", current!)}
        </span>
        <span className="flex items-center gap-2 ml-auto shrink-0">
          <a
            href={latest.page}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-semibold tracking-[0.08em] uppercase no-underline px-2.5 py-1 rounded border transition-colors"
            style={{
              color: "var(--color-blue)",
              borderColor:
                "color-mix(in srgb, var(--color-blue) 45%, transparent)",
            }}
          >
            {t("how")}
          </a>
          <button
            type="button"
            onClick={close}
            aria-label={t("dismiss")}
            className="text-[10px] font-semibold tracking-[0.08em] uppercase px-2.5 py-1 rounded border border-[var(--color-border)] text-[var(--color-dim)] hover:text-[var(--color-bright)] hover:border-[var(--color-border-glow)] transition-colors cursor-pointer"
          >
            {t("dismiss")}
          </button>
        </span>
      </div>
    </div>
  );
}
