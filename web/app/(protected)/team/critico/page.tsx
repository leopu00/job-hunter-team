"use client";

import { scoreSpectrumCss } from "@/lib/score-color";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import AgentInteraction from "@/components/AgentInteraction";
import { useLocale } from "@/lib/use-locale";
import { useIsCloud } from "@/app/hooks/useIsCloud";
import { intlTag } from "@/lib/locale-tag";
import { makeT } from "@/lib/i18n-dict";
import { T } from "./page.i18n";

// ── Types ──────────────────────────────────────────────────────────
interface LiveStats {
  total: number;
  pending: number;
  pass: number;
  needsWork: number;
  reject: number;
  avgScore: number | null;
}

interface QueueItem {
  id: string;
  title: string;
  company: string;
  written_by: string | null;
  written_at: string | null;
}

interface FeedItem {
  id: string;
  title: string;
  company: string;
  critic_verdict: "PASS" | "NEEDS_WORK" | "REJECT" | null;
  critic_score: number | null;
  critic_round: number | null;
  critic_reviewed_at: string | null;
  reviewed_by: string | null;
  written_by: string | null;
}

interface AgentStat {
  critico: string;
  total: number;
  pass: number;
  needsWork: number;
  reject: number;
}

interface LiveData {
  stats: LiveStats;
  queue: QueueItem[];
  feed: FeedItem[];
  byAgent: AgentStat[];
}

