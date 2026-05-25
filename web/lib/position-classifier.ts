// Classificatore deterministico del titolo di una posizione in macro-categorie
// per il widget "Tipologie" della dashboard. Heuristic basato su regex priority
// list: la prima categoria che fa match vince. L'ordine e' studiato perche'
// titoli come "Python Backend Engineer" cadono in Backend (specifico), non in
// Python (catch-all). "AI / ML" sta in cima perche' un "AI Software Engineer"
// e' AI prima che generico SWE.

export type PositionType =
  | "ai_ml"
  | "data"
  | "devops_cloud"
  | "full_stack"
  | "backend"
  | "frontend"
  | "python"
  | "software_engineer"
  | "other";

type Rule = { type: PositionType; pattern: RegExp };

const RULES: Rule[] = [
  // AI / ML: keyword forti (ai engineer, ml, llm, gen ai, applied ai)
  {
    type: "ai_ml",
    pattern:
      /\b(ai|a\.i\.|artificial intelligence|machine learning|ml engineer|llm|gen ?ai|nlp|computer vision|cv engineer|deep learning)\b/i,
  },
  // Data: scientist / analyst / engineer / analytics
  {
    type: "data",
    pattern:
      /\b(data scientist|data analyst|data engineer|data engineering|analytics|business intelligence|bi engineer|big data)\b/i,
  },
  // DevOps / Cloud / Platform / SRE / Infra
  {
    type: "devops_cloud",
    pattern:
      /\b(devops|sre|site reliability|cloud (engineer|developer|architect)|kubernetes|k8s|platform engineer|infrastructure|infra engineer)\b/i,
  },
  // Full Stack
  {
    type: "full_stack",
    pattern: /\b(full ?stack|full-stack|fullstack)\b/i,
  },
  // Backend (anche back-end / server-side)
  {
    type: "backend",
    pattern:
      /\b(back ?end|back-end|backend|server ?side|api engineer|microservices)\b/i,
  },
  // Frontend / UI
  {
    type: "frontend",
    pattern:
      /\b(front ?end|front-end|frontend|react|vue|angular|ui engineer|ui developer)\b/i,
  },
  // Python catch-all (dopo le specializzazioni)
  { type: "python", pattern: /\bpython\b/i },
  // Software Engineer / Developer generico
  {
    type: "software_engineer",
    pattern:
      /\b(software engineer|software developer|software dev|swe|developer|engineer)\b/i,
  },
];

export function classifyTitle(title: string | null | undefined): PositionType {
  if (!title) return "other";
  for (const r of RULES) if (r.pattern.test(title)) return r.type;
  return "other";
}

// Palette coerente con il design system della dashboard. Niente verde puro
// (riservato ad "applied"); usiamo accenti gia' presenti come var CSS.
export const POSITION_TYPE_COLOR: Record<PositionType, string> = {
  ai_ml: "var(--color-purple)",
  data: "var(--color-blue)",
  devops_cloud: "var(--color-orange)",
  full_stack: "#7fffb2",
  backend: "var(--color-yellow)",
  frontend: "#58a6ff",
  python: "#3776ab",
  software_engineer: "var(--color-muted)",
  other: "var(--color-dim)",
};

export const POSITION_TYPE_ORDER: PositionType[] = [
  "ai_ml",
  "data",
  "devops_cloud",
  "full_stack",
  "backend",
  "frontend",
  "python",
  "software_engineer",
  "other",
];

export type PositionTypeCount = {
  type: PositionType;
  count: number;
  color: string;
  // Media degli score (0-100) per le sole posizioni di questo tipo che
  // hanno uno score numerico. null se nessuna posizione del tipo è
  // stata scorata.
  avgScore: number | null;
  // Media del voto critico (0-10) per le sole posizioni di questo tipo
  // che hanno un voto critico numerico. null se nessuna è stata
  // revisionata dal critico.
  avgCritic: number | null;
  // Score grezzi (0-100) di tutte le posizioni di questo tipo che
  // hanno uno score numerico. Usato per filtrare la distribuzione
  // score per tipo (interazione donut → histogram in /map). Optional
  // per retro-compatibilità con sorgenti locali.
  scores?: number[];
};

export function aggregateTypes(
  rows: Array<{
    title: string | null | undefined;
    score: number | null | undefined;
    critic: number | null | undefined;
  }>,
): PositionTypeCount[] {
  const counts: Record<PositionType, number> = {
    ai_ml: 0,
    data: 0,
    devops_cloud: 0,
    full_stack: 0,
    backend: 0,
    frontend: 0,
    python: 0,
    software_engineer: 0,
    other: 0,
  };
  const scoreSum: Record<PositionType, number> = { ...counts };
  const scoreN: Record<PositionType, number> = { ...counts };
  const criticSum: Record<PositionType, number> = { ...counts };
  const criticN: Record<PositionType, number> = { ...counts };
  const scoresByType: Record<PositionType, number[]> = {
    ai_ml: [], data: [], devops_cloud: [], full_stack: [],
    backend: [], frontend: [], python: [], software_engineer: [], other: [],
  };
  for (const r of rows) {
    const t = classifyTitle(r.title);
    counts[t] += 1;
    if (typeof r.score === "number" && Number.isFinite(r.score)) {
      scoreSum[t] += r.score;
      scoreN[t] += 1;
      scoresByType[t].push(r.score);
    }
    if (typeof r.critic === "number" && Number.isFinite(r.critic)) {
      criticSum[t] += r.critic;
      criticN[t] += 1;
    }
  }
  return POSITION_TYPE_ORDER
    .map((type) => ({
      type,
      count: counts[type],
      color: POSITION_TYPE_COLOR[type],
      avgScore: scoreN[type] > 0 ? scoreSum[type] / scoreN[type] : null,
      avgCritic: criticN[type] > 0 ? criticSum[type] / criticN[type] : null,
      scores: scoresByType[type],
    }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
}
