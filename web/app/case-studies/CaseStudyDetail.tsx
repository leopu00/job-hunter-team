"use client";

// Dettaglio di un beta tester: profilo anonimo → match → dove → categorie →
// come ha lavorato. In cima uno switcher COLLASSABILE (non una sidebar fissa)
// per saltare a un altro case study.

import { useState } from "react";
import Link from "next/link";
import type { CaseStudyProfile } from "@/lib/case-studies";
import type { CaseStudyRun } from "@/lib/case-study";
import type { TeamActivity } from "@/lib/team-activity";
import CaseStudyOverview from "./CaseStudyOverview";
import ActivityCharts from "../(protected)/team/attivita/ActivityCharts";

export interface PreparedCase {
  id: string;
  label: string;
  tagline: string;
  profile: CaseStudyProfile;
  run: CaseStudyRun; // events alleggeriti
  activity: TeamActivity;
}

export interface CaseRef {
  id: string;
  label: string;
  tagline: string;
  badge: string;
}

const MONTHS_IT = [
  "gen",
  "feb",
  "mar",
  "apr",
  "mag",
  "giu",
  "lug",
  "ago",
  "set",
  "ott",
  "nov",
  "dic",
];
function dayLabel(key: string): string {
  const [, m, d] = key.split("-");
  return `${Number(d)} ${MONTHS_IT[Number(m) - 1] ?? ""}`.trim();
}
function nf(n: number): string {
  return n.toLocaleString("it-IT");
}

