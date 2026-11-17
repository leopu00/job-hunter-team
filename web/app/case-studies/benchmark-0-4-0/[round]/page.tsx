// /case-studies/benchmark-0-4-0/<test>: the page of one test of the 0.4.0 benchmark, a round or a profile of the Scout
// bench. An overview on top (system, service, build, profile, day, duration, spend, positions, cost, outcome with its
// criteria), then the test minute by minute, what happened, the defects it found and the tests before and after it on
// the same system. Synthetic and aggregated data only, from web/data/benchmark/benchmark-0-4-0.json.

import Link from "next/link";
import { notFound } from "next/navigation";
import { LandingI18nProvider } from "../../../components/landing/LandingI18n";
import LandingNav from "../../../components/landing/LandingNav";
import { getRequestLocale } from "@/lib/request-locale";
import data from "@/data/benchmark/benchmark-0-4-0.json";
import { RoundDetailCharts } from "../BenchmarkCharts";
import { CHART_COPY } from "../chartsCopy";
import ProviderMark from "../providerMarks";
import { Mark, OS_LABEL, T, TARGET_MARK, TRADE_EMOJI, type Target } from "../benchmarkShared";
import { ROUND_PAGE_COPY } from "../roundPageCopy";
import { ROUND_STORIES } from "../roundStories";
import { TESTS, chartRoundOf, neighbours, testBySlug, type TestEntry } from "../roundsData";

export const dynamic = "force-dynamic";

type Criterion = { k: string; ok: boolean; v?: number; min?: number; max?: number; of?: number; trade?: string };

export async function generateMetadata({ params }: { params: Promise<{ round: string }> }) {
  const locale = await getRequestLocale();
  const x = testBySlug((await params).round);
  if (!x) return {};
  const t = T[locale];
  const cc = CHART_COPY[locale];
  return { title: `${OS_LABEL[x.os]} · ${t.profiles[x.profile] ?? cc.benchProfiles[x.profile] ?? x.profile} · ${t.services[x.service] ?? x.service} | ${t.metaTitle}` };
}

