"use client";

// Card analitica: PERCHÉ le posizioni vengono escluse. Barre orizzontali per
// categoria normalizzata (skills, lingua, località, …), con conteggio e quota %
// sul totale escluse. Accompagna il funnel + donut nella colonna destra.

import { useState } from "react";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

const COLORS: Record<string, string> = {
  skills: "#8B5CF6",
  language: "#0EA5E9",
  location: "#F59E0B",
  education: "#22A06B",
  deadlink: "#6B7280",
  experience: "#EC4899",
  salary: "#14B8A6",
  scam: "#EF4444",
  other: "#94A3B8",
};

const LABELS: Record<Locale, Record<string, string>> = {
  it: { skills: "Competenze / profilo", language: "Lingua", location: "Località", education: "Titolo di studio", deadlink: "Annuncio scaduto", experience: "Esperienza / seniority", salary: "Retribuzione", scam: "Spam / scam", other: "Altro" },
  en: { skills: "Skills / profile", language: "Language", location: "Location", education: "Education", deadlink: "Expired posting", experience: "Experience / seniority", salary: "Compensation", scam: "Spam / scam", other: "Other" },
  es: { skills: "Competencias / perfil", language: "Idioma", location: "Ubicación", education: "Titulación", deadlink: "Anuncio caducado", experience: "Experiencia / seniority", salary: "Retribución", scam: "Spam / scam", other: "Otros" },
  fr: { skills: "Compétences / profil", language: "Langue", location: "Localisation", education: "Diplôme", deadlink: "Annonce expirée", experience: "Expérience / séniorité", salary: "Rémunération", scam: "Spam / arnaque", other: "Autres" },
  de: { skills: "Skills / Profil", language: "Sprache", location: "Standort", education: "Abschluss", deadlink: "Abgelaufene Anzeige", experience: "Erfahrung / Seniorität", salary: "Vergütung", scam: "Spam / Betrug", other: "Sonstige" },
  hu: { skills: "Készségek / profil", language: "Nyelv", location: "Helyszín", education: "Végzettség", deadlink: "Lejárt hirdetés", experience: "Tapasztalat / szint", salary: "Javadalmazás", scam: "Spam / átverés", other: "Egyéb" },
  pt: { skills: "Competências / perfil", language: "Idioma", location: "Localização", education: "Habilitações", deadlink: "Anúncio expirado", experience: "Experiência / senioridade", salary: "Remuneração", scam: "Spam / scam", other: "Outros" },
};

const T: Record<Locale, { title: string; noData: string; sub: string }> = {
  it: { title: "Perché vengono escluse", noData: "Dato non disponibile.", sub: "sul totale escluse" },
  en: { title: "Why they get excluded", noData: "Data not available.", sub: "of all excluded" },
  es: { title: "Por qué se excluyen", noData: "Dato no disponible.", sub: "del total excluidas" },
  fr: { title: "Pourquoi elles sont exclues", noData: "Donnée non disponible.", sub: "du total exclues" },
  de: { title: "Warum sie ausgeschlossen werden", noData: "Daten nicht verfügbar.", sub: "aller Ausgeschlossenen" },
  hu: { title: "Miért zárják ki őket", noData: "Az adat nem érhető el.", sub: "az összes kizártból" },
  pt: { title: "Porque são excluídas", noData: "Dado não disponível.", sub: "do total excluídas" },
};

export default function ExclusionReasonsCard({
  reasons,
}: {
  reasons: { key: string; count: number }[];
}) {
  const locale = useLocale();
  const t = T[locale];
  const labels = LABELS[locale];
  const [hover, setHover] = useState<string | null>(null);

  if (!reasons.length) {
    return <p className="text-[11px] text-[var(--color-dim)]">{t.noData}</p>;
  }

  const ordered = [...reasons].sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...ordered.map((r) => r.count));
  const total = ordered.reduce((s, r) => s + r.count, 0) || 1;
  const labelFor = (k: string) => labels[k] ?? k;
  const colorFor = (k: string) => COLORS[k] ?? "#94A3B8";

  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-6">
      <div className="text-[12px] font-semibold text-[var(--color-base)] mb-4">
        {t.title}
      </div>
      <div className="flex flex-col gap-2.5">
        {ordered.map((r) => {
          const on = hover === r.key;
          const color = colorFor(r.key);
          return (
            <div
              key={r.key}
              className="flex items-center gap-2.5 cursor-default transition-opacity"
              style={{ opacity: hover && !on ? 0.4 : 1 }}
              onMouseEnter={() => setHover(r.key)}
              onMouseLeave={() => setHover(null)}
            >
              <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }} />
              <span
                className={`text-[11px] w-36 shrink-0 truncate ${on ? "font-semibold text-[var(--color-bright)]" : "text-[var(--color-muted)]"}`}
                title={labelFor(r.key)}
              >
                {labelFor(r.key)}
              </span>
              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
                <div className="h-full rounded-full" style={{ width: `${(r.count / max) * 100}%`, background: color, opacity: 0.85 }} />
              </div>
              <span className="text-[11px] font-bold tabular-nums w-8 text-right" style={{ color }}>
                {r.count}
              </span>
              <span className="text-[10px] font-semibold tabular-nums w-9 shrink-0 text-right text-[var(--color-base)]">
                {Math.round((r.count / total) * 100)}%
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 pt-2 border-t border-[var(--color-border)] text-[10px] text-[var(--color-dim)] text-right">
        {total} · {t.sub}
      </div>
    </div>
  );
}
