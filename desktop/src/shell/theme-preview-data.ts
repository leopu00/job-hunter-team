import type { DashboardPosition, DashboardStats } from "../lib/dashboard-data";
import type { DashboardData } from "../pages/dashboard/load-dashboard";

/**
 * What the theme editor's preview draws: a small Dashboard with invented positions (families, countries and numbers
 * made up and round; no real company, role, person or count; the repository is public). Enough of every kind for each colour of a theme to show: several types for the chart's
 * colours, scores from low to high for the score's scale, a few applications for the timeline.
 */
const FAMILIES: Array<[string, number]> = [
  ["Frontend", 6],
  ["Backend", 4],
  ["Mobile", 4],
  ["Design", 2],
  ["QA", 2],
  ["DevOps", 2],
];
const COUNTRIES = ["FR", "ES", "PT", "AT"];

function position(index: number, family: string): DashboardPosition {
  const day = String(1 + (index % 27)).padStart(2, "0");
  return {
    id: `preview-${index}`,
    legacy_id: index,
    title: `${family} ${index}`,
    company: `Azienda ${String.fromCharCode(65 + (index % 26))}`,
    location: null,
    remote_type: index % 3 === 0 ? "full_remote" : "hybrid",
    status: "scored",
    score: 38 + ((index * 17) % 60),
    role_family: family,
    loc_country: COUNTRIES[index % COUNTRIES.length],
    loc_city: null,
    source: "preview",
    salary_min: 40000 + (index % 6) * 5000,
    salary_max: 52000 + (index % 6) * 5000,
    salary_currency: "EUR",
    found_at: `2026-10-${day}T08:00:00Z`,
    scored_at: `2026-10-${day}T09:00:00Z`,
    last_action_at: `2026-10-${day}T09:00:00Z`,
    last_action_by: "scorer",
    last_action_actor: "scorer",
    critic_score: null,
    critic_verdict: null,
  };
}

let counter = 0;
const positions = FAMILIES.flatMap(([family, count]) => Array.from({ length: count }, () => position(++counter, family)));

const stats: DashboardStats = {
  total: positions.length,
  checked: 2,
  scored: positions.length,
  writing: 2,
  ready: 2,
  applied: 4,
  excluded: 0,
  response: 2,
  review: 0,
  new: 4,
  scored_open: positions.length - 4,
  to_write: 2,
};

export const THEME_PREVIEW_DATA: DashboardData = {
  stats,
  positions,
  latest: [...positions].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 4),
  rates: { EUR: 1, USD: 1.1, GBP: 0.9 },
  applicationEvents: [
    { appliedAt: "2026-10-05T10:00:00Z", response: null, responseAt: null },
    { appliedAt: "2026-10-10T10:00:00Z", response: "interview", responseAt: "2026-10-15T10:00:00Z" },
    { appliedAt: "2026-10-20T10:00:00Z", response: "rejected", responseAt: "2026-10-25T10:00:00Z" },
    { appliedAt: "2026-10-25T10:00:00Z", response: null, responseAt: null },
  ],
};
