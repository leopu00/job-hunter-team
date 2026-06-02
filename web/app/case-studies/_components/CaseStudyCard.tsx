import type { CaseStudy } from "./types";
import { metricText, providerColor } from "./types";
import { WindowsSection } from "./WindowsSection";

type Props = {
  cs: CaseStudy;
};

// Infra detail that isn't part of the product story — hidden from the metadata strip.
const HIDDEN_META = new Set(["host"]);

const NOTE_LABEL: Record<
  CaseStudy["notes"][number]["note_type"],
  { title: string; tone: string }
> = {
  worked: {
    title: "✅ What worked",
    tone: "text-emerald-700 border-emerald-200 bg-emerald-50",
  },
  didnt_work: {
    title: "⚠️ What didn't work",
    tone: "text-amber-800 border-amber-200 bg-amber-50",
  },
  tweak: {
    title: "🧰 Tweaks",
    tone: "text-slate-700 border-slate-200 bg-slate-50",
  },
  caveat: {
    title: "📝 Caveats",
    tone: "text-slate-600 border-slate-200 bg-white",
  },
};

export function CaseStudyCard({ cs }: Props) {
  const accent = providerColor(cs.provider_name);

  const heroMetrics = cs.metrics
    .filter((m) => m.highlighted)
    .sort((a, b) => a.display_order - b.display_order);
  const metaMetrics = cs.metrics
    .filter((m) => m.category === "metadata" && !HIDDEN_META.has(m.metric_key))
    .sort((a, b) => a.display_order - b.display_order);

  return (
    <article
      className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md sm:p-8"
      id={cs.slug}
    >
      <header className="mb-6 flex flex-wrap items-baseline gap-3 border-b border-slate-100 pb-4">
        <span
          className="rounded-full px-3 py-1 text-xs font-bold text-white"
          style={{ backgroundColor: accent }}
        >
          Case #{cs.case_number}
        </span>
        <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">
          {cs.title}
        </h2>
        <span className="text-xs text-slate-500">· {cs.tester_handle}</span>
      </header>

      <p className="mb-6 text-sm leading-relaxed text-slate-700">
        {cs.profile_summary}
      </p>

      {/* metadata strip — boxed "setup" panel */}
      <section className="mb-6 rounded-xl border border-slate-100 bg-slate-50/70 p-5">
        <h3 className="mb-3 text-[10px] font-semibold tracking-[0.12em] text-slate-400 uppercase">
          Setup
        </h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs sm:grid-cols-3">
          {metaMetrics.map((m) => (
            <div key={m.metric_key} className="min-w-0">
              <dt className="text-slate-500">
                {m.emoji} {m.metric_label}
              </dt>
              <dd className="mt-0.5 text-sm font-medium text-slate-800">
                {metricText(cs, m.metric_key)}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* hero KPI strip — one accented card per metric */}
      {heroMetrics.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-3 text-[10px] font-semibold tracking-[0.12em] text-slate-400 uppercase">
            Risultati chiave
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {heroMetrics.map((m) => {
              const { main, sub } = splitMetricValue(
                String(m.value_text ?? m.value_num ?? "—"),
              );
              return (
                <div
                  key={m.metric_key}
                  className="group relative min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 top-0 h-1 opacity-80"
                    style={{ backgroundColor: accent }}
                  />
                  <div className="truncate pt-1 text-xs text-slate-500">
                    {m.emoji} {m.metric_label}
                  </div>
                  <div className="mt-2 text-2xl font-bold leading-none tracking-tight text-slate-900">
                    {main}
                  </div>
                  {sub && (
                    <div className="mt-1.5 text-[11px] leading-snug font-normal text-slate-400">
                      {sub}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* notes — sections only render if non-empty */}
      <div className="space-y-3">
        {(["worked", "didnt_work", "tweak", "caveat"] as const).map((t) => {
          const ns = cs.notes
            .filter((n) => n.note_type === t)
            .sort((a, b) => a.display_order - b.display_order);
          if (ns.length === 0) return null;
          const label = NOTE_LABEL[t];
          return (
            <details key={t} className={`rounded-lg border p-3 ${label.tone}`}>
              <summary className="cursor-pointer text-sm font-semibold">
                {label.title}{" "}
                <span className="ml-1 rounded-full bg-white/60 px-2 py-0.5 text-xs">
                  {ns.length}
                </span>
              </summary>
              <ul className="ml-4 mt-3 list-disc space-y-2 text-sm leading-relaxed">
                {ns.map((n, i) => (
                  <li
                    key={i}
                    dangerouslySetInnerHTML={{
                      __html: renderInlineMd(n.body_md),
                    }}
                  />
                ))}
              </ul>
            </details>
          );
        })}
      </div>

      <WindowsSection windows={cs.windows ?? []} accentColor={accent} />
    </article>
  );
}

// Split a KPI value like "396.9M weighted (Codex telemetry)" into a short headline
// number ("396.9M weighted") and a small parenthetical caption ("Codex telemetry"),
// so the hero strip shows a clean big number with the context demoted underneath.
function splitMetricValue(v: string): { main: string; sub?: string } {
  const m = v.match(/^(.*?)\s*\((.*)\)\s*$/);
  if (m && m[1].trim()) return { main: m[1].trim(), sub: m[2].trim() };
  return { main: v.trim() };
}

// Minimal markdown: **bold**, *italic*, `code`. Source content is trusted (we author it).
function renderInlineMd(md: string): string {
  const esc = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(
      /`([^`]+)`/g,
      '<code class="rounded bg-white/70 px-1 py-0.5 text-xs">$1</code>',
    );
}