export default async function RoundPage({ params }: { params: Promise<{ round: string }> }) {
  const x = testBySlug((await params).round);
  if (!x) notFound();
  const locale = await getRequestLocale();
  const t = T[locale];
  const cc = CHART_COPY[locale];
  const p = ROUND_PAGE_COPY[locale];
  const nf = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (v: number | null) => (v == null ? "—" : `${nf.format(v)} $`);
  const profileName = (key: string) => t.profiles[key] ?? cc.benchProfiles[key] ?? key;
  const dayLabel = (e: TestEntry) => e.day.replace("night", t.night);
  const label = (e: TestEntry) => `${OS_LABEL[e.os]} · ${profileName(e.profile)} · ${dayLabel(e)}`;
  const target = x.target ? ((data.targets as Target[]).find((y) => y.id === x.target) ?? null) : null;
  const criteria = ((target as { criteria?: Criterion[] } | null)?.criteria ?? []) as Criterion[];
  const criterion = (c: Criterion) =>
    (t.targetCriteria[c.k] ?? c.k)
      .replace("{v}", c.v == null ? "" : String(c.v))
      .replace("{min}", String(c.min ?? ""))
      .replace("{max}", String(c.max ?? ""))
      .replace("{of}", String(c.of ?? ""))
      .replace("{trade}", c.trade ? `${TRADE_EMOJI[c.trade] ?? ""} ${profileName(c.trade)}`.trim() : "");
  const story = ROUND_STORIES[x.id];
  const { prev, next } = neighbours(x);
  const brake = x.series.brake ?? [];
  const tiles: { k: string; v: React.ReactNode; hint?: string }[] = [
    { k: p.system, v: <span className="inline-flex items-center gap-1"><Mark id={x.os} label={OS_LABEL[x.os]} />{OS_LABEL[x.os]}</span> },
    {
      k: p.service,
      v: (
        <span className="inline-flex items-center gap-2">
          {x.service.split("-").map((s) => (
            <ProviderMark key={s} id={s} label={t.services[s] ?? s} />
          ))}
          {t.services[x.service] ?? x.service}
        </span>
      ),
    },
    { k: p.build, v: x.buildNo == null ? "—" : String(x.buildNo) },
    { k: p.profile, v: `${TRADE_EMOJI[x.profile] ?? "🧑‍💼"} ${profileName(x.profile)}` },
    { k: p.date, v: dayLabel(x) },
    { k: p.duration, v: x.minutes == null ? "—" : p.minutes.replace("{n}", String(x.minutes)) },
    { k: p.spend, v: money(x.cost) },
    { k: p.positions, v: `${x.found ?? "—"} / ${x.scored ?? "—"} / ${x.relevant ?? "—"}`, hint: p.positionsHint },
    { k: p.costPerPosition, v: x.cost != null && x.found ? money(x.cost / x.found) : "—" },
    { k: p.costPerRelevant, v: x.cost != null && x.relevant ? money(x.cost / x.relevant) : "—" },
  ];

  return (
    <main className="min-h-screen bg-[var(--color-panel)] text-[var(--color-white)]">
      <LandingI18nProvider>
        <LandingNav />
      </LandingI18nProvider>
      <div aria-hidden="true" className="h-14" />

      <div className="mx-auto max-w-6xl px-4 py-8 space-y-8">
        <Link href="/case-studies/benchmark-0-4-0" className="text-[12px] text-[var(--color-muted)] hover:underline">
          {p.back}
        </Link>

        <header className="space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">{x.kind === "bench" ? p.kindBench : p.kindRound}</div>
          <h1 className="text-[26px] font-extrabold leading-tight">
            {`${TRADE_EMOJI[x.profile] ?? ""} ${label(x)}`.trim()}
          </h1>
          <p className="text-[11px] text-[var(--color-dim)]">{p.synthetic}</p>
        </header>

        <section className="space-y-3">
          <h2 className="section-label">{p.overview}</h2>
          <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-px bg-[var(--color-border)] border border-[var(--color-border)]">
            {tiles.map((tile) => (
              <div key={tile.k} className="bg-[var(--color-card)] px-3 py-2.5 space-y-0.5">
                <dt className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">{tile.k}</dt>
                <dd className="text-[14px] font-semibold tabular-nums">{tile.v}</dd>
                {tile.hint && <dd className="text-[10px] text-[var(--color-dim)]">{tile.hint}</dd>}
              </div>
            ))}
          </dl>
          <div className="border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2.5 space-y-1 text-[12px]">
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">{p.outcome}</div>
            {target ? (
              <>
                <div className="font-semibold">
                  <span aria-hidden="true">{TARGET_MARK[target.status]}</span> {t.targetStatus[target.status]}
                  {x.target && <span className="font-normal text-[var(--color-muted)]"> · {t.targets[x.target]}</span>}
                </div>
                {criteria.length > 0 && (
                  <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] tabular-nums text-[var(--color-base)]">
                    {criteria.map((c, i) => (
                      <li key={i} className="whitespace-nowrap">
                        <span aria-hidden="true">{c.ok ? "✅" : "❌"}</span> {criterion(c)}
                      </li>
                    ))}
                  </ul>
                )}
                {t.targetRules.scout && <p className="text-[11px] text-[var(--color-dim)]">{t.targetRules.scout}</p>}
              </>
            ) : (
              <>
                <div className="font-semibold">{x.outcome ? t.outcome[x.outcome] : "—"}</div>
                {x.note && <p className="text-[var(--color-muted)]">{t.notes[x.note]}</p>}
              </>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="section-label">{p.charts}</h2>
          <RoundDetailCharts locale={locale} round={chartRoundOf(x, label(x))} />
        </section>

        <section className="space-y-3">
          <h2 className="section-label">{p.story}</h2>
          {story?.story?.[locale]?.length ? (
            <ul className="list-disc pl-5 space-y-1 text-[13px] max-w-3xl">
              {story.story[locale].map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : (
            <div className="space-y-1 text-[13px] max-w-3xl">
              {brake.length > 0 && <p className="text-[var(--color-muted)]">{p.storyFromEvents}</p>}
              <ul className="list-disc pl-5 space-y-1">
                {brake.map((b, i) => (
                  <li key={i}>
                    {p.storyMinute.replace("{m}", String(Math.max(0, Math.round(b.m)))).replace("{e}", cc.brakeKinds[b.kind] ?? b.kind)}
                  </li>
                ))}
                <li>
                  {p.storyTotals
                    .replace("{spend}", money(x.cost))
                    .replace("{found}", String(x.found ?? "—"))
                    .replace("{scored}", String(x.scored ?? "—"))}
                </li>
              </ul>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="section-label">{p.defects}</h2>
          {story?.defects?.length ? (
            <ul className="space-y-1.5 text-[13px] max-w-3xl">
              {story.defects.map((d, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0 text-[11px] font-bold tabular-nums text-[var(--color-muted)] w-7">{d.priority}</span>
                  <span>
                    {d.text[locale]}{" "}
                    <span className="text-[11px] text-[var(--color-dim)]">
                      ({d.fixedIn != null
                        ? p.fixedIn.replace("{n}", String(d.fixedIn))
                        : d.fixClaimedIn != null
                          ? p.fixClaimed.replace("{n}", String(d.fixClaimedIn))
                          : p.notFixed})
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-[var(--color-muted)]">{p.defectsMissing}</p>
          )}
        </section>

        <nav className="flex flex-wrap justify-between gap-3 border-t border-[var(--color-border)] pt-4 text-[12px]" aria-label={p.sameSystem}>
          {prev ? (
            <Link href={`/case-studies/benchmark-0-4-0/${prev.slug}`} className="hover:underline">
              <span className="block text-[10px] uppercase tracking-wide text-[var(--color-muted)]">{p.prev.replace("{os}", OS_LABEL[x.os])}</span>
              {label(prev)}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link href={`/case-studies/benchmark-0-4-0/${next.slug}`} className="text-right hover:underline">
              <span className="block text-[10px] uppercase tracking-wide text-[var(--color-muted)]">{p.next.replace("{os}", OS_LABEL[x.os])}</span>
              {label(next)}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </div>

      <footer className="border-t border-[var(--color-border)] py-6 text-center text-[11px] text-[var(--color-muted)]">
        {t.footer}
        <p className="mt-1 text-[10px] text-[var(--color-dim)]">{t.tuxCredit}</p>
      </footer>
    </main>
  );
}

/** Every test has a page; the list is the same one the benchmark page reads. */
export function generateStaticParams() {
  return TESTS.map((x) => ({ round: x.slug }));
}
