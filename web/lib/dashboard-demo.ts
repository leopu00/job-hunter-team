import type {
  DashboardStats,
  PendingMessage,
  PositionWithScore,
} from "@/lib/types";

type ScoreDistribution = {
  buckets: Array<{ label: string; count: number; color: string }>;
  total: number;
  withScore: number;
  avgScore: number | null;
};

type SourceDistribution = Array<{ source: string; count: number }>;

export function isDashboardDemoMode(
  search: string | null | undefined,
): boolean {
  if (process.env.JHT_WEB_DASHBOARD_DEMO === "1") return true;
  if (process.env.NODE_ENV === "production") return false;

  const params = new URLSearchParams((search ?? "").replace(/^\?/, ""));
  const demo = params.get("demo");
  return demo === "1" || demo === "dashboard";
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function position(input: {
  id: string;
  legacyId: number;
  title: string;
  company: string;
  location: string;
  remoteType: PositionWithScore["remote_type"];
  salaryMin?: number;
  salaryMax?: number;
  source: string;
  foundHoursAgo: number;
  status: PositionWithScore["status"];
  score?: number;
}): PositionWithScore {
  return {
    id: input.id,
    legacy_id: input.legacyId,
    title: input.title,
    company: input.company,
    company_id: null,
    location: input.location,
    remote_type: input.remoteType,
    salary_declared_min: input.salaryMin ?? null,
    salary_declared_max: input.salaryMax ?? null,
    salary_declared_currency: input.salaryMin ? "EUR" : null,
    salary_estimated_min: null,
    salary_estimated_max: null,
    salary_estimated_currency: null,
    salary_estimated_source: null,
    url: `https://example.test/jobs/${input.id}`,
    source: input.source,
    jd_text: null,
    requirements: null,
    found_by: `scout-${(input.legacyId % 3) + 1}`,
    found_at: hoursAgo(input.foundHoursAgo),
    deadline: null,
    status: input.status,
    notes: null,
    last_checked:
      input.status === "new" ? null : hoursAgo(input.foundHoursAgo - 1),
    score: input.score,
  };
}

const positions: PositionWithScore[] = [
  position({
    id: "demo-001",
    legacyId: 1,
    title: "Senior Frontend Engineer",
    company: "Northstar Labs",
    location: "Company EU",
    remoteType: "full_remote",
    salaryMin: 72000,
    salaryMax: 92000,
    source: "LinkedIn",
    foundHoursAgo: 2,
    status: "ready",
    score: 91,
  }),
  position({
    id: "demo-002",
    legacyId: 2,
    title: "Full Stack Product Engineer",
    company: "AtlasCare",
    location: "Milano, IT",
    remoteType: "hybrid",
    salaryMin: 58000,
    salaryMax: 74000,
    source: "Wellfound",
    foundHoursAgo: 5,
    status: "review",
    score: 78,
  }),
  position({
    id: "demo-003",
    legacyId: 3,
    title: "React Platform Engineer",
    company: "GreenGrid",
    location: "Berlin, DE",
    remoteType: "full_remote",
    salaryMin: 80000,
    salaryMax: 105000,
    source: "Otta",
    foundHoursAgo: 7,
    status: "writing",
    score: 84,
  }),
  position({
    id: "demo-004",
    legacyId: 4,
    title: "AI Workflow Engineer",
    company: "SignalForge",
    location: "Company",
    remoteType: "full_remote",
    salaryMin: 70000,
    salaryMax: 98000,
    source: "Hacker News",
    foundHoursAgo: 11,
    status: "applied",
    score: 87,
  }),
  position({
    id: "demo-005",
    legacyId: 5,
    title: "TypeScript Engineer",
    company: "FinPilot",
    location: "Amsterdam, NL",
    remoteType: "hybrid",
    salaryMin: 68000,
    salaryMax: 86000,
    source: "LinkedIn",
    foundHoursAgo: 16,
    status: "response",
    score: 76,
  }),
  position({
    id: "demo-006",
    legacyId: 6,
    title: "Backend Engineer, Node.js",
    company: "FlowOps",
    location: "Torino, IT",
    remoteType: "hybrid",
    salaryMin: 52000,
    salaryMax: 68000,
    source: "Indeed",
    foundHoursAgo: 20,
    status: "scored",
    score: 66,
  }),
  position({
    id: "demo-007",
    legacyId: 7,
    title: "Design Systems Engineer",
    company: "BrightRoom",
    location: "Barcelona, ES",
    remoteType: "full_remote",
    salaryMin: 62000,
    salaryMax: 79000,
    source: "Cord",
    foundHoursAgo: 26,
    status: "checked",
    score: 58,
  }),
  position({
    id: "demo-008",
    legacyId: 8,
    title: "Frontend Developer",
    company: "MarketNest",
    location: "Roma, IT",
    remoteType: "onsite",
    salaryMin: 42000,
    salaryMax: 53000,
    source: "LinkedIn",
    foundHoursAgo: 31,
    status: "new",
  }),
  position({
    id: "demo-009",
    legacyId: 9,
    title: "SaaS Integration Engineer",
    company: "Pipebase",
    location: "Company EU",
    remoteType: "full_remote",
    salaryMin: 61000,
    salaryMax: 83000,
    source: "Company site",
    foundHoursAgo: 39,
    status: "writing",
    score: 72,
  }),
  position({
    id: "demo-010",
    legacyId: 10,
    title: "Customer Platform Engineer",
    company: "Mosaic Cloud",
    location: "Paris, FR",
    remoteType: "hybrid",
    salaryMin: 65000,
    salaryMax: 84000,
    source: "Welcome to the Jungle",
    foundHoursAgo: 47,
    status: "ready",
    score: 81,
  }),
  position({
    id: "demo-011",
    legacyId: 11,
    title: "Product Engineer",
    company: "NovaPay",
    location: "Company",
    remoteType: "full_remote",
    salaryMin: 76000,
    salaryMax: 99000,
    source: "Wellfound",
    foundHoursAgo: 54,
    status: "applied",
    score: 89,
  }),
  position({
    id: "demo-012",
    legacyId: 12,
    title: "UI Engineer",
    company: "Studio Relay",
    location: "Firenze, IT",
    remoteType: "hybrid",
    salaryMin: 45000,
    salaryMax: 59000,
    source: "Indeed",
    foundHoursAgo: 61,
    status: "scored",
    score: 43,
  }),
];

const stats: DashboardStats = {
  total: 42,
  new: 7,
  checked: 8,
  scored: 9,
  writing: 6,
  review: 4,
  ready: 3,
  applied: 4,
  response: 1,
  excluded: 5,
};

const scoreDistribution: ScoreDistribution = {
  buckets: [
    { label: "76-100", count: 11, color: "var(--color-green)" },
    { label: "61-75", count: 9, color: "var(--color-yellow)" },
    { label: "41-60", count: 6, color: "var(--color-orange)" },
    { label: "<= 40", count: 3, color: "var(--color-red)" },
  ],
  total: 37,
  withScore: 29,
  avgScore: 72,
};

const sourceDistribution: SourceDistribution = [
  { source: "LinkedIn", count: 14 },
  { source: "Wellfound", count: 8 },
  { source: "Otta", count: 6 },
  { source: "Indeed", count: 5 },
  { source: "Company site", count: 4 },
  { source: "Hacker News", count: 3 },
  { source: "Cord", count: 2 },
];

const pendingMessages: PendingMessage[] = [
  {
    id: "demo-msg-1",
    agent: "capitano",
    body: "Ho preparato 3 candidature ad alta priorita'. Controlla prima Northstar Labs: score 91, full remote EU, range coerente.",
    kind: "digest",
    related_position_id: null,
    delivered_via: "web",
    delivered_at: hoursAgo(1),
    acknowledged_at: null,
    user_reply: null,
    user_reply_at: null,
    agent_seen_reply_at: null,
    created_at: hoursAgo(1),
  },
  {
    id: "demo-msg-2",
    agent: "assistente",
    body: "Per AtlasCare manca una preferenza: vuoi puntare piu' sul profilo React o sul lavoro di prodotto nella cover letter?",
    kind: "question",
    related_position_id: null,
    delivered_via: "web",
    delivered_at: hoursAgo(3),
    acknowledged_at: null,
    user_reply: null,
    user_reply_at: null,
    agent_seen_reply_at: null,
    created_at: hoursAgo(3),
  },
  {
    id: "demo-msg-3",
    agent: "mentor",
    body: "La pipeline e' sbilanciata verso posizioni remote senior. Suggerisco di tenere una corsia separata per opportunita' hybrid Milano con score 60-75.",
    kind: "notification",
    related_position_id: null,
    delivered_via: "web",
    delivered_at: hoursAgo(8),
    acknowledged_at: null,
    user_reply: null,
    user_reply_at: null,
    agent_seen_reply_at: null,
    created_at: hoursAgo(8),
  },
];

export function getDemoDashboardData() {
  return {
    stats,
    positions,
    scoreDistribution,
    sourceDistribution,
    pendingMessages,
  };
}
