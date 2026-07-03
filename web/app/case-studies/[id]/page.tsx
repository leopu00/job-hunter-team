// Dettaglio di un singolo case study: /case-studies/[id].
// Prepara i dati del tester (attività aggregata server-side) e la lista di tutti
// i casi per lo switcher collassabile.

import { notFound } from "next/navigation";
import { LandingI18nProvider } from "../../components/landing/LandingI18n";
import LandingNav from "../../components/landing/LandingNav";
import CaseStudyDetail, {
  type PreparedCase,
  type CaseRef,
} from "../CaseStudyDetail";
import CaseStudiesShell, { type CaseStudyTeaser } from "../CaseStudiesShell";
import {
  CASE_STUDIES,
  getCaseStudy,
  buildCaseActivity,
  caseRunInfo,
  localizeCaseStudy,
} from "@/lib/case-studies";
import { getRequestLocale } from "@/lib/request-locale";
import type { Locale } from "@/i18n/config";

export const dynamic = "force-dynamic";

const T: Record<Locale, { metaSuffix: string; footer: string }> = {
  it: {
    metaSuffix: "Case study · Job Hunter Team",
    footer:
      "Dati anonimi da un run reale del team · snapshot committato, nessuna informazione personale del candidato.",
  },
  en: {
    metaSuffix: "Case study · Job Hunter Team",
    footer:
      "Anonymous data from a real team run · committed snapshot, no personal information about the candidate.",
  },
  es: {
    metaSuffix: "Caso de estudio · Job Hunter Team",
    footer:
      "Datos anónimos de una ejecución real del equipo · snapshot versionado, sin información personal del candidato.",
  },
  fr: {
    metaSuffix: "Étude de cas · Job Hunter Team",
    footer:
      "Données anonymes issues d'un run réel de l'équipe · snapshot versionné, aucune information personnelle du candidat.",
  },
  de: {
    metaSuffix: "Fallstudie · Job Hunter Team",
    footer:
      "Anonyme Daten aus einem echten Team-Run · versionierter Snapshot, keine persönlichen Informationen des Kandidaten.",
  },
  hu: {
    metaSuffix: "Esettanulmány · Job Hunter Team",
    footer:
      "Anonim adatok egy valódi csapatfutásból · verziózott pillanatkép, semmilyen személyes információ a jelöltről.",
  },
  pt: {
    metaSuffix: "Estudo de caso · Job Hunter Team",
    footer:
      "Dados anónimos de uma execução real da equipa · snapshot versionado, sem informação pessoal do candidato.",
  },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cs = getCaseStudy(id);
  const t = T[await getRequestLocale()];
  return {
    title: cs ? `${cs.label} · ${t.metaSuffix}` : t.metaSuffix,
  };
}

export default async function CaseStudyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const base = getCaseStudy(id);
  if (!base) notFound();

  const locale = await getRequestLocale();
  const t = T[locale];
  const cs = localizeCaseStudy(base, locale);
  const activity = buildCaseActivity(cs.run);
  const current: PreparedCase = {
    id: cs.id,
    label: cs.label,
    tagline: cs.tagline,
    subscription: cs.subscription,
    profile: cs.profile,
    phases: cs.phases,
    maintainerNote: cs.maintainerNote,
    run: { ...cs.run, events: [] }, // gli eventi servivano solo per l'attività
    activity,
  };
  const localizedAll = CASE_STUDIES.map((c) => localizeCaseStudy(c, locale));
  const all: CaseRef[] = localizedAll.map((c) => ({
    id: c.id,
    label: c.label,
    tagline: c.tagline,
    badge: c.profile.badge,
  }));
  // Stessa lista della pagina indice, per la sidebar collassabile dei tester.
  const testers: CaseStudyTeaser[] = localizedAll.map((c) => ({
    id: c.id,
    label: c.label,
    badge: c.profile.badge,
    category: c.category,
    seniority: c.seniority,
    geos: c.geos,
    model: c.model,
    period: caseRunInfo(c.run, locale).label,
  }));

  return (
    <main className="min-h-screen bg-[var(--color-panel)] text-[var(--color-white)]">
      <LandingI18nProvider>
        <LandingNav />
      </LandingI18nProvider>
      <div aria-hidden="true" className="h-14" />

      <CaseStudiesShell testers={testers} activeId={cs.id}>
        <CaseStudyDetail current={current} all={all} />
      </CaseStudiesShell>

      <footer className="border-t border-[var(--color-border)] py-6 text-center text-[11px] text-[var(--color-muted)]">
        {t.footer}
      </footer>
    </main>
  );
}
