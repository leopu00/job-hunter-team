"use client";

// [JHT-WEB-DEMO] Empty-state della dashboard CLOUD (22/07): l'utente che
// salta il wizard /welcome atterra su una dashboard a zero — invece del
// vecchio popup profilo/team (flusso pre-split, oggi solo app desktop)
// gli si chiede direttamente che lavoro fa e gli si mostra la demo di
// quella categoria. In coda, il link per collegare il team vero.

import { useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import type { DemoPersonaKey } from "@/lib/demo/data";
import { DEMO_PERSONA_KEYS } from "@/lib/demo/data";
import {
  PERSONA_ICONS,
  PERSONA_LABELS,
  activateDemo,
} from "@/app/components/demo/personas";

type Strings = {
  title: string;
  hint: string;
  note: string;
  connect: string;
};

const T: Record<Locale, Strings> = {
  it: {
    title: "Che tipo di lavoro fai?",
    hint: "Il tuo team non è ancora collegato, quindi qui non c'è nulla da mostrare. Scegli il tuo ambito e ti facciamo vedere una demo di come si popolerà la dashboard: puoi filtrare, aprire le posizioni e dare giudizi.",
    note: "Dati fittizi generati per la demo, chiaramente etichettati.",
    connect: "Oppure collega il tuo team",
  },
  en: {
    title: "What kind of work do you do?",
    hint: "Your team isn't connected yet, so there's nothing to show here. Pick your field and we'll show you a demo of how the dashboard will fill up: you can filter, open positions and give feedback.",
    note: "Fictional data generated for the demo, clearly labelled.",
    connect: "Or connect your team",
  },
  es: {
    title: "¿A qué te dedicas?",
    hint: "Tu equipo aún no está conectado, así que aquí no hay nada que mostrar. Elige tu ámbito y te enseñamos una demo de cómo se llenará el dashboard: puedes filtrar, abrir posiciones y dar tu opinión.",
    note: "Datos ficticios generados para la demo, claramente etiquetados.",
    connect: "O conecta tu equipo",
  },
  fr: {
    title: "Dans quel domaine travaillez-vous ?",
    hint: "Votre équipe n'est pas encore connectée, il n'y a donc rien à afficher ici. Choisissez votre domaine et nous vous montrons une démo de la façon dont le dashboard se remplira : filtrez, ouvrez les postes, donnez votre avis.",
    note: "Données fictives générées pour la démo, clairement étiquetées.",
    connect: "Ou connectez votre équipe",
  },
  de: {
    title: "In welchem Bereich arbeitest du?",
    hint: "Dein Team ist noch nicht verbunden, hier gibt es also nichts zu zeigen. Wähle deinen Bereich und wir zeigen dir eine Demo, wie sich das Dashboard füllen wird: filtern, Stellen öffnen, Feedback geben.",
    note: "Fiktive, klar gekennzeichnete Demo-Daten.",
    connect: "Oder verbinde dein Team",
  },
  hu: {
    title: "Milyen területen dolgozol?",
    hint: "A csapatod még nincs összekapcsolva, így itt nincs mit mutatni. Válaszd ki a területedet, és mutatunk egy demót arról, hogyan telik majd fel a dashboard: szűrhetsz, megnyithatod a pozíciókat és véleményezhetsz.",
    note: "A demóhoz generált, egyértelműen jelölt fiktív adatok.",
    connect: "Vagy kapcsold össze a csapatodat",
  },
  pt: {
    title: "Em que área trabalhas?",
    hint: "A tua equipa ainda não está ligada, por isso não há nada para mostrar aqui. Escolhe a tua área e mostramos-te uma demo de como o dashboard se vai preencher: podes filtrar, abrir posições e dar feedback.",
    note: "Dados fictícios gerados para a demo, claramente etiquetados.",
    connect: "Ou liga a tua equipa",
  },
};

export default function DemoPickerCard() {
  const t = T[useLocale()];
  const [busy, setBusy] = useState<DemoPersonaKey | null>(null);
  const labels = PERSONA_LABELS[useLocale()];

  const pick = async (k: DemoPersonaKey) => {
    if (busy) return;
    setBusy(k);
    const ok = await activateDemo(k);
    if (!ok) setBusy(null);
  };

  return (
    <div
      className="mb-8 p-5 rounded-lg border bg-[var(--color-card)]"
      style={{
        borderColor: "color-mix(in srgb, var(--color-green) 35%, transparent)",
        animation: "fade-in 0.35s ease both",
      }}
    >
      <div className="text-[13px] font-bold text-[var(--color-bright)] mb-2">
        {t.title}
      </div>
      <p className="text-[11px] text-[var(--color-muted)] leading-relaxed m-0 mb-4">
        {t.hint}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-3">
        {DEMO_PERSONA_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => pick(k)}
            disabled={busy != null}
            className="group flex items-center gap-3 p-3.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] hover:border-[#00e87a55] transition-colors cursor-pointer disabled:opacity-60 text-left"
          >
            <span
              className="flex items-center justify-center w-9 h-9 rounded-lg border shrink-0"
              style={{
                color: "var(--color-green)",
                borderColor:
                  "color-mix(in srgb, var(--color-green) 35%, transparent)",
              }}
            >
              {PERSONA_ICONS[k]}
            </span>
            <span className="text-[12px] font-bold text-[var(--color-bright)] group-hover:text-[var(--color-green)] transition-colors">
              {labels[k]}
            </span>
            {busy === k && (
              <span className="ml-auto w-3.5 h-3.5 rounded-full border-2 border-[var(--color-green)] border-t-transparent animate-spin shrink-0" />
            )}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-[10px] text-[var(--color-dim)]">{t.note}</span>
        <Link
          href="/welcome"
          className="text-[10px] font-semibold tracking-[0.08em] uppercase no-underline"
          style={{ color: "var(--color-green)" }}
        >
          {t.connect}
        </Link>
      </div>
    </div>
  );
}
