// Public /case-studies page.
// Server component: fetches the JSON payload from the local API, then composes
// the layout from the section components under ./_components.
//
// Data source = SQLite (dev) / Supabase (prod target).
// Narrative source of truth = docs/about/RESULTS.md.

import type { Payload } from "./_components/types";
import SiteNav from "./_components/SiteNav";
import { CaseStudyCard } from "./_components/CaseStudyCard";
import { CaseFunnel } from "./_components/PipelineFunnel";
import { ContributeCta } from "./_components/ContributeCta";
import { AgentActivityHero } from "./_components/AgentActivityHero";
import { FiveHourWindowsTab } from "./_components/FiveHourWindowsTab";
import { TeamActionsTab } from "./_components/TeamActionsTab";
import { TokensTab } from "./_components/TokensTab";
import { CaseStudiesTabs } from "./_components/CaseStudiesTabs";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Case studies · Job Hunter Team",
  description:
    "Real field data from Job Hunter Team runs — what the open-source AI agent team has produced on real candidate profiles with real LLM subscriptions.",
};

async function fetchData(): Promise<Payload> {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001";
  const r = await fetch(`${base}/api/case-studies`, { cache: "no-store" });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}

export default async function CaseStudiesPage() {
  let data: Payload;
  try {
    data = await fetchData();
  } catch (e) {
    return (
      <main className="mx-auto max-w-3xl p-8 font-mono text-sm">
        <h1 className="mb-4 text-2xl font-bold">
          ⚠️ /case-studies — data pipeline error
        </h1>
        <pre className="rounded bg-red-50 p-4 text-red-800">{String(e)}</pre>
        <p className="mt-4">
          Hint: run{" "}
          <code className="rounded bg-slate-100 px-2 py-1">
            web/data/case-studies/init.sh
          </code>{" "}
          to rebuild the local SQLite seed.
        </p>
      </main>
    );
  }

  const { caseStudies } = data;

  const codex = caseStudies.find((c) =>
    c.slug.startsWith("beta-tester-1-codex"),
  );
  const codexWeekly = codex?.windows?.find((w) => w.kind === "weekly");

  const resultsContent = (
    <>
      {/* One self-contained block per case study: card + its own conversion
          funnel, kept fully separate from the next case. */}
      {caseStudies.map((cs, i) => (
        <section
          key={cs.id}
          className={
            i % 2 === 0
              ? "border-b border-slate-200 py-12"
              : "border-b border-slate-200 bg-slate-50 py-12"
          }
        >
          <div className="mx-auto max-w-4xl space-y-6 px-6">
            <CaseStudyCard cs={cs} />
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="mb-1 text-sm font-bold text-slate-900">
                🌊 Pipeline conversion
              </h3>
              <p className="mb-5 text-xs text-slate-500">
                From positions analyzed by the pipeline to ready applications.
                Width = absolute volume. Drop-off shows where positions were
                excluded.
              </p>
              <CaseFunnel cs={cs} />
            </div>
          </div>
        </section>
      ))}

      {/* CTAs */}
      <ContributeCta />
    </>
  );

  const tabs = [
    { id: "results", label: "📊 Risultati", content: resultsContent },
  ];
  if (codex && codexWeekly) {
    tabs.push({
      id: "agents",
      label: "💬 Messaggi e azioni del team",
      content: <AgentActivityHero caseStudy={codex} weekly={codexWeekly} />,
    });
    tabs.push({
      id: "windows",
      label: "📈 Finestre 5h",
      content: <FiveHourWindowsTab caseStudy={codex} weekly={codexWeekly} />,
    });
    tabs.push({
      id: "actions",
      label: "🔧 Azioni per finestra",
      content: <TeamActionsTab caseStudy={codex} weekly={codexWeekly} />,
    });
    tabs.push({
      id: "tokens",
      label: "💰 Token consumati",
      content: <TokensTab caseStudy={codex} weekly={codexWeekly} />,
    });
  }

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <SiteNav />
      {/* Spacer per la nav `fixed` (~56px). Le tab interne sono sticky
          a top-14 così si fermano subito sotto la nav. */}
      <div aria-hidden="true" className="h-14" />
      <CaseStudiesTabs tabs={tabs} defaultTab="results" />
      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500">
        <p>
          Data source: SQLite (dev) → Supabase (prod target) ·{" "}
          <a
            href="https://github.com/leopu00/job-hunter-team/blob/master/docs/about/RESULTS.md"
            className="underline hover:text-slate-700"
          >
            narrative source on GitHub
          </a>
        </p>
      </footer>
    </main>
  );
}
