// Synthetic dashboard data for tests: invented titles and companies, no real
// positions or profiles (public repo).
import type { DashboardPosition, DashboardStats } from "../../lib/dashboard-data";
import type { DashboardData } from "./load-dashboard";

export function fixturePosition(i: number, over: Partial<DashboardPosition> = {}): DashboardPosition {
  const day = String(1 + (i % 28)).padStart(2, "0");
  return {
    id: `pos-${i}`,
    legacy_id: i,
    title: `Ruolo sintetico ${i}`,
    company: `Azienda ${String.fromCharCode(65 + (i % 26))}`,
    location: "Città di prova",
    remote_type: i % 2 ? "hybrid" : "full_remote",
    status: "scored",
    score: 50 + (i % 50),
    role_family: null,
    loc_country: "IT",
    loc_city: "Città di prova",
    source: "fixture",
    salary_min: null,
    salary_max: null,
    salary_currency: "EUR",
    found_at: `2026-09-${day}T08:00:00Z`,
    scored_at: `2026-09-${day}T09:00:00Z`,
    last_action_at: `2026-09-${day}T09:00:00Z`,
    last_action_by: "scorer",
    last_action_actor: "scorer",
    critic_score: null,
    critic_verdict: null,
    ...over,
  };
}

export const fixtureStats: DashboardStats = {
  total: 12,
  checked: 1,
  scored: 8,
  writing: 0,
  ready: 0,
  applied: 2,
  excluded: 1,
  response: 0,
  review: 0,
  new: 0,
  scored_open: 8,
  to_write: 0,
};

export function fixtureData(over: Partial<DashboardData> = {}): DashboardData {
  return {
    stats: fixtureStats,
    positions: Array.from({ length: 11 }, (_, i) => fixturePosition(i + 1)),
    rates: { EUR: 1, USD: 1.16, GBP: 0.86 },
    applicationEvents: [
      { appliedAt: "2026-09-20T10:00:00Z", response: null, responseAt: null },
      { appliedAt: "2026-09-22T10:00:00Z", response: "interview", responseAt: "2026-09-24T10:00:00Z" },
    ],
    ...over,
  };
}