// ── Helpers ────────────────────────────────────────────────────────
function fmtTs(ts: string | null, localeTag = "it-IT"): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(localeTag, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function verdictColor(v: string | null) {
  if (v === "PASS") return "var(--color-green)";
  if (v === "NEEDS_WORK") return "var(--color-yellow)";
  if (v === "REJECT") return "var(--color-red)";
  return "var(--color-dim)";
}

function verdictLabel(v: string | null) {
  if (v === "PASS") return "PASS";
  if (v === "NEEDS_WORK") return "NEEDS WORK";
  if (v === "REJECT") return "REJECT";
  return "—";
}

function scoreColor(s: number | null) {
  // Voto del Critico 0-10 → stessa scala spettro 0-100.
  return s == null ? "var(--color-dim)" : scoreSpectrumCss(s * 10);
}

// ── Sub-components ─────────────────────────────────────────────────
function StatCard({
  label,
  val,
  color,
  sub,
}: {
  label: string;
  val: string | number;
  color: string;
  sub?: string;
}) {
  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors">
      <div
        className="text-[9px] font-semibold tracking-[0.15em] uppercase mb-2"
        style={{ color: "var(--color-dim)" }}
      >
        {label}
      </div>
      <div
        className="text-3xl font-bold tracking-tight leading-none"
        style={{ color }}
      >
        {val}
      </div>
      {sub && (
        <div className="text-[10px] mt-1" style={{ color: "var(--color-dim)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: string | null }) {
  return (
    <span
      className="text-[9px] font-bold tracking-widest px-2 py-0.5 rounded"
      style={{
        color: verdictColor(verdict),
        background: verdictColor(verdict) + "18",
        border: `1px solid ${verdictColor(verdict)}40`,
      }}
    >
      {verdictLabel(verdict)}
    </span>
  );
}

// ── Page ───────────────────────────────────────────────────────────
export default function CriticoPage() {
  const locale = useLocale();
  const tr = makeT(T, locale);
  const localeTag = intlTag(locale);
  const [live, setLive] = useState<LiveData | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isCloud = useIsCloud();

  const fetchLive = useCallback(async () => {
    try {
      const res = await fetch("/api/critico", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: LiveData = await res.json();
      setLive(data);
      setLastUpdate(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : tr("fetchError"));
    }
  }, []);

  // Polling ogni 8s
  useEffect(() => {
    fetchLive();
    if (isCloud) return;
    const id = setInterval(fetchLive, 8_000);
    return () => clearInterval(id);
  }, [fetchLive, isCloud]);

  const stats = live?.stats;
  const queue = live?.queue ?? [];
  const feed = live?.feed ?? [];
  const byAgent = live?.byAgent ?? [];

  // Verdetto Critico: percentuali pass / needs_work / reject sui revisionati.
  const verdictTotal = stats ? stats.pass + stats.needsWork + stats.reject : 0;
  const verdictPassPct =
    verdictTotal > 0 ? Math.round((stats!.pass / verdictTotal) * 100) : 0;
  const verdictRejectPct =
    verdictTotal > 0 ? Math.round((stats!.reject / verdictTotal) * 100) : 0;
  const verdictNeedsPct = Math.max(0, 100 - verdictPassPct - verdictRejectPct);

  return (
    <div style={{ animation: "fade-in 0.35s ease both" }}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link
            href="/dashboard"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            {tr("dashboard")}
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">
            /
          </span>
          <Link
            href="/team"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            {tr("team")}
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">
            /
          </span>
          <span
            className="text-[10px] text-[var(--color-muted)]"
            aria-current="page"
          >
            {tr("critic")}
          </span>
        </nav>
        <div className="mt-3 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
              ⚖️ {tr("critic")}
            </h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">
              {tr("subtitle")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {lastUpdate && (
              <span className="text-[9px] text-[var(--color-dim)]">
                {tr("updatedAt")}
                {lastUpdate.toLocaleTimeString(localeTag, {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            )}
            <div
              className="w-2 h-2 rounded-full"
              style={{
                background: error
                  ? "var(--color-red)"
                  : live
                    ? "var(--color-green)"
                    : "var(--color-yellow)",
                boxShadow: error
                  ? "none"
                  : live
                    ? "0 0 6px var(--color-green)"
                    : "none",
              }}
            />
          </div>
        </div>
      </div>

      {error && (
        <div
          className="mb-6 px-4 py-3 rounded-lg text-[11px]"
          role="alert"
          style={{
            background: "var(--color-red)18",
            border: "1px solid var(--color-red)40",
            color: "var(--color-red)",
          }}
        >
          {tr("connError").replace("{e}", error)}
        </div>
      )}

      {/* ── Stats bar real-time ───────────────────────────────────── */}
      <div
        className="section-label mb-4"
        style={{ animation: "fade-in 0.35s ease both" }}
      >
        {tr("statsRealtime")}
      </div>
      <div
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-10"
        style={{ animation: "fade-in 0.35s ease both" }}
      >
        <StatCard
          label={tr("totalReviews")}
          val={stats?.total ?? "—"}
          color="var(--color-orange)"
        />
        <StatCard
          label={tr("inQueue")}
          val={stats?.pending ?? "—"}
          color="#58a6ff"
        />
        <StatCard
          label="PASS"
          val={stats?.pass ?? "—"}
          color="var(--color-green)"
        />
        <StatCard
          label={tr("needsWork")}
          val={stats?.needsWork ?? "—"}
          color="var(--color-yellow)"
        />
        <StatCard
          label={tr("reject")}
          val={stats?.reject ?? "—"}
          color="var(--color-red)"
        />
        <StatCard
          label={tr("avgScore")}
          val={stats?.avgScore != null ? stats.avgScore : "—"}
          color="var(--color-cyan)"
          sub={stats?.avgScore != null ? "/10" : undefined}
        />
      </div>

      {/* ── Verdetto Critico: PASS / NEEDS_WORK / REJECT su revisionati ── */}
      <div
        className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 mb-10 transition-colors duration-200 hover:border-[var(--color-border-glow)]"
        style={{ animation: "fade-in 0.35s ease 0.03s both" }}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="section-label">{tr("verdictBreakdown")}</span>
          <span className="text-[10px] text-[var(--color-dim)]">
            {verdictTotal} {tr("reviewedLc")}
          </span>
        </div>
        <div className="flex items-baseline gap-3 mb-3">
          <span
            className="text-3xl font-bold tracking-tight"
            style={{ color: "var(--color-green)" }}
          >
            {verdictPassPct}%
          </span>
          <span className="text-[10px] text-[var(--color-muted)]">
            pass · {verdictRejectPct}% reject · {verdictNeedsPct}%{" "}
            {tr("needsWork")}
          </span>
        </div>
        <div
          className="h-2 rounded-full overflow-hidden flex"
          style={{ background: "var(--color-border)" }}
        >
          <div
            style={{
              width: `${verdictPassPct}%`,
              background: "var(--color-green)",
              opacity: 0.85,
            }}
          />
          <div
            style={{
              width: `${verdictNeedsPct}%`,
              background: "var(--color-yellow)",
              opacity: 0.85,
            }}
          />
          <div
            style={{
              width: `${verdictRejectPct}%`,
              background: "var(--color-red)",
              opacity: 0.85,
            }}
          />
        </div>
        <div className="flex justify-between text-[9px] text-[var(--color-dim)] mt-1">
          <span style={{ color: "var(--color-green)" }}>
            pass · {stats?.pass ?? 0}
          </span>
          <span style={{ color: "var(--color-yellow)" }}>
            {tr("needsWork")} · {stats?.needsWork ?? 0}
          </span>
          <span style={{ color: "var(--color-red)" }}>
            reject · {stats?.reject ?? 0}
          </span>
        </div>
      </div>

      {/* ── Coda review in attesa ─────────────────────────────────── */}
      <div
        className="flex items-center justify-between mb-4"
        style={{ animation: "fade-in 0.35s ease 0.05s both" }}
      >
        <div className="section-label">{tr("reviewQueue")}</div>
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded"
          style={{
            background: "#58a6ff18",
            color: "#58a6ff",
            border: "1px solid #58a6ff40",
          }}
        >
          {tr("inQueueCount").replace("{n}", String(queue.length))}
        </span>
      </div>

      {!live ? (
        <div
          className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-6 text-center text-[var(--color-dim)] text-[11px] mb-10"
          role="status"
          aria-live="polite"
        >
          {tr("loading")}
        </div>
      ) : queue.length === 0 ? (
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-6 text-center text-[var(--color-dim)] text-[11px] mb-10">
          {tr("queueEmpty")}
        </div>
      ) : (
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg overflow-hidden mb-10">
          <table
            className="w-full border-collapse"
            aria-label={tr("cvQueueAria")}
          >
            <thead>
              <tr style={{ borderBottom: "2px solid var(--color-border)" }}>
                {[
                  "#",
                  tr("colPosition"),
                  tr("colCompany"),
                  tr("colWriter"),
                  tr("colWrittenAt"),
                ].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="text-left px-4 py-3 text-[9px] font-semibold tracking-widest uppercase"
                    style={{ color: "var(--color-dim)" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {queue.map((item, i) => (
                <tr
                  key={item.id}
                  className="transition-colors hover:bg-[rgba(255,255,255,0.015)]"
                  style={{
                    borderBottom:
                      i < queue.length - 1
                        ? "1px solid var(--color-border)"
                        : "none",
                  }}
                >
                  <td
                    className="px-4 py-3 text-[11px] font-mono"
                    style={{ color: "var(--color-dim)" }}
                  >
                    {i + 1}
                  </td>
                  <td
                    className="px-4 py-3 text-[12px] font-medium text-[var(--color-white)]"
                    title={item.title}
                    style={{
                      maxWidth: 200,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.title}
                  </td>
                  <td
                    className="px-4 py-3 text-[11px]"
                    style={{ color: "var(--color-muted)" }}
                  >
                    {item.company}
                  </td>
                  <td
                    className="px-4 py-3 text-[11px] font-mono"
                    style={{ color: "var(--color-cyan)" }}
                  >
                    {item.written_by ?? "—"}
                  </td>
                  <td
                    className="px-4 py-3 text-[11px]"
                    style={{ color: "var(--color-dim)" }}
                  >
                    {fmtTs(item.written_at, localeTag)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Feed ultime 10 revisioni ──────────────────────────────── */}
      <div
        className="flex items-center justify-between mb-4"
        style={{ animation: "fade-in 0.35s ease 0.1s both" }}
      >
        <div className="section-label">{tr("latestReviews")}</div>
        <span className="text-[9px]" style={{ color: "var(--color-dim)" }}>
          {tr("lastVerdicts").replace("{n}", String(feed.length))}
        </span>
      </div>

      {!live ? (
        <div
          className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-6 text-center text-[var(--color-dim)] text-[11px] mb-10"
          role="status"
          aria-live="polite"
        >
          {tr("loading")}
        </div>
      ) : feed.length === 0 ? (
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-6 text-center text-[var(--color-dim)] text-[11px] mb-10">
          {tr("noReviews")}
        </div>
      ) : (
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg overflow-hidden mb-10">
          <table
            className="w-full border-collapse"
            aria-label={tr("completedReviewsAria")}
          >
            <thead>
              <tr style={{ borderBottom: "2px solid var(--color-border)" }}>
                {[
                  tr("colPosition"),
                  tr("colCompany"),
                  tr("colVerdict"),
                  tr("colScore"),
                  tr("colRound"),
                  tr("colReviewer"),
                  tr("colReviewDate"),
                ].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="text-left px-4 py-3 text-[9px] font-semibold tracking-widest uppercase"
                    style={{ color: "var(--color-dim)" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {feed.map((item, i) => (
                <tr
                  key={item.id}
                  className="transition-colors hover:bg-[rgba(255,255,255,0.015)]"
                  style={{
                    borderBottom:
                      i < feed.length - 1
                        ? "1px solid var(--color-border)"
                        : "none",
                  }}
                >
                  <td
                    className="px-4 py-3 text-[12px] font-medium text-[var(--color-white)]"
                    title={item.title}
                    style={{
                      maxWidth: 180,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.title}
                  </td>
                  <td
                    className="px-4 py-3 text-[11px]"
                    style={{ color: "var(--color-muted)" }}
                  >
                    {item.company}
                  </td>
                  <td className="px-4 py-3">
                    <VerdictBadge verdict={item.critic_verdict} />
                  </td>
                  <td
                    className="px-4 py-3 text-[14px] font-bold font-mono"
                    style={{ color: scoreColor(item.critic_score) }}
                  >
                    {item.critic_score != null ? item.critic_score : "—"}
                  </td>
                  <td
                    className="px-4 py-3 text-[11px] font-mono text-center"
                    style={{ color: "var(--color-dim)" }}
                  >
                    {item.critic_round != null ? `R${item.critic_round}` : "—"}
                  </td>
                  <td
                    className="px-4 py-3 text-[11px] font-mono"
                    style={{ color: "var(--color-cyan)" }}
                  >
                    {item.reviewed_by ?? "—"}
                  </td>
                  <td
                    className="px-4 py-3 text-[11px]"
                    style={{ color: "var(--color-dim)", whiteSpace: "nowrap" }}
                  >
                    {fmtTs(item.critic_reviewed_at, localeTag)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Stats per agente ──────────────────────────────────────── */}
      {byAgent.length > 0 && (
        <div style={{ animation: "fade-in 0.35s ease 0.15s both" }}>
          <div className="section-label mb-4">{tr("activityPerCritic")}</div>
          <div className="space-y-4">
            {byAgent.map((s, i) => {
              const colors = [
                "var(--color-orange)",
                "var(--color-red)",
                "var(--color-yellow)",
              ];
              const color = colors[i % colors.length];
              const pctPass =
                s.total > 0 ? ((s.pass / s.total) * 100).toFixed(1) : "0";
              return (
                <div
                  key={s.critico}
                  className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 hover:border-[var(--color-border-glow)] transition-colors"
                  style={{ animation: `fade-in 0.4s ease ${i * 0.08}s both` }}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <span className="text-[13px] font-bold" style={{ color }}>
                        {s.critico}
                      </span>
                      <span className="text-[10px] text-[var(--color-dim)] ml-2">
                        {tr("reviewsCount").replace("{n}", String(s.total))}
                      </span>
                    </div>
                    <div className="text-[10px] text-[var(--color-dim)]">
                      {tr("pctPass").replace("{pct}", pctPass)}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                    {[
                      {
                        key: "PASS",
                        label: "PASS",
                        val: s.pass,
                        c: "var(--color-green)",
                      },
                      {
                        key: "needsWork",
                        label: tr("needsWork"),
                        val: s.needsWork,
                        c: "var(--color-yellow)",
                      },
                      {
                        key: "reject",
                        label: tr("reject"),
                        val: s.reject,
                        c: "var(--color-red)",
                      },
                    ].map(({ key, label, val, c }) => (
                      <div key={key} className="text-center">
                        <div
                          className="text-[9px] font-semibold tracking-widest uppercase mb-1"
                          style={{ color: c }}
                        >
                          {label}
                        </div>
                        <div
                          className="text-2xl font-bold"
                          style={{ color: c }}
                        >
                          {val}
                        </div>
                        {s.total > 0 && (
                          <div className="text-[10px] text-[var(--color-dim)] mt-0.5">
                            {((val / s.total) * 100).toFixed(0)}%
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {/* Stacked bar */}
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-[var(--color-dim)] w-14 text-right shrink-0">
                      {tr("verdict")}
                    </span>
                    <div
                      className="flex-1 h-1.5 rounded-full overflow-hidden flex"
                      style={{ background: "var(--color-border)" }}
                    >
                      {s.total > 0 && (
                        <>
                          <div
                            style={{
                              width: `${(s.pass / s.total) * 100}%`,
                              background: "var(--color-green)",
                              opacity: 0.85,
                            }}
                          />
                          <div
                            style={{
                              width: `${(s.needsWork / s.total) * 100}%`,
                              background: "var(--color-yellow)",
                              opacity: 0.85,
                            }}
                          />
                          <div
                            style={{
                              width: `${(s.reject / s.total) * 100}%`,
                              background: "var(--color-red)",
                              opacity: 0.85,
                            }}
                          />
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <AgentInteraction
        sessionPrefix="CRITICO"
        color="#f44336"
        label={tr("criticLabel")}
      />
    </div>
  );
}
