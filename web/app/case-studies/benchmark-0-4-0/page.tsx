// /case-studies/benchmark-0-4-0: first comparison of the 0.4.0 test rounds (services × systems).
// Static data in web/data/benchmark/benchmark-0-4-0.json (synthetic profiles only); the existing case studies page is untouched.

import { Suspense } from "react";
import Link from "next/link";
import { LandingI18nProvider } from "../../components/landing/LandingI18n";
import LandingNav from "../../components/landing/LandingNav";
import { getRequestLocale } from "@/lib/request-locale";
import data from "@/data/benchmark/benchmark-0-4-0.json";
import BenchmarkCharts, { type BenchProfile, type BetaDay, type BuildPoint, type ChartRound } from "./BenchmarkCharts";
import { CHART_COPY } from "./chartsCopy";
import {
  type Round,
  type Copy,
  T,
  Mark,
  OS_LABEL,
  TARGET_MARK,
  TARGET_COLOR,
  type Target,
  TARGET_SECTIONS,
  TARGET_OS,
  TRADE_EMOJI,
  type Build,
  OUTCOME_COLOR,
  PROFILE_SECTOR,
  CATEGORY_SECTOR,
} from "./benchmarkShared";

import ProviderMark from "./providerMarks";
import { testHref } from "./roundsData";
import BenchmarkFinder, {
  type CandidateView,
} from "./BenchmarkFinder";
import { CASE_STUDIES, localizeCaseStudy } from "@/lib/case-studies";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = T[await getRequestLocale()];
  return { title: t.metaTitle };
}

