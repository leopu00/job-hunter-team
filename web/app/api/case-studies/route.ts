// Public read-only API for the /case-studies page.
//
// Dev: reads from web/data/case-studies/case-studies.db (SQLite, gitignored).
// Prod: same shape, but later swapped to Supabase (same schema, see
// web/data/case-studies/schema.sql).
//
// Response shape is stable: { caseStudies: [...], coverage: [...] }.

import { NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { deriveFiveHourWindows, type BurnPoint } from "@/lib/five-hour-windows";

export const dynamic = "force-dynamic"; // never cache during dev iterations

// Defense-in-depth PII scrub on served free-text. The seed data is sanitized at
// the source (web/data/case-studies/*.sql), but this guard ensures the public
// API never serves raw URLs or email addresses even if an un-sanitized DB is
// loaded. Pattern-based ONLY — no real PII value is hardcoded here.
const URL_RE = /https?:\/\/[^\s"'<>)\]]+/gi;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
function scrubText<T extends string | null | undefined>(s: T): T {
  if (typeof s !== "string") return s;
  return s
    .replace(URL_RE, "[link removed]")
    .replace(EMAIL_RE, "[email removed]") as T;
}

type MetricRow = {
  case_study_id: number;
  metric_key: string;
  metric_label: string;
  value_num: number | null;
  value_text: string | null;
  unit: string | null;
  emoji: string | null;
  category: string;
  display_order: number;
  highlighted: number;
};

type NoteRow = {
  case_study_id: number;
  note_type: "worked" | "didnt_work" | "tweak" | "caveat";
  body_md: string;
  display_order: number;
};

type WindowRow = {
  id: number;
  case_study_id: number;
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
  burn_curve_json: string | null;
  display_order: number;
};

type BurnSampleRow = {
  case_study_window_id: number;
  ts: string;
  weekly_usage_pct: number;
  window_usage_pct: number | null;
  source: string | null;
};

type AgentActivityRow = {
  case_study_window_id: number;
  agent: string;
  ts_start: string;
  ts_end: string;
  reason: string | null;
};

type AgentTokensRow = {
  case_study_window_id: number;
  window_number: number;
  agent: string;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  events: number;
  sessions: number;
};

type CaseStudyRow = {
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
  started_at: string | null;
  ended_at: string | null;
  duration_hours: number | null;
  duration_label: string | null;
  status: string;
  source_md_anchor: string | null;
  published_at: string;
};

type CoverageRow = {
  cell_number: number;
  persona_label: string;
  provider_label: string;
  status: "done" | "open" | "in_progress";
  linked_case_study_id: number | null;
  display_order: number;
};

function dbPath(): string {
  // Resolve relative to the web app root (cwd at runtime is web/ during `next dev`).
  return path.join(process.cwd(), "data", "case-studies", "case-studies.db");
}

export async function GET() {
  const file = dbPath();

  if (!fs.existsSync(file)) {
    return NextResponse.json(
      {
        error: "case-studies.db not found",
        hint: "Run web/data/case-studies/init.sh to build the local DB",
        expectedPath: file,
      },
      { status: 500 },
    );
  }

  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const caseStudies = db
      .prepare(
        `SELECT id, slug, case_number, title, tester_handle, profile_summary,
                target_geography, target_industry,
                provider_name, provider_tier, subscription_cost_eur,
                host_kind, host_cost_eur_run,
                started_at, ended_at, duration_hours, duration_label,
                status, source_md_anchor, published_at
         FROM case_studies
         WHERE status = 'published'
         ORDER BY case_number ASC`,
      )
      .all() as CaseStudyRow[];

    const metrics = db
      .prepare(
        `SELECT case_study_id, metric_key, metric_label, value_num, value_text, unit, emoji,
                category, display_order, highlighted
         FROM case_study_metrics
         ORDER BY case_study_id ASC, category ASC, display_order ASC`,
      )
      .all() as MetricRow[];

    const notes = db
      .prepare(
        `SELECT case_study_id, note_type, body_md, display_order
         FROM case_study_notes
         ORDER BY case_study_id ASC, note_type ASC, display_order ASC`,
      )
      .all() as NoteRow[];

    const coverage = db
      .prepare(
        `SELECT cell_number, persona_label, provider_label, status,
                linked_case_study_id, display_order
         FROM coverage_matrix
         ORDER BY display_order ASC`,
      )
      .all() as CoverageRow[];

    const windows = db
      .prepare(
        `SELECT id, case_study_id, window_number, label, kind, parent_window_id,
                started_at, ended_at, duration_hours, peak_usage_pct,
                positions_found, ready_cvs, conversion_pct,
                notes_md, burn_curve_json, display_order
         FROM case_study_windows
         ORDER BY case_study_id ASC, display_order ASC`,
      )
      .all() as WindowRow[];

    const burnSamples = db
      .prepare(
        `SELECT case_study_window_id, ts, weekly_usage_pct, window_usage_pct, source
         FROM case_study_burn_samples
         ORDER BY case_study_window_id ASC, ts ASC`,
      )
      .all() as BurnSampleRow[];

    const agentActivity = db
      .prepare(
        `SELECT case_study_window_id, agent, ts_start, ts_end, reason
         FROM case_study_agent_activity
         ORDER BY case_study_window_id ASC, agent ASC, ts_start ASC`,
      )
      .all() as AgentActivityRow[];

    const agentTokens = db
      .prepare(
        `SELECT case_study_window_id, window_number, agent,
                input_tokens, cached_input_tokens, output_tokens,
                reasoning_output_tokens, events, sessions
         FROM case_study_agent_tokens
         ORDER BY case_study_window_id ASC, window_number ASC, input_tokens DESC`,
      )
      .all() as AgentTokensRow[];

    // Pivot children under their parent case-study for easier consumption client-side.
    const metricsByCs = new Map<number, MetricRow[]>();
    for (const m of metrics) {
      const arr = metricsByCs.get(m.case_study_id) ?? [];
      arr.push(m);
      metricsByCs.set(m.case_study_id, arr);
    }

    const notesByCs = new Map<number, NoteRow[]>();
    for (const n of notes) {
      const arr = notesByCs.get(n.case_study_id) ?? [];
      arr.push(n);
      notesByCs.set(n.case_study_id, arr);
    }

    const windowsByCs = new Map<number, WindowRow[]>();
    for (const w of windows) {
      const arr = windowsByCs.get(w.case_study_id) ?? [];
      arr.push(w);
      windowsByCs.set(w.case_study_id, arr);
    }

    const burnByWin = new Map<number, BurnSampleRow[]>();
    for (const s of burnSamples) {
      const arr = burnByWin.get(s.case_study_window_id) ?? [];
      arr.push(s);
      burnByWin.set(s.case_study_window_id, arr);
    }

    const activityByWin = new Map<number, AgentActivityRow[]>();
    for (const a of agentActivity) {
      const arr = activityByWin.get(a.case_study_window_id) ?? [];
      arr.push(a);
      activityByWin.set(a.case_study_window_id, arr);
    }

    const tokensByWin = new Map<number, AgentTokensRow[]>();
    for (const t of agentTokens) {
      const arr = tokensByWin.get(t.case_study_window_id) ?? [];
      arr.push(t);
      tokensByWin.set(t.case_study_window_id, arr);
    }

    const out = caseStudies.map((cs) => ({
      ...cs,
      profile_summary: scrubText(cs.profile_summary),
      highlighted: Boolean(cs as unknown as { highlighted?: number }),
      metrics: (metricsByCs.get(cs.id) ?? []).map((m) => ({
        ...m,
        value_text: scrubText(m.value_text),
        highlighted: Boolean(m.highlighted),
      })),
      notes: (notesByCs.get(cs.id) ?? []).map((n) => ({
        ...n,
        body_md: scrubText(n.body_md),
      })),
      windows: (windowsByCs.get(cs.id) ?? []).map((w) => {
        const burn = w.burn_curve_json
          ? (JSON.parse(w.burn_curve_json) as BurnPoint[])
          : null;
        const fiveHour =
          w.kind === "weekly" && burn && w.started_at && w.ended_at
            ? deriveFiveHourWindows(w.started_at, w.ended_at, burn)
            : null;
        return {
          ...w,
          notes_md: scrubText(w.notes_md),
          burn_curve: burn,
          five_hour_windows: fiveHour,
          burn_samples: burnByWin.get(w.id) ?? [],
          agent_activity: (activityByWin.get(w.id) ?? []).map((a) => ({
            ...a,
            reason: scrubText(a.reason),
          })),
          agent_tokens: tokensByWin.get(w.id) ?? [],
        };
      }),
    }));

    return NextResponse.json({
      caseStudies: out,
      coverage,
      meta: {
        generated_at: new Date().toISOString(),
        total_published: caseStudies.length,
        total_metrics: metrics.length,
        total_notes: notes.length,
        total_windows: windows.length,
        total_burn_samples: burnSamples.length,
        total_agent_activity: agentActivity.length,
        total_agent_tokens: agentTokens.length,
        total_coverage_cells: coverage.length,
        coverage_done: coverage.filter((c) => c.status === "done").length,
      },
    });
  } finally {
    db.close();
  }
}
