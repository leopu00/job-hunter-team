// Public read-only API for the /case-studies page.
//
// Dev: reads from web/data/case-studies/case-studies.db (SQLite, gitignored).
// Prod: same shape, but later swapped to Supabase (same schema, see
// web/data/case-studies/schema.sql).
//
// Response shape is stable: { caseStudies: [...], coverage: [...] }.

import { NextResponse } from "next/server"
import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import fs from "node:fs"

export const dynamic = "force-dynamic" // never cache during dev iterations

type MetricRow = {
  case_study_id: number
  metric_key: string
  metric_label: string
  value_num: number | null
  value_text: string | null
  unit: string | null
  emoji: string | null
  category: string
  display_order: number
  highlighted: number
}

type NoteRow = {
  case_study_id: number
  note_type: "worked" | "didnt_work" | "tweak" | "caveat"
  body_md: string
  display_order: number
}

type WindowRow = {
  id: number
  case_study_id: number
  window_number: number
  label: string
  kind: "weekly" | "phase"
  parent_window_id: number | null
  started_at: string | null
  ended_at: string | null
  duration_hours: number | null
  peak_usage_pct: number | null
  positions_found: number | null
  ready_cvs: number | null
  conversion_pct: number | null
  notes_md: string | null
  burn_curve_json: string | null
  display_order: number
}

type CaseStudyRow = {
  id: number
  slug: string
  case_number: number
  title: string
  tester_handle: string
  profile_summary: string
  target_geography: string | null
  target_industry: string | null
  provider_name: string
  provider_tier: string | null
  subscription_cost_eur: number | null
  host_kind: string | null
  host_cost_eur_run: number | null
  started_at: string | null
  ended_at: string | null
  duration_hours: number | null
  duration_label: string | null
  status: string
  source_md_anchor: string | null
  published_at: string
}

type CoverageRow = {
  cell_number: number
  persona_label: string
  provider_label: string
  status: "done" | "open" | "in_progress"
  linked_case_study_id: number | null
  display_order: number
}

function dbPath(): string {
  // Resolve relative to the web app root (cwd at runtime is web/ during `next dev`).
  return path.join(process.cwd(), "data", "case-studies", "case-studies.db")
}

export async function GET() {
  const file = dbPath()

  if (!fs.existsSync(file)) {
    return NextResponse.json(
      {
        error: "case-studies.db not found",
        hint: "Run web/data/case-studies/init.sh to build the local DB",
        expectedPath: file,
      },
      { status: 500 },
    )
  }

  const db = new DatabaseSync(file, { readOnly: true })
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
      .all() as CaseStudyRow[]

    const metrics = db
      .prepare(
        `SELECT case_study_id, metric_key, metric_label, value_num, value_text, unit, emoji,
                category, display_order, highlighted
         FROM case_study_metrics
         ORDER BY case_study_id ASC, category ASC, display_order ASC`,
      )
      .all() as MetricRow[]

    const notes = db
      .prepare(
        `SELECT case_study_id, note_type, body_md, display_order
         FROM case_study_notes
         ORDER BY case_study_id ASC, note_type ASC, display_order ASC`,
      )
      .all() as NoteRow[]

    const coverage = db
      .prepare(
        `SELECT cell_number, persona_label, provider_label, status,
                linked_case_study_id, display_order
         FROM coverage_matrix
         ORDER BY display_order ASC`,
      )
      .all() as CoverageRow[]

    const windows = db
      .prepare(
        `SELECT id, case_study_id, window_number, label, kind, parent_window_id,
                started_at, ended_at, duration_hours, peak_usage_pct,
                positions_found, ready_cvs, conversion_pct,
                notes_md, burn_curve_json, display_order
         FROM case_study_windows
         ORDER BY case_study_id ASC, display_order ASC`,
      )
      .all() as WindowRow[]

    // Pivot children under their parent case-study for easier consumption client-side.
    const metricsByCs = new Map<number, MetricRow[]>()
    for (const m of metrics) {
      const arr = metricsByCs.get(m.case_study_id) ?? []
      arr.push(m)
      metricsByCs.set(m.case_study_id, arr)
    }

    const notesByCs = new Map<number, NoteRow[]>()
    for (const n of notes) {
      const arr = notesByCs.get(n.case_study_id) ?? []
      arr.push(n)
      notesByCs.set(n.case_study_id, arr)
    }

    const windowsByCs = new Map<number, WindowRow[]>()
    for (const w of windows) {
      const arr = windowsByCs.get(w.case_study_id) ?? []
      arr.push(w)
      windowsByCs.set(w.case_study_id, arr)
    }

    const out = caseStudies.map((cs) => ({
      ...cs,
      highlighted: Boolean(cs as unknown as { highlighted?: number }),
      metrics: (metricsByCs.get(cs.id) ?? []).map((m) => ({
        ...m,
        highlighted: Boolean(m.highlighted),
      })),
      notes: notesByCs.get(cs.id) ?? [],
      windows: (windowsByCs.get(cs.id) ?? []).map((w) => ({
        ...w,
        burn_curve: w.burn_curve_json
          ? (JSON.parse(w.burn_curve_json) as Array<{ t: string; w: number }>)
          : null,
      })),
    }))

    return NextResponse.json({
      caseStudies: out,
      coverage,
      meta: {
        generated_at: new Date().toISOString(),
        total_published: caseStudies.length,
        total_metrics: metrics.length,
        total_notes: notes.length,
        total_windows: windows.length,
        total_coverage_cells: coverage.length,
        coverage_done: coverage.filter((c) => c.status === "done").length,
      },
    })
  } finally {
    db.close()
  }
}
