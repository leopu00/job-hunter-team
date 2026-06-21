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
import WorkBudgetChart from "./WorkBudgetChart";
import ActivityCharts from "../(protected)/team/attivita/ActivityCharts";

export interface PreparedCase {
  id: string;
  label: string;
  tagline: string;
  subscription: { provider: string; plan: string; price: string };
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

  // Ruoli con attività (per il grafico unico lavoro+budget).
  const activeRoles = activity.roles.filter((r) => activity.roleTotals[r] > 0);

  // Orario di lavoro formattato (contesto sulla distribuzione del budget).
  const DOW: Record<string, string> = {
    mon: "lun", tue: "mar", wed: "mer", thu: "gio",
    fri: "ven", sat: "sab", sun: "dom",
  };
  const fmtDays = (days: string[]) => {
    const all = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const s = new Set(days);
    if (all.every((d) => s.has(d))) return "tutti i giorni";
    if (["mon", "tue", "wed", "thu", "fri"].every((d) => s.has(d)) &&
        !s.has("sat") && !s.has("sun")) return "lun–ven";
    return days.map((d) => DOW[d] ?? d).join(", ");
  };
  const wh = run.usage?.workingHours;
  const whText = wh
    ? wh.windows.map((w) => `${fmtDays(w.days)} · ${w.start}–${w.end}`).join(" / ") +
      (wh.timezone ? ` (${wh.timezone})` : "")
    : null;

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
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-2xl p-6 sm:p-8">
          {/* Riga alta: testo a sinistra (piena larghezza) + abbonamento a destra */}
          <div className="flex flex-col lg:flex-row lg:items-stretch gap-6">
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-semibold tracking-[0.16em] uppercase text-[var(--color-dim)]">
                {current.label} · profilo anonimo
              </div>
              <h1 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight leading-tight">
                {profile.headline}
              </h1>
              <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-muted)]">
                {profile.summary}
              </p>
            </div>

            {/* Abbonamento AI usato — l'unica spesa reale */}
            <div
              className="lg:w-64 shrink-0 rounded-xl px-4 py-4 flex flex-col justify-center"
              style={{
                border: "1px solid color-mix(in srgb, #00e676 40%, transparent)",
                background: "color-mix(in srgb, #00e676 8%, transparent)",
              }}
            >
              <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-wide text-[var(--color-dim)]">
                <span aria-hidden className="text-[14px]">
                  🧠
                </span>
                Abbonamento AI usato
              </div>
              <div className="mt-1.5 text-[15px] font-bold text-[var(--color-white)] leading-snug">
                {current.subscription.provider}
              </div>
              <div className="mt-0.5 text-[12px] text-[var(--color-muted)]">
                {current.subscription.plan} ·{" "}
                <span className="font-bold" style={{ color: "#00e676" }}>
                  {current.subscription.price}
                </span>
              </div>
              <div className="mt-2 text-[10px] text-[var(--color-dim)] leading-relaxed">
                È l&apos;unica spesa: la piattaforma è gratis.
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4 border-t border-[var(--color-border)] pt-6">
            {profile.facts.map((f) => (
              <div key={f.label}>
                <div className="text-[9px] uppercase tracking-wide text-[var(--color-dim)]">
                  {f.label}
                </div>
                <div className="text-[13px] font-semibold text-[var(--color-white)] mt-1">
                  {f.value}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 border-t border-[var(--color-border)] pt-6">
            <div className="text-[9px] uppercase tracking-wide text-[var(--color-dim)] mb-2">
              Dove cerca lavoro
            </div>
            <p className="text-[12px] text-[var(--color-muted)] leading-relaxed mb-3">
              {profile.locationNote}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {profile.targetCities.map((city) => (
                <span
                  key={city}
                  className="text-[11px] font-medium rounded-full px-2.5 py-1 border border-[var(--color-border)] text-[var(--color-muted)]"
                >
                  {city}
                </span>
              ))}
            </div>
          </div>
        </div>

        <p className="mt-3 text-[11px] text-[var(--color-dim)] px-1">
          Run reale del team su questo profilo · finestra{" "}
          <strong>
            {dayLabel(fromKey)} → {dayLabel(toKey)}
          </strong>{" "}
          · {activeDays} giorni di lavoro · ogni dato è aggregato e anonimo.
        </p>

      </header>

      {/* ── Match · Dove · Categorie ──────────────────────────── */}
      <CaseStudyOverview run={run} />

      {/* ── Lavoro e budget nel tempo (grafico unico, doppio asse) ── */}
      {run.usage && run.usage.daily.length > 0 && (
        <section>
          <div className="section-label mb-1">
            📈 Lavoro e budget AI nel tempo
          </div>
          <p className="text-[11px] text-[var(--color-dim)] mb-4">
            Le <strong className="text-[var(--color-muted)]">barre</strong> sono
            le azioni del team al giorno (per ruolo); le{" "}
            <strong className="text-[var(--color-muted)]">linee</strong> mostrano
            quanto del piano AI settimanale è stato consumato — quel giorno e
            cumulato sulla settimana (reset giovedì). Il budget si spalma sui
            giorni invece di bruciarsi subito.
          </p>
          <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-6">
            <WorkBudgetChart
              usage={run.usage}
              roleDaily={activity.roleDaily}
              roles={activeRoles}
              workingHoursText={whText}
            />
          </div>
        </section>
      )}

      {/* ── Come ha lavorato (attività, trimmed) ──────────────── */}
      <section className="pt-10 border-t border-[var(--color-border)]">
        <div className="section-label mb-1">⚙️ Come ha lavorato il team</div>
        <p className="text-[11px] text-[var(--color-dim)] mb-6">
          Ogni singola istanza di agente (scout-1, analista-2, scorer-4…), in
          quali giorni e a che ora ha lavorato. {nf(activity.totalAll)} azioni
          registrate, {instances} istanze al lavoro.
        </p>
        <ActivityCharts
          activity={activity}
          showRecent={false}
          showLeaderboard={false}
          showDonut={false}
          showVolume={false}
        />
      </section>
    </div>
  );
}
