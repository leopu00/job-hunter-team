// Shared types + helpers for /case-studies UI components.
// Mirror the shape returned by GET /api/case-studies.

export type Metric = {
  metric_key: string;
  metric_label: string;
  value_num: number | null;
  value_text: string | null;
  unit: string | null;
  emoji: string | null;
  category: "metadata" | "pipeline" | "quality" | "economics" | "timing";
  display_order: number;
  highlighted: boolean;
};

export type Note = {
  note_type: "worked" | "didnt_work" | "tweak" | "caveat";
  body_md: string;
  display_order: number;
};

export type BurnCurvePoint = { t: string; w: number };

export type Window = {
  id: number;
  window_number: number;
  label: string;
  kind: "weekly" | "phase";
  parent_window_id: number | null;
  started_at: string | null;
  ended_at: string | null;
  duration_hours: number | null;
  peak_usage_pct: number | null;
  positions_found: number | null;
  ready_cvs: number | null;
  conversion_pct: number | null;
  notes_md: string | null;
  burn_curve: BurnCurvePoint[] | null;
  display_order: number;
};

export type CaseStudy = {
  id: number;
  slug: string;
  case_number: number;
  title: string;
  tester_handle: string;
  profile_summary: string;
  target_geography: string | null;
  target_industry: string | null;
  provider_name: string;
  provider_tier: string | null;
  subscription_cost_eur: number | null;
  host_kind: string | null;
  host_cost_eur_run: number | null;
  duration_label: string | null;
  metrics: Metric[];
  notes: Note[];
  windows: Window[];
};

export type CoverageCell = {
  cell_number: number;
  persona_label: string;
  provider_label: string;
  status: "done" | "open" | "in_progress";
  linked_case_study_id: number | null;
};

export type Payload = {
  caseStudies: CaseStudy[];
  coverage: CoverageCell[];
  meta: {
    generated_at: string;
    total_published: number;
    total_metrics: number;
    total_notes: number;
    total_windows: number;
    total_coverage_cells: number;
    coverage_done: number;
  };
};

// Brand colors: align with the existing web/components/Chart.tsx palette.
// `#00e87a` is the signature JHT mint-green accent.
export const PALETTE = {
  accent: "#00e87a", // JHT mint
  blue: "#60a5fa", // Codex tier
  purple: "#a78bfa", // Kimi tier
  amber: "#facc15", // Claude tier (case #1)
  pink: "#f472b6", // accent2
  orange: "#fb923c", // accent3
  slate900: "#0f172a",
  slate700: "#334155",
  slate500: "#64748b",
  slate300: "#cbd5e1",
  slate100: "#f1f5f9",
};

export function metric(cs: CaseStudy, key: string): Metric | undefined {
  return cs.metrics.find((m) => m.metric_key === key);
}

export function metricNum(cs: CaseStudy, key: string): number | null {
  return metric(cs, key)?.value_num ?? null;
}

export function metricText(cs: CaseStudy, key: string): string | null {
  const m = metric(cs, key);
  return m?.value_text ?? (m?.value_num != null ? String(m.value_num) : null);
}

// Per-case-study brand color based on the provider name.
export function providerColor(providerName: string): string {
  const n = providerName.toLowerCase();
  if (n.includes("kimi")) return PALETTE.purple;
  if (n.includes("codex")) return PALETTE.blue;
  if (n.includes("claude")) return PALETTE.amber;
  return PALETTE.accent;
}

export function fmtNumber(
  n: number | null | undefined,
  opts?: { unit?: string },
): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  let s: string;
  if (abs >= 1e9) s = `${(n / 1e9).toFixed(2)}B`;
  else if (abs >= 1e6) s = `${(n / 1e6).toFixed(1)}M`;
  else if (abs >= 1e3) s = `${(n / 1e3).toFixed(1)}k`;
  else s = n.toLocaleString("en-US");
  return opts?.unit ? `${s} ${opts.unit}` : s;
}
