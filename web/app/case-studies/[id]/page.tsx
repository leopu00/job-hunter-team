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
import {
  CASE_STUDIES,
  getCaseStudy,
  buildCaseActivity,
} from "@/lib/case-studies";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cs = getCaseStudy(id);
  return {
    title: cs
      ? `${cs.label} · Case study · Job Hunter Team`
      : "Case study · Job Hunter Team",
  };
}

export default async function CaseStudyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cs = getCaseStudy(id);
  if (!cs) notFound();

  const activity = buildCaseActivity(cs.run);
  const current: PreparedCase = {
    id: cs.id,
    label: cs.label,
    tagline: cs.tagline,
    subscription: cs.subscription,
    profile: cs.profile,
    run: { ...cs.run, events: [] }, // gli eventi servivano solo per l'attività
    activity,
  };
  const all: CaseRef[] = CASE_STUDIES.map((c) => ({
    id: c.id,
    label: c.label,
    tagline: c.tagline,
    badge: c.profile.badge,
  }));

  return (
    <main className="min-h-screen bg-[var(--color-panel)] text-[var(--color-white)]">
      <LandingI18nProvider>
        <LandingNav />
      </LandingI18nProvider>
      <div aria-hidden="true" className="h-14" />

      <div className="mx-auto max-w-6xl px-6 py-8">
        <CaseStudyDetail current={current} all={all} />
      </div>

      <footer className="border-t border-[var(--color-border)] py-6 text-center text-[11px] text-[var(--color-muted)]">
        Dati anonimi da un run reale del team · snapshot committato, nessuna
        informazione personale del candidato.
      </footer>
    </main>
  );
}