export default async function BenchmarkPage() {
  const locale = await getRequestLocale();
  const t = T[locale];
  const nf = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const money = (n: number | null) => (n == null ? "—" : `${nf.format(n)} $`);
  const num = (n: number | null) => (n == null ? "—" : String(n));
  const dayLabel = (r: Round) => r.day.replace("night", t.night);
  const found = (r: Round) =>
    r.found == null
      ? "—"
      : `${r.found} / ${num(r.scored)} / ${r.relevant == null ? "—" : `${(r as { relevantApprox?: boolean }).relevantApprox ? "≈" : ""}${r.relevant}`}`;
  const perScored = (r: Round) =>
    r.cost != null && r.scored ? r.cost / r.scored : null;
  const chartRows = data.rounds.filter((r) => r.outcome !== "running");
  const buildNo = (r: Round) => (r as { buildNo?: number }).buildNo;
  const roundById = new Map(data.rounds.map((r) => [r.id, r]));
  const green = data.targets.filter((x: Target) => x.status === "pass").length;
  const roundLink = (id: string) => {
    const r = roundById.get(id);
    if (!r) return null;
    return (
      <a
        key={id}
        href={testHref(id)}
        className="underline decoration-dotted hover:decoration-solid whitespace-nowrap"
      >
        {OS_LABEL[r.os]} · {t.profiles[r.profile]} · {dayLabel(r)}
      </a>
    );
  };
  // A criterion of a target with its real number, e.g. «relevant 79% (≥70%)»; the trade is named with its emoji.
  type Criterion = { k: string; ok: boolean; v?: number; min?: number; max?: number; of?: number; trade?: string; round?: string };
  const criterion = (c: Criterion) =>
    (t.targetCriteria[c.k] ?? c.k)
      .replace("{v}", c.v == null ? "" : c.k === "underCeiling" ? nf.format(c.v) : String(c.v))
      .replace("{min}", String(c.min ?? ""))
      .replace("{max}", String(c.max ?? ""))
      .replace("{of}", String(c.of ?? ""))
      .replace("{trade}", c.trade ? `${TRADE_EMOJI[c.trade] ?? ""} ${t.profiles[c.trade] ?? c.trade}`.trim() : "");
  // the test of the Scout bench that proves each bench row of the targets
  const BENCH_TEST: Record<string, string> = {
    scoutBenchCook: "b9-cook",
    scoutBenchWarehouse: "b9-warehouseWorker",
    scoutBenchNurse: "b9-nurse",
    scoutBenchBricklayer: "b9-bricklayer",
  };
  // One cell of the targets table: the status, the build, the rounds that prove it; the note small below and whole in the tooltip.
  const targetCell = (x: Target) => {
    const note = x.note ? t.targetNotes[x.note] : "";
    const criteria = ((x as { criteria?: Criterion[] }).criteria ?? []) as Criterion[];
    return (
      <div className="space-y-0.5" title={note || undefined}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {/* a row of the Scout bench opens the page of its test from its state */}
          {BENCH_TEST[x.id] ? (
            <Link href={testHref(BENCH_TEST[x.id])} className="text-[11px] font-semibold whitespace-nowrap underline decoration-dotted hover:decoration-solid" style={{ color: "var(--color-white)" }}>
              <span aria-hidden="true">{TARGET_MARK[x.status]}</span> {t.targetStatus[x.status]}
            </Link>
          ) : (
            <span className="text-[11px] font-semibold whitespace-nowrap text-[var(--color-white)]">
              <span aria-hidden="true">{TARGET_MARK[x.status]}</span> {t.targetStatus[x.status]}
            </span>
          )}
          {x.build != null && (
            <span className="text-[11px] tabular-nums text-[var(--color-muted)] whitespace-nowrap">
              {t.targetTried.replace("{n}", String(x.build))}
            </span>
          )}
        </div>
        {/* each round that proves it says itself, on its own line: system · profile · day; with criteria, the criteria link to it */}
        {criteria.length === 0 && x.proof.map((id: string) => {
          const r = roundById.get(id);
          return (
            <a
              key={id}
              href={testHref(id)}
              className="block w-fit text-[11px] underline decoration-dotted hover:decoration-solid"
              style={{ color: "var(--color-muted)" }}
            >
              {r ? `↳ ${OS_LABEL[r.os]} · ${t.profiles[r.profile]} · ${dayLabel(r)}` : id}
            </a>
          );
        })}
        {criteria.length > 0 && (
          <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
            {criteria.map((c, i) => (
              <li key={i} className="whitespace-nowrap text-[var(--color-base)]">
                <span aria-hidden="true">{c.ok ? "✅" : "❌"}</span>{" "}
                {c.round ? (
                  <Link href={testHref(c.round)} className="underline decoration-dotted hover:decoration-solid" style={{ color: "inherit" }}>
                    {criterion(c)}
                  </Link>
                ) : (
                  criterion(c)
                )}
              </li>
            ))}
          </ul>
        )}
        {/* with criteria the numbers say it already: the note stays in the tooltip */}
        {note && criteria.length === 0 && <div className="text-[10px] leading-snug text-[var(--color-dim)] line-clamp-2">{note}</div>}
      </div>
    );
  };
  const maxChart = Math.max(...chartRows.map((r) => perScored(r) ?? 0), 0.0001);

  const trade = (key: string) =>
    (Object.values(T) as Copy[]).map((c) => c.profiles[key]).filter(Boolean);
  const roundViews: CandidateView[] = data.rounds.map((r) => ({
    kind: "round",
    id: r.id,
    os: r.os,
    service: r.service,
    cost: r.cost,
    sector: PROFILE_SECTOR[r.profile] ?? "",
    trades: trade(r.profile),
    title: `${t.services[r.service]} · ${OS_LABEL[r.os]}`,
    subtitle: `${t.profiles[r.profile]}${t.modes[r.mode] ? ` · ${t.modes[r.mode]}` : ""} · ${dayLabel(r)}`,
    pill: { label: t.outcome[r.outcome], color: OUTCOME_COLOR[r.outcome] },
    stats: [
      { label: t.cols.spent, value: money(r.cost) },
      { label: t.cols.found, value: found(r) },
    ],
  }));
  const caseViews: CandidateView[] = CASE_STUDIES.map((c) => {
    const l = localizeCaseStudy(c, locale);
    return {
      kind: "case",
      id: c.id,
      href: `/case-studies/${c.id}`,
      service: c.model.toLowerCase(),
      sector: CATEGORY_SECTOR[c.category.toLowerCase()] ?? "",
      trades: [l.category, c.category, l.label],
      title: l.label,
      subtitle: l.tagline,
      stats: [{ label: c.subscription.provider, value: l.subscription.price }],
    };
  });
  const tradeSuggestions = Array.from(
    new Set([
      ...Object.keys(t.profiles)
        .filter((k) => k !== "generic")
        .map((k) => t.profiles[k]),
      ...CASE_STUDIES.map((c) => localizeCaseStudy(c, locale).category),
    ]),
  );
  // The charts: the rounds with their minute-by-minute series where one was extracted, and the Scout bench.
  type Extra = {
    minutes?: number | null;
    cost?: number | null;
    found?: number | null;
    scored?: number | null;
    ceiling?: number | null;
    timeline?: ChartRound["timeline"];
    scores?: ChartRound["scores"];
    scorePoints?: ChartRound["scorePoints"];
    scoreValues?: ChartRound["scoreValues"];
    brake?: ChartRound["brake"];
    agents?: Record<string, number> | null;
    relevance?: BenchProfile["relevance"];
    discarded?: Record<string, number> | null;
    bySource?: Record<string, number> | null;
  };
  const cc = CHART_COPY[locale];
  const roundSeries = ((data as unknown as { roundSeries?: Record<string, Extra> }).roundSeries ?? {}) as Record<string, Extra>;
  const benchRaw = ((data as unknown as { bench?: (Extra & { id: string; profile: string; os: string; service: string; buildNo: number })[] }).bench ?? []);
  const chartRounds: ChartRound[] = [
    ...data.rounds.map((r) => {
      const x = roundSeries[r.id] ?? {};
      return {
        id: r.id,
        label: `${OS_LABEL[r.os]} · ${t.profiles[r.profile]} · ${dayLabel(r)}`,
        group: "round" as const,
        os: r.os,
        service: r.service,
        buildNo: buildNo(r) ?? null,
        minutes: r.minutes,
        cost: r.cost,
        found: r.found,
        scored: r.scored,
        relevant: r.relevant,
        bestScore: r.bestScore,
        ceiling: x.ceiling ?? null,
        brake: x.brake ?? [],
        timeline: x.timeline ?? [],
        scores: x.scores ?? [],
        scorePoints: x.scorePoints ?? [],
        scoreValues: x.scoreValues ?? [],
        agents: x.agents ?? null,
      };
    }),
    ...benchRaw.map((b) => ({
      id: b.id,
      label: `${OS_LABEL[b.os]} · ${cc.benchProfiles[b.profile] ?? b.profile}${b.id.endsWith("bricklayer") ? ` (${cc.second})` : ""}`,
      group: "bench" as const,
      os: b.os,
      service: b.service,
      buildNo: b.buildNo,
      minutes: b.minutes ?? null,
      cost: b.cost ?? null,
      found: b.found ?? null,
      scored: b.scored ?? null,
      relevant: b.relevance?.P ?? null,
      bestScore: null,
      ceiling: b.ceiling ?? null,
      brake: b.brake ?? [],
      timeline: b.timeline ?? [],
      scores: b.scores ?? [],
      scorePoints: b.scorePoints ?? [],
      scoreValues: b.scoreValues ?? [],
      agents: b.agents ?? null,
    })),
  ];
  const chartBench: BenchProfile[] = benchRaw.map((b) => ({
    id: b.id,
    label: `${cc.benchProfiles[b.profile] ?? b.profile}${b.id.endsWith("bricklayer") ? ` (${cc.second})` : ""}`,
    relevance: b.relevance ?? null,
    discarded: b.discarded ?? null,
    bySource: b.bySource
      ? Object.fromEntries(Object.entries(b.bySource).map(([k, v]) => [cc.sources[k] ?? k, v]))
      : null,
  }));
  type BetaRaw = {
    day: string;
    hours: { h: number; positions: number | null; atLeast70: number | null }[];
    codex: { t: number; usedPct: number }[];
    experiments: { t: number; kind: string }[];
  };
  const betaRaw = (data as unknown as { betaDay?: BetaRaw }).betaDay;
  const chartBeta: BetaDay = betaRaw
    ? { ...betaRaw, experiments: betaRaw.experiments.map((e) => ({ t: e.t, label: cc.experimentKinds[e.kind] ?? e.kind })) }
    : null;
  const buildNos = Array.from(new Set([5, 6, 7, 8, 9, 10, ...data.builds.map((b: Build) => b.n)])).sort((a, b) => a - b);
  const chartBuilds: BuildPoint[] = buildNos.map((n) => {
    const snap = data.builds.find((b: Build) => b.n === n) as (Build & { targetsSnapshot?: Record<string, number>; defects?: { found: number; closed: number } }) | undefined;
    const counted: Record<string, number> = {};
    for (const x of data.targets as Target[]) if (x.build === n) counted[x.status] = (counted[x.status] ?? 0) + 1;
    return {
      n,
      targets: snap?.targetsSnapshot ?? (Object.keys(counted).length ? counted : null),
      defects: snap?.defects ?? ((data as unknown as { defects?: Record<string, { found: number | null; closed: number | null }> }).defects?.[String(n)] ?? null),
      fromCurrent: !snap?.targetsSnapshot,
    };
  });

  const serviceOptions = ["glm", "kimi", "openai", "claude"].map((v) => ({
    value: v,
    label: t.services[v],
  }));
  const osOptions = ["macos", "windows", "linux"].map((v) => ({
    value: v,
    label: OS_LABEL[v],
  }));

  return (
    <main className="min-h-screen bg-[var(--color-panel)] text-[var(--color-white)]">
      <LandingI18nProvider>
        <LandingNav />
      </LandingI18nProvider>
      <div aria-hidden="true" className="h-14" />

      <div className="mx-auto max-w-6xl px-4 py-8 space-y-10">
        <Link
          href="/case-studies"
          className="text-[12px] text-[var(--color-muted)] hover:underline"
        >
          {t.back}
        </Link>

        <header className="space-y-3">
          <h1 className="text-[28px] font-extrabold leading-tight">
            {t.title}
          </h1>
          <p className="text-[13px] text-[var(--color-muted)] max-w-3xl">
            {t.lead}
          </p>
          <div
            className="border-l-4 px-4 py-3 text-[13px] bg-[var(--color-card)] max-w-3xl"
            style={{ borderColor: "#F59E0B" }}
          >
            {t.banner}
          </div>
        </header>

        <section className="space-y-3" id="targets">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="section-label">{t.targetsTitle}</h2>
            <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold tabular-nums text-[var(--color-base)]">
              <span
                aria-hidden="true"
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: green === data.targets.length ? TARGET_COLOR.pass : TARGET_COLOR.fail }}
              />
              {t.targetsCount
                .replace("{g}", String(green))
                .replace("{n}", String(data.targets.length))}
            </span>
          </div>
          <p className="text-[12px] text-[var(--color-muted)] max-w-3xl">
            {t.targetsLead}
          </p>
          <div className="overflow-x-auto border border-[var(--color-border)] bg-[var(--color-card)]">
            <table className="w-full min-w-[620px] text-[12px] border-collapse">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                  <th className="px-3 py-2 font-semibold">{t.targetsCols.target}</th>
                  {TARGET_OS.map((os) => (
                    <th key={os} className="px-3 py-2 font-semibold w-[22%] border-l border-[var(--color-border)]">
                      <span className="inline-flex items-center gap-1.5 normal-case text-[12px] text-[var(--color-white)]">
                        <Mark id={os} label={OS_LABEL[os]} />
                        {OS_LABEL[os]}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              {TARGET_SECTIONS.map(([section, emoji]) => {
                const list = (data.targets as Target[]).filter((x) => x.section === section);
                if (list.length === 0) return null;
                const ok = list.filter((x) => x.status === "pass").length;
                const rows: { key: string; label: string; byOs: Record<string, Target> | null; one: Target | null; provider?: string }[] = [];
                for (const x of list) {
                  const row = (x as { row?: string }).row;
                  const os = (x as { os?: string }).os;
                  if (row && os) {
                    const r = rows.find((y) => y.key === row);
                    if (r?.byOs) r.byOs[os] = x;
                    else rows.push({ key: row, label: t.targetRows[row], byOs: { [os]: x }, one: null });
                  } else {
                    const emoji = (x as { emoji?: string }).emoji;
                    rows.push({ key: x.id, label: `${emoji ? `${emoji} ` : ""}${t.targets[x.id]}`, byOs: null, one: x, provider: (x as { provider?: string }).provider });
                  }
                }
                return (
                  <tbody key={section}>
                    <tr className="border-t-2 border-[var(--color-border-glow)] bg-[var(--color-row)]">
                      <th colSpan={4} scope="colgroup" className="px-3 py-2 text-left">
                        <span className="inline-flex items-center gap-2 text-[13px] font-bold">
                          <span aria-hidden="true">{emoji}</span>
                          {t.targetSections[section]}
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tabular-nums text-[var(--color-muted)]">
                            <span
                              aria-hidden="true"
                              className="inline-block w-2 h-2 rounded-full"
                              style={{ background: ok === list.length ? TARGET_COLOR.pass : TARGET_COLOR.fail }}
                            />
                            {`${ok}/${list.length}`}
                          </span>
                        </span>
                        {t.targetRules[section] && (
                          <span className="block mt-1 text-[11px] font-normal text-[var(--color-muted)]">{t.targetRules[section]}</span>
                        )}
                      </th>
                    </tr>
                    {rows.map((r) => (
                      <tr key={r.key} className="border-t border-[var(--color-border)] align-top">
                        <th scope="row" className="px-3 py-2 text-left font-normal min-w-[180px]">
                          {r.provider ? (
                            <span className="inline-flex items-start gap-2">
                              <span className="mt-[2px]">
                                <ProviderMark id={r.provider} label={t.services[r.provider] ?? r.provider} />
                              </span>
                              <span>{r.label}</span>
                            </span>
                          ) : (
                            r.label
                          )}
                        </th>
                        {r.byOs ? (
                          TARGET_OS.map((os) => (
                            <td key={os} className="px-3 py-2 border-l border-[var(--color-border)]">
                              {r.byOs![os] ? targetCell(r.byOs![os]) : <span className="text-[var(--color-dim)]">{t.none}</span>}
                            </td>
                          ))
                        ) : (
                          <td colSpan={3} className="px-3 py-2 border-l border-[var(--color-border)]">
                            {targetCell(r.one!)}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                );
              })}
            </table>
          </div>
          <div className="space-y-1 text-[12px]">
            <h3 className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
              {t.buildsTitle}
            </h3>
            <ul className="space-y-1">
              {data.builds.map((b: Build) => (
                <li key={b.n} className="flex flex-wrap gap-x-3 gap-y-1">
                  <span className="font-semibold tabular-nums">
                    {t.buildLabel.replace("{n}", String(b.n))}
                    {b.commit ? (
                      <span className="text-[var(--color-dim)] font-normal">
                        {" "}
                        · {b.commit}
                        {b.day ? ` · ${b.day}` : ""}
                      </span>
                    ) : null}
                  </span>
                  {b.rounds.length ? (
                    b.rounds.map((id: string) => roundLink(id))
                  ) : (
                    <span className="text-[var(--color-muted)]">
                      {t.noRound}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <Suspense fallback={null}>
          <BenchmarkFinder
            copy={t.finder}
            candidates={[...roundViews, ...caseViews]}
            trades={tradeSuggestions}
            osOptions={osOptions}
            serviceOptions={serviceOptions}
            locale={locale}
          />
        </Suspense>

        <section className="space-y-3">
          <h2 className="section-label">{t.roundsTitle}</h2>
          <div className="overflow-x-auto border border-[var(--color-border)] bg-[var(--color-card)]">
            <table className="w-full text-[12px] tabular-nums">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                  {[
                    t.cols.round,
                    t.cols.profile,
                    t.cols.minutes,
                    t.cols.spent,
                    t.cols.found,
                    t.cols.perScored,
                    t.cols.outcome,
                    t.cols.note,
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 font-semibold whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rounds.map((r) => (
                  <tr
                    key={r.id}
                    id={r.id}
                    className="border-t border-[var(--color-border)] align-top scroll-mt-20"
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        <Mark id={r.os} label={OS_LABEL[r.os]} />
                        <Mark id={r.service} label={t.services[r.service]} />
                        <span>
                          {/* every round opens its own page */}
                          <Link href={testHref(r.id)} className="font-semibold underline decoration-dotted hover:decoration-solid">
                            {t.services[r.service]}
                          </Link>
                          <br />
                          <span className="text-[var(--color-muted)]">
                            {OS_LABEL[r.os]} · {dayLabel(r)}
                            {buildNo(r)
                              ? ` · ${t.buildLabel.replace("{n}", String(buildNo(r)))}`
                              : ""}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {t.profiles[r.profile]}
                      {t.modes[r.mode] ? (
                        <span className="text-[var(--color-muted)]">
                          {" "}
                          · {t.modes[r.mode]}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.minutes == null ? "—" : r.minutes}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {money(r.cost)}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {found(r)}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {money(perScored(r))}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 whitespace-nowrap"
                        style={{
                          color: OUTCOME_COLOR[r.outcome],
                          background: `color-mix(in srgb, ${OUTCOME_COLOR[r.outcome]} 16%, transparent)`,
                        }}
                      >
                        {t.outcome[r.outcome]}
                      </span>
                    </td>
                    <td className="px-3 py-2 min-w-[240px] text-[var(--color-muted)]">
                      {t.notes[r.note]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-[var(--color-dim)]">{t.colsHint}</p>
        </section>

        <BenchmarkCharts
          locale={locale}
          rounds={chartRounds}
          bench={chartBench}
          builds={chartBuilds}
          beta={chartBeta}
          labels={{ services: t.services, os: OS_LABEL, targetStatus: t.targetStatus }}
        />

        <section className="space-y-3">
          <h2 className="section-label">{t.chartTitle}</h2>
          <p className="text-[12px] text-[var(--color-muted)] max-w-3xl">
            {t.chartLead}
          </p>
          <div
            className="bg-[var(--color-card)] border border-[var(--color-border)] p-5 space-y-3"
            role="img"
            aria-label={t.chartTitle}
          >
            {chartRows.map((r) => {
              const v = perScored(r);
              return (
                <div
                  key={r.id}
                  className="grid grid-cols-[minmax(150px,230px)_1fr_90px] items-center gap-3 text-[12px]"
                >
                  <span className="inline-flex items-center gap-2 truncate">
                    <Mark id={r.service} label={t.services[r.service]} />
                    <span className="truncate">
                      {OS_LABEL[r.os]} · {t.profiles[r.profile]}
                    </span>
                  </span>
                  <span className="h-3.5 border-l border-[var(--color-border)]">
                    {v != null && (
                      <span
                        className="block h-full"
                        style={{
                          width: `${(v / maxChart) * 100}%`,
                          background: "#0EA5A4",
                        }}
                      />
                    )}
                  </span>
                  <span className="text-right tabular-nums font-semibold">
                    {v == null ? t.chartNone : money(v)}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-[var(--color-dim)] max-w-3xl">
            {t.chartCaveat}
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="section-label">{t.servicesTitle}</h2>
          <div className="overflow-x-auto border border-[var(--color-border)] bg-[var(--color-card)]">
            <table className="w-full text-[12px] tabular-nums">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                  {Object.values(t.servicesCols).map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 font-semibold whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.services.map((s) => (
                  <tr
                    key={s.id}
                    className="border-t border-[var(--color-border)] align-top"
                  >
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-2 font-semibold">
                        <Mark id={s.id} label={t.services[s.id]} />
                        {t.services[s.id]}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {nf.format(s.kitEstimate30min[0])} –{" "}
                      {nf.format(s.kitEstimate30min[1])} $
                    </td>
                    <td className="px-3 py-2">
                      {s.seen.length === 0
                        ? "—"
                        : s.seen
                            .map(
                              (x) =>
                                `${nf.format(x.cost)} $ / ${x.minutes} min`,
                            )
                            .join(" · ")}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {s.ratePerMinute
                        ? s.ratePerMinute[0] === s.ratePerMinute[1]
                          ? `${nf.format(s.ratePerMinute[0])} $/min`
                          : `${nf.format(s.ratePerMinute[0])} – ${nf.format(s.ratePerMinute[1])} $/min`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-[var(--color-dim)] max-w-3xl">
            {t.servicesCaveat}
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="section-label">{t.osTitle}</h2>
          <div className="grid gap-3 md:grid-cols-3">
            {(["linux", "windows", "macos"] as const).map((os) => (
              <div
                key={os}
                className="border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <Mark id={os} label={OS_LABEL[os]} />
                  <span className="text-[14px] font-bold">{OS_LABEL[os]}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                    {t.system[data.systems[os]]}
                  </span>
                </div>
                <p className="text-[12px] text-[var(--color-muted)]">
                  {t.osNotes[os]}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="section-label">{t.limitsTitle}</h2>
          <div
            className="border-l-4 bg-[var(--color-card)] px-4 py-3 space-y-2 max-w-3xl"
            style={{ borderColor: "#F59E0B" }}
          >
            <p className="text-[13px]">{t.limitsLead}</p>
            <ul className="list-disc pl-5 text-[12px] text-[var(--color-muted)] space-y-1">
              {t.limits.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p className="text-[13px] pt-2">
              <strong>{t.needTitle}.</strong> {t.need}
            </p>
          </div>
        </section>
      </div>

      <footer className="border-t border-[var(--color-border)] py-6 text-center text-[11px] text-[var(--color-muted)]">
        {t.footer}
      </footer>
    </main>
  );
}
