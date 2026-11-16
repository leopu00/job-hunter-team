// "Find the tests closest to your case" on the benchmark page: pure functions, tested in tests/js/tasks/benchmark-match.test.ts.
// A candidate is a round of the benchmark or a case study; a query is what the visitor says about themselves.

export const SECTORS = [
  "hospitality",
  "health",
  "trades",
  "office",
  "culture",
  "it",
  "transport",
] as const;
export type Sector = (typeof SECTORS)[number];

export type Query = {
  os: string;
  service: string;
  budget: number | null;
  trade: string;
  sector: string;
};
export const EMPTY_QUERY: Query = {
  os: "",
  service: "",
  budget: null,
  trade: "",
  sector: "",
};

export type Candidate = {
  kind: "round" | "case";
  id: string;
  /** the page of the candidate, when it has its own */
  href?: string;
  os?: string;
  service?: string;
  /** what the round spent, in dollars (a case study has a monthly subscription instead: no budget to compare) */
  cost?: number | null;
  sector?: Sector | "";
  /** the trade as the visitor may write it, in every language of the site */
  trades: string[];
};

export type ReasonCode =
  | "service-same"
  | "service-other"
  | "os-same"
  | "os-other"
  | "sector-same"
  | "sector-other"
  | "trade-same"
  | "trade-similar"
  | "budget-close"
  | "budget-other";
export type Reason = { code: ReasonCode; value?: string; other?: string };

export type Match = {
  candidate: Candidate;
  score: number;
  /** every field the visitor filled and the candidate can answer is the same */
  exact: boolean;
  reasons: Reason[];
  /** the visitor's budget divided by what the round spent: an estimate by proportion, only when it differs enough to say so */
  scale: number | null;
};

const BUDGET_CLOSE_MIN = 0.7;
const BUDGET_CLOSE_MAX = 1.4;
const PREFIX = 4;

/** Lower case, no accents, single spaces: «Sanità» and «sanita» are the same word. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((t) => t.length >= 3);
}

/** The relation between the trade written and the trades of a candidate: the same one, a similar one (a word that starts the same), or none. */
export function tradeRelation(
  written: string,
  trades: string[],
): "same" | "similar" | "none" {
  const w = normalize(written);
  if (!w) return "none";
  const wt = tokens(written);
  let similar = false;
  for (const t of trades) {
    const n = normalize(t);
    if (!n) continue;
    if (n === w || n.includes(w) || (w.includes(n) && n.length >= 5))
      return "same";
    const ct = tokens(t);
    if (
      wt.some((a) =>
        ct.some(
          (b) =>
            a === b ||
            (a.length >= PREFIX &&
              b.length >= PREFIX &&
              a.slice(0, PREFIX) === b.slice(0, PREFIX)),
        ),
      )
    )
      similar = true;
  }
  return similar ? "similar" : "none";
}

/** A service id like `openai-glm` (one round that used two) matches each of its parts. */
export function serviceMatches(
  candidateService: string,
  wanted: string,
): boolean {
  return (
    candidateService === wanted || candidateService.split("-").includes(wanted)
  );
}

export function hasQuery(q: Query): boolean {
  return Boolean(
    q.os ||
    q.service ||
    (q.budget && q.budget > 0) ||
    q.trade.trim() ||
    q.sector,
  );
}

export function matchOne(c: Candidate, q: Query): Match {
  const reasons: Reason[] = [];
  let score = 0;
  let exact = true;
  let applicable = 0;

  if (q.os && c.os) {
    applicable++;
    if (c.os === q.os) {
      reasons.push({ code: "os-same", value: c.os });
      score += 1.5;
    } else {
      reasons.push({ code: "os-other", value: c.os });
      exact = false;
    }
  }
  if (q.service && c.service) {
    applicable++;
    if (serviceMatches(c.service, q.service)) {
      reasons.push({ code: "service-same", value: c.service });
      score += 2;
    } else {
      reasons.push({ code: "service-other", value: c.service });
      exact = false;
    }
  }
  // the occupation: the trade written, the sector chosen, or both; same if either says same
  const rel = q.trade.trim() ? tradeRelation(q.trade, c.trades) : null;
  const sectorSame = q.sector && c.sector ? c.sector === q.sector : null;
  if (rel !== null || sectorSame !== null) {
    applicable++;
    if (rel === "same") {
      reasons.push({ code: "trade-same" });
      score += 3;
    } else if (sectorSame) {
      reasons.push({ code: "sector-same", value: c.sector || "" });
      score += 3;
    } else if (rel === "similar") {
      reasons.push({ code: "trade-similar", value: c.trades[0] });
      score += 1.5;
      exact = false;
    } else {
      reasons.push({ code: "sector-other", value: c.sector || "" });
      exact = false;
    }
  }
  let scale: number | null = null;
  if (q.budget && q.budget > 0 && c.cost && c.cost > 0) {
    applicable++;
    const ratio = q.budget / c.cost;
    if (ratio >= BUDGET_CLOSE_MIN && ratio <= BUDGET_CLOSE_MAX) {
      reasons.push({ code: "budget-close", value: String(c.cost) });
      score += 1;
    } else {
      reasons.push({
        code: "budget-other",
        value: String(c.cost),
        other: String(q.budget),
      });
      exact = false;
      scale = Math.round(ratio * 10) / 10;
    }
  }
  return {
    candidate: c,
    score,
    exact: exact && applicable > 0,
    reasons,
    scale,
  };
}

/** Those that match every field filled in, then the closest (something in common, best first); at most `limit` of the second kind. */
export function matchCandidates(
  candidates: Candidate[],
  q: Query,
  limit = 6,
): { exact: Match[]; close: Match[] } {
  if (!hasQuery(q)) return { exact: [], close: [] };
  const all = candidates.map((c) => matchOne(c, q));
  const byScore = (a: Match, b: Match) =>
    b.score - a.score || a.candidate.id.localeCompare(b.candidate.id);
  const exact = all.filter((m) => m.exact).sort(byScore);
  const close = all
    .filter((m) => !m.exact && m.score > 0)
    .sort(byScore)
    .slice(0, limit);
  return { exact, close };
}

/** The query from a query string; a value that is not one of the options is dropped. */
export function parseQuery(
  params: { get(name: string): string | null } | null | undefined,
  options: { os: string[]; service: string[] },
): Query {
  const read = (k: string) => (params?.get(k) ?? "").trim().slice(0, 80);
  const budget = Number(read("budget").replace(",", "."));
  const sector = read("sector");
  return {
    os: options.os.includes(read("os")) ? read("os") : "",
    service: options.service.includes(read("service")) ? read("service") : "",
    budget:
      Number.isFinite(budget) && budget > 0 && budget <= 100000 ? budget : null,
    trade: read("trade"),
    sector: (SECTORS as readonly string[]).includes(sector) ? sector : "",
  };
}

/** The query string of a query: only what is filled in, in a fixed order (a shared link stays the same). */
export function queryToParams(q: Query): URLSearchParams {
  const out = new URLSearchParams();
  if (q.os) out.set("os", q.os);
  if (q.service) out.set("service", q.service);
  if (q.budget && q.budget > 0) out.set("budget", String(q.budget));
  if (q.trade.trim()) out.set("trade", q.trade.trim());
  if (q.sector) out.set("sector", q.sector);
  return out;
}
