// Every test of the benchmark as one list, rounds and Scout bench together, with the readable address of its own page
// (/case-studies/benchmark-0-4-0/<slug>, e.g. 2026-11-17-windows-receptionist-claude). Only the synthetic and aggregated
// data of web/data/benchmark/benchmark-0-4-0.json.

import data from "@/data/benchmark/benchmark-0-4-0.json";
import type { ChartRound, TimelinePoint } from "./BenchmarkCharts";

type Series = {
  minutes?: number | null;
  cost?: number | null;
  found?: number | null;
  scored?: number | null;
  ceiling?: number | null;
  timeline?: TimelinePoint[];
  scores?: { m: number; best: number }[];
  scorePoints?: { m: number; s: number }[];
  scoreValues?: number[];
  scoresMissing?: string | null;
  brake?: { m: number; kind: string }[];
  agents?: Record<string, number> | null;
  relevance?: { P?: number; A?: number; X?: number } | null;
  discarded?: Record<string, number> | null;
  bySource?: Record<string, number> | null;
};

export type RoundCriterion = {
  k: string;
  ok: boolean | null;
  v?: number;
  of?: number;
  min?: number;
  max?: number;
  at?: number[];
};

export type TestEntry = {
  id: string;
  slug: string;
  kind: "round" | "bench";
  os: string;
  service: string;
  profile: string;
  buildNo: number | null;
  date: string; // ISO day the test started
  day: string; // the day as the table writes it, e.g. «15-16/11 night»
  minutes: number | null;
  cost: number | null;
  found: number | null;
  scored: number | null;
  relevant: number | null;
  bestScore: number | null;
  outcome: string | null;
  note: string | null;
  target: string | null; // the release target this test proves, for its criteria
  invalid: string | null; // broken by a cause of ours: why
  criteria: RoundCriterion[]; // the path of a person, for a round
  series: Series;
};

const YEAR = 2026;
const kebab = (s: string) =>
  s.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
const isoDay = (day: string) => {
  const m = /(\d{1,2})(?:-\d{1,2})?\/(\d{1,2})/.exec(day);
  return m
    ? `${YEAR}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
    : `${YEAR}-00-00`;
};

const roundSeries = ((
  data as unknown as { roundSeries?: Record<string, Series> }
).roundSeries ?? {}) as Record<string, Series>;
type BenchRaw = Series & {
  id: string;
  profile: string;
  os: string;
  service: string;
  buildNo: number;
};
const benchRaw = ((data as unknown as { bench?: BenchRaw[] }).bench ??
  []) as BenchRaw[];
// the day of the Scout bench of build 9
const BENCH_DAY = "17/11";
const BENCH_TARGET: Record<string, string> = {
  cook: "scoutBenchCook",
  warehouseWorker: "scoutBenchWarehouse",
  nurse: "scoutBenchNurse",
  bricklayer: "scoutBenchBricklayer",
};

// Two rounds of the same day, system, trade and service (an update and its retests) would share an address: the first
// keeps the plain one, each later one adds the commit it tried.
const roundSlugs = new Map<string, string>();
const taken = new Set<string>();
for (const r of data.rounds) {
  const plain = `${isoDay(r.day)}-${r.os}-${kebab(r.profile)}-${r.service}`;
  const slug = taken.has(plain) ? `${plain}-${r.build}` : plain;
  taken.add(slug);
  roundSlugs.set(r.id, slug);
}

export const TESTS: TestEntry[] = [
  ...data.rounds.map((r) => {
    const s = roundSeries[r.id] ?? {};
    return {
      id: r.id,
      slug: roundSlugs.get(r.id) as string,
      kind: "round" as const,
      os: r.os,
      service: r.service,
      profile: r.profile,
      buildNo: (r as { buildNo?: number }).buildNo ?? null,
      date: isoDay(r.day),
      day: r.day,
      minutes: r.minutes,
      cost: r.cost,
      found: r.found,
      scored: r.scored,
      relevant: r.relevant,
      bestScore: r.bestScore,
      outcome: r.outcome,
      note: r.note,
      target: null,
      invalid: (r as { invalid?: string }).invalid ?? null,
      criteria: ((r as { criteria?: RoundCriterion[] }).criteria ??
        []) as RoundCriterion[],
      series: s,
    };
  }),
  ...benchRaw.map((b) => ({
    id: b.id,
    slug: `${isoDay(BENCH_DAY)}-${b.os}-${kebab(b.profile)}-${b.service}-scout-bench`,
    kind: "bench" as const,
    os: b.os,
    service: b.service,
    profile: b.profile,
    buildNo: b.buildNo,
    date: isoDay(BENCH_DAY),
    day: BENCH_DAY,
    minutes: b.minutes ?? null,
    cost: b.cost ?? null,
    found: b.found ?? null,
    scored: b.scored ?? null,
    relevant: b.relevance?.P ?? null,
    bestScore: null,
    outcome: null,
    note: null,
    target: BENCH_TARGET[b.profile] ?? null,
    invalid: null,
    criteria: [],
    series: b,
  })),
];

export const testBySlug = (slug: string) =>
  TESTS.find((x) => x.slug === slug) ?? null;
export const testById = (id: string) => TESTS.find((x) => x.id === id) ?? null;
export const testHref = (id: string) => {
  const x = testById(id);
  return x
    ? `/case-studies/benchmark-0-4-0/${x.slug}`
    : `/case-studies/benchmark-0-4-0#${id}`;
};

/** The test before and after this one on the same system, in the order they ran. */
export function neighbours(x: TestEntry) {
  const same = TESTS.filter(
    (y) => y.os === x.os && (!y.invalid || y.id === x.id),
  ).sort((a, b) =>
    a.date === b.date
      ? TESTS.indexOf(a) - TESTS.indexOf(b)
      : a.date < b.date
        ? -1
        : 1,
  );
  const i = same.indexOf(x);
  return {
    prev: i > 0 ? same[i - 1] : null,
    next: i >= 0 && i < same.length - 1 ? same[i + 1] : null,
  };
}

/** The test as the charts draw it. */
export function chartRoundOf(x: TestEntry, label: string): ChartRound {
  const s = x.series;
  return {
    id: x.id,
    label,
    group: x.kind,
    os: x.os,
    service: x.service,
    buildNo: x.buildNo,
    minutes: x.minutes,
    cost: x.cost,
    found: x.found,
    scored: x.scored,
    relevant: x.relevant,
    bestScore: x.bestScore,
    ceiling: s.ceiling ?? null,
    brake: s.brake ?? [],
    timeline: s.timeline ?? [],
    scores: s.scores ?? [],
    scorePoints: s.scorePoints ?? [],
    scoreValues: s.scoreValues ?? [],
    scoresMissing: s.scoresMissing ?? null,
    agents: s.agents ?? null,
  };
}