export default function CaseStudyDetail({
  current,
  all,
}: {
  current: PreparedCase;
  all: CaseRef[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { run, activity, profile } = current;

  const instances = activity.actors.filter((a) => a.total > 0).length;
  const activeDays = activity.roleDaily.filter((d) =>
    Object.values(d.counts).some((n) => n > 0),
  ).length;
  const fromKey = run.tsRange[0].slice(0, 10);
  const toKey = run.tsRange[1].slice(0, 10);

  const kpis = [
    {
      value: nf(run.totals.positions),
      label: "Posizioni trovate",
      accent: "var(--color-blue)",
    },
    {
      value: `${Math.round(run.match.avg)}/100`,
      label: "Match medio",
      accent: "#00e676",
    },
    {
      value: nf(run.match.strong70),
      label: "Match forti (≥70)",
      accent: "#00e676",
    },
    {
      value: nf(run.countries.length),
      label: "Paesi",
      accent: "var(--color-blue)",
    },
    {
      value: nf(run.cities.length),
      label: "Città",
      accent: "var(--color-blue)",
    },
    {
      value: nf(run.categories.length),
      label: "Categorie di ruolo",
      accent: "#b388ff",
    },
  ];

  return (
    <div className="space-y-12">
      {/* ── Toolbar: breadcrumb + switcher collassabile ───────── */}
      <div className="flex items-center justify-between gap-3">
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-2 text-[11px] min-w-0"
        >
          <Link
            href="/case-studies"
            className="text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            Case studies
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">
            /
          </span>
          <span className="text-[var(--color-muted)] truncate">
            {current.label}
          </span>
        </nav>

        <div className="relative shrink-0">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-muted)] hover:border-[var(--color-blue)] hover:text-[var(--color-white)] transition-colors"
          >
            ☰ Tutti i case study
            <span
              className="text-[8px]"
              style={{ transform: menuOpen ? "rotate(180deg)" : "none" }}
            >
              ▾
            </span>
          </button>
          {menuOpen && (
            <>
              {/* backdrop per chiudere */}
              <div
                className="fixed inset-0 z-40"
                onClick={() => setMenuOpen(false)}
                aria-hidden="true"
              />
              <div className="absolute right-0 mt-2 w-64 z-50 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-1.5 shadow-xl">
                {all.map((c) => {
                  const active = c.id === current.id;
                  return (
                    <Link
                      key={c.id}
                      href={`/case-studies/${c.id}`}
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 no-underline transition-colors hover:bg-[var(--color-bg)]"
                      style={{
                        background: active
                          ? "color-mix(in srgb, var(--color-blue) 12%, transparent)"
                          : undefined,
                      }}
                    >
                      <span
                        className="inline-flex items-center justify-center w-7 h-7 rounded-md text-[11px] font-bold shrink-0"
                        style={{
                          background: active
                            ? "var(--color-blue)"
                            : "var(--color-bg)",
                          color: active ? "#0a0a0a" : "var(--color-muted)",
                        }}
                      >
                        {c.badge}
                      </span>
                      <div className="min-w-0">
                        <div className="text-[12px] font-bold text-[var(--color-white)]">
                          {c.label}
                        </div>
                        <div className="text-[9px] text-[var(--color-dim)] truncate">
                          {c.tagline}
                        </div>
                      </div>
                    </Link>
                  );
                })}
                <div className="border-t border-[var(--color-border)] mt-1 pt-1">
                  <Link
                    href="/case-studies"
                    onClick={() => setMenuOpen(false)}
                    className="block rounded-lg px-2.5 py-2 text-[11px] text-[var(--color-dim)] hover:text-[var(--color-muted)] hover:bg-[var(--color-bg)] no-underline transition-colors"
                  >
                    ← Torna alla panoramica
                  </Link>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Profilo ───────────────────────────────────────────── */}
      <header>
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-2xl p-6">
          <div className="flex items-start gap-4">
            <span
              className="inline-flex items-center justify-center w-14 h-14 rounded-xl text-lg font-extrabold shrink-0"
              style={{
                background:
                  "color-mix(in srgb, var(--color-blue) 18%, transparent)",
                color: "var(--color-blue)",
              }}
            >
              {profile.badge}
            </span>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold tracking-[0.16em] uppercase text-[var(--color-dim)]">
                {current.label} · profilo anonimo
              </div>
              <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight leading-tight">
                {profile.headline}
              </h1>
              <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-muted)] max-w-2xl">
                {profile.summary}
              </p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 border-t border-[var(--color-border)] pt-5">
            {profile.facts.map((f) => (
              <div key={f.label}>
                <div className="text-[9px] uppercase tracking-wide text-[var(--color-dim)]">
                  {f.label}
                </div>
                <div className="text-[12px] text-[var(--color-white)] mt-0.5">
                  {f.value}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <div className="text-[9px] uppercase tracking-wide text-[var(--color-dim)] mb-2">
              Città target
            </div>
            <div className="flex flex-wrap gap-1.5">
              {profile.targetCities.map((city) => (
                <span
                  key={city}
                  className="text-[10px] rounded-full px-2.5 py-1 border border-[var(--color-border)] text-[var(--color-muted)]"
                >
                  {city}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-5 rounded-lg border-l-2 border-[#00e676] bg-[var(--color-bg)] px-4 py-3">
            <div
              className="text-[10px] font-semibold uppercase tracking-wide mb-1"
              style={{ color: "#00e676" }}
            >
              💡 Perché questi risultati
            </div>
            <p className="text-[12px] leading-relaxed text-[var(--color-muted)]">
              {profile.why}
            </p>
          </div>
        </div>

        <p className="mt-3 text-[11px] text-[var(--color-dim)] px-1">
          Run reale del team su questo profilo · finestra{" "}
          <strong>
            {dayLabel(fromKey)} → {dayLabel(toKey)}
          </strong>{" "}
          · {activeDays} giorni di lavoro · ogni dato è aggregato e anonimo.
        </p>

        <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {kpis.map((k) => (
            <div
              key={k.label}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-4"
            >
              <div
                className="text-[26px] leading-none font-extrabold tabular-nums"
                style={{ color: k.accent }}
              >
                {k.value}
              </div>
              <div className="mt-1.5 text-[10px] uppercase tracking-wide text-[var(--color-dim)] leading-tight">
                {k.label}
              </div>
            </div>
          ))}
        </div>
      </header>

      {/* ── Match · Dove · Categorie ──────────────────────────── */}
      <CaseStudyOverview run={run} />

      {/* ── Come ha lavorato (attività, trimmed) ──────────────── */}
      <section className="pt-10 border-t border-[var(--color-border)]">
        <div className="section-label mb-1">⚙️ Come ha lavorato il team</div>
        <p className="text-[11px] text-[var(--color-dim)] mb-6 max-w-2xl">
          Ogni singola istanza di agente (scout-1, analista-2, scorer-4…), in
          quali giorni e a che ora ha lavorato. {nf(activity.totalAll)} azioni
          registrate, {instances} istanze al lavoro.
        </p>
        <ActivityCharts
          activity={activity}
          showRecent={false}
          showLeaderboard={false}
          showDonut={false}
        />
      </section>
    </div>
  );
}
