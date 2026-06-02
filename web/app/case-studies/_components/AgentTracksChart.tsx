"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { FiveHourWindow, AgentActivity } from "./types";
import { useChartTheme, chartPalette } from "./chart-theme";

type Props = {
  fiveHourWindow: FiveHourWindow;
  activity: AgentActivity[];
};

const AGENT_PALETTE: Record<string, string> = {
  "analista-1": "#facc15",
  "analista-2": "#fbbf24",
  "scout-1": "#f97316",
  "scout-2": "#fb923c",
  "scorer-1": "#22c55e",
  "scorer-2": "#16a34a",
  "scrittore-1": "#3b82f6",
  "scrittore-2": "#3b82f6",
  "scrittore-3": "#3b82f6",
  "critico-s1": "#a78bfa",
  "critico-s2": "#a78bfa",
  "critico-s3": "#a78bfa",
  capitano: "#ef4444",
  mentor: "#ec4899",
  assistente: "#06b6d4",
  sentinella: "#14b8a6",
  dottore: "#0ea5e9",
};

const ROLE_EMOJI: Record<string, string> = {
  analista: "👨‍🔬",
  scout: "🕵️",
  scorer: "👨‍💻",
  scrittore: "👨‍🏫",
  critico: "👨‍⚖️",
  capitano: "👨‍✈️",
  sentinella: "💂",
  assistente: "👨‍💼",
  mentor: "🧙",
  dottore: "👨‍⚕️",
};

const HIDDEN_AGENTS = new Set(["assistente"]);
// critico is intentionally absent: it gets grouped with scrittore so
// scrittore-N is followed by critico-sN.
const ROLE_ORDER = [
  "capitano",
  "sentinella",
  "scout",
  "analista",
  "scorer",
  "scrittore",
  "dottore",
];

const ACTION_TABLE: Array<{ test: RegExp; icon: string; label: string }> = [
  { test: /^📥/, icon: "📥", label: "trovata" },
  { test: /^✅/, icon: "✅", label: "validata" },
  { test: /^🚫/, icon: "🚫", label: "scartata" },
  { test: /^⭐/, icon: "⭐", label: "score" },
  { test: /^✍️/, icon: "✍️", label: "scrittura" },
  { test: /^📄/, icon: "📄", label: "pronta" },
  { test: /^📡/, icon: "📡", label: "tick" },
  { test: /^📬/, icon: "📬", label: "ricevuto" },
  { test: /^💤/, icon: "💤", label: "throttle" },
  { test: /\[INFO/i, icon: "💬", label: "info" },
  { test: /\[ACK/i, icon: "📨", label: "ack" },
  { test: /\[MSG/i, icon: "✉️", label: "msg" },
  { test: /\[REQ|\[ASK/i, icon: "❓", label: "richiesta" },
  { test: /\[RES/i, icon: "📩", label: "review" },
  { test: /\[ALERT|\[FAILURE|\[WARNING/i, icon: "⚠️", label: "alert" },
  { test: /\[BRIEF/i, icon: "📋", label: "brief" },
  { test: /\[URG/i, icon: "🔥", label: "urgente" },
  { test: /\[HEALTH/i, icon: "🩺", label: "health" },
];

function baseRole(agent: string): string {
  return agent.replace(/-(?:s)?\d+$/, "");
}
function agentSuffix(agent: string): number {
  const m = agent.match(/-(?:s)?(\d+)$/);
  return m ? Number(m[1]) : 0;
}
function emojiFor(agent: string): string {
  return ROLE_EMOJI[baseRole(agent)] ?? "🤖";
}
function compareAgents(a: string, b: string): number {
  // critico-sN is treated as a "child" of scrittore-N: same primary role slot,
  // but placed just after the scrittore with the same suffix.
  const baseA = baseRole(a);
  const baseB = baseRole(b);
  const groupA = baseA === "critico" ? "scrittore" : baseA;
  const groupB = baseB === "critico" ? "scrittore" : baseB;
  const ra = ROLE_ORDER.indexOf(groupA);
  const rb = ROLE_ORDER.indexOf(groupB);
  const ia = ra < 0 ? ROLE_ORDER.length : ra;
  const ib = rb < 0 ? ROLE_ORDER.length : rb;
  if (ia !== ib) return ia - ib;
  // Within the scrittore/critico group: order by suffix N, then critico after
  // scrittore of same N. Multiply suffix by 2 and add 1 for critico.
  const sa = agentSuffix(a) * 2 + (baseA === "critico" ? 1 : 0);
  const sb = agentSuffix(b) * 2 + (baseB === "critico" ? 1 : 0);
  return sa - sb;
}
function classifyAction(reason: string | null | undefined): {
  icon: string;
  label: string;
} {
  if (!reason) return { icon: "•", label: "evento" };
  for (const a of ACTION_TABLE)
    if (a.test.test(reason)) return { icon: a.icon, label: a.label };
  return { icon: "•", label: "evento" };
}

type ParsedReason = {
  icon: string;
  from?: string;
  to?: string;
  type?: string;
  body: string;
};

const KNOWN_TYPES = new Set([
  "MSG",
  "ACK",
  "INFO",
  "REQ",
  "ASK",
  "RES",
  "BRIEF",
  "URG",
  "TICK",
  "HEALTH",
  "CHECKPOINT",
  "ALERT",
  "FAILURE",
  "WARNING",
]);

function humanizeSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r === 0 ? `${m}min` : `${m}min ${r}s`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

// Replace standalone "Xs" tokens (where X is a positive integer ≥ 60) with a
// human-readable duration. Short durations (under a minute) stay in seconds.
function prettifyDurations(text: string): string {
  return text.replace(/\b(\d+)s\b/g, (orig, n) => {
    const v = parseInt(n, 10);
    return v >= 60 ? humanizeSeconds(v) : orig;
  });
}

function cleanBody(s: string): string {
  const cleaned = s
    .replace(/\[[^\]]+\]/g, "")
    .replace(/@\S+\s*(?:→|->)\s*@\S+/g, "")
    .replace(/^\s*·\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  return prettifyDurations(cleaned);
}

// Pulls out structured pieces from any reason string. Strips all [TAG] noise
// from the body so the displayed text is always clean.
function parseReason(reason: string | null): ParsedReason {
  if (!reason) return { icon: "•", body: "—" };

  const lead = reason.match(/^(\S+)\s*([\s\S]*)$/);
  const icon = lead ? lead[1] : "•";
  const rest = lead ? lead[2] : reason;

  // Reception event: "📬 ricevuto [TYPE] da agent · body"
  const recv = rest.match(
    /^ricevuto\s*\[([^\]]+)\]\s*da\s*(\S+)\s*·?\s*([\s\S]*)$/,
  );
  if (recv) {
    return {
      icon: "📬",
      from: recv[2],
      type: recv[1].toUpperCase(),
      body: cleanBody(recv[3]),
    };
  }

  const ft = rest.match(/@(\S+?)\s*(?:→|->)\s*@(\S+?)(?=\]|\s|$)/);
  const from = ft?.[1];
  const to = ft?.[2];

  let type: string | undefined;
  for (const m of rest.matchAll(/\[([A-Z][A-Z_-]+)\]/g)) {
    const t = m[1].toUpperCase();
    if (KNOWN_TYPES.has(t)) {
      type = t;
      break;
    }
  }

  return { icon, from, to, type, body: cleanBody(rest) };
}

const TZ = "Europe/Rome";
const CLOCK_FMT = new Intl.DateTimeFormat("it-IT", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: TZ,
});
const CLOCK_SEC_FMT = new Intl.DateTimeFormat("it-IT", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: TZ,
});
const DAY_FMT = new Intl.DateTimeFormat("it-IT", {
  day: "numeric",
  month: "short",
  timeZone: TZ,
});

function fmtClock(ts: number): string {
  return CLOCK_FMT.format(new Date(ts));
}
function fmtClockSec(ts: number): string {
  return CLOCK_SEC_FMT.format(new Date(ts));
}
function fmtDay(ts: number): string {
  return DAY_FMT.format(new Date(ts));
}

const LEGEND_ACTIONS = [
  { icon: "📥", label: "trovata" },
  { icon: "✅", label: "validata" },
  { icon: "🚫", label: "scartata" },
  { icon: "⭐", label: "score" },
  { icon: "✍️", label: "scrittura" },
  { icon: "📄", label: "CV pronto" },
  { icon: "💬", label: "info / msg" },
  { icon: "📩", label: "review critico" },
  { icon: "📬", label: "richiesta ricevuta" },
  { icon: "💤", label: "sleep / throttle" },
];

type ClusterEvent = { ts: number; reason: string | null };
type Cluster = {
  start: number;
  end: number;
  count: number;
  icon: string;
  actionLabel: string;
  events: ClusterEvent[];
  mixed: boolean;
  allReceived: boolean;
};

function isReceivedEvent(reason: string | null | undefined): boolean {
  return !!reason && reason.trimStart().startsWith("📬");
}

// Walk through already-clustered intervals and fuse any two whose rendered
// rectangles would visually overlap (i.e. previous block end_x + min width >
// next block start_x). Prevents the "boxes on top of each other" effect when
// many clusters fall in a small zoom range.
function mergeOverlappingClusters(
  clusters: Cluster[],
  xOf: (ts: number) => number,
  minWidthPx: number,
): Cluster[] {
  if (clusters.length <= 1) return clusters;
  const out: Cluster[] = [];
  for (const c of clusters) {
    const last = out[out.length - 1];
    if (!last) {
      out.push({ ...c, events: [...c.events] });
      continue;
    }
    const lastStartX = xOf(last.start);
    const lastEndX = Math.max(xOf(last.end), lastStartX + minWidthPx);
    const curStartX = xOf(c.start);
    if (curStartX < lastEndX) {
      last.end = Math.max(last.end, c.end);
      last.count += c.count;
      last.events.push(...c.events);
      if (last.icon !== c.icon || last.actionLabel !== c.actionLabel) {
        last.mixed = true;
      }
      if (last.allReceived && !c.allReceived) last.allReceived = false;
    } else {
      out.push({ ...c, events: [...c.events] });
    }
  }
  return out;
}

function clusterByAction(ivs: AgentActivity[], gapMs: number): Cluster[] {
  if (ivs.length === 0) return [];
  const sorted = ivs
    .slice()
    .sort((a, b) => a.ts_start.localeCompare(b.ts_start));
  const out: Cluster[] = [];
  for (const iv of sorted) {
    const { icon, label } = classifyAction(iv.reason);
    const s = new Date(iv.ts_start).getTime();
    const e = new Date(iv.ts_end).getTime();
    const received = isReceivedEvent(iv.reason);
    const last = out[out.length - 1];
    // Fuse on gap alone — when events are visually packed (small gapMs at low
    // zoom) all neighbouring events merge into one block regardless of type.
    // Keep sent vs received separate so the visual styling can differ.
    if (last && s - last.end <= gapMs && last.allReceived === received) {
      last.end = Math.max(last.end, e);
      last.count += 1;
      last.events.push({ ts: s, reason: iv.reason });
      if (last.icon !== icon || last.actionLabel !== label) {
        last.mixed = true;
      }
    } else {
      out.push({
        start: s,
        end: e,
        count: 1,
        icon,
        actionLabel: label,
        events: [{ ts: s, reason: iv.reason }],
        mixed: false,
        allReceived: received,
      });
    }
  }
  return out;
}

type SelectedSingle = {
  kind: "single";
  agent: string;
  ts: number;
  reason: string | null;
  icon: string;
  actionLabel: string;
};
type SelectedList = {
  kind: "list";
  agent: string;
  start: number;
  end: number;
  icon: string;
  actionLabel: string;
  events: ClusterEvent[];
};
type Selected = SelectedSingle | SelectedList;

function FormattedReason({
  reason,
  currentAgent,
}: {
  reason: string | null;
  currentAgent?: string;
}) {
  const { mode } = useChartTheme();
  const P = chartPalette(mode);
  const p = parseReason(reason);
  // Reception events have a `from` but no `to`. Derive `to` from the track
  // owner so the rendering is identical to sent messages.
  const effectiveTo =
    p.to ?? (p.from && currentAgent ? currentAgent : undefined);
  if (p.from && effectiveTo) {
    return (
      <div className="space-y-1">
        <div className="flex flex-wrap items-baseline gap-1.5">
          <span>{emojiFor(p.from)}</span>
          <span
            className="font-mono font-semibold"
            style={{ color: P.popupText }}
          >
            {p.from}
          </span>
          <span style={{ color: P.popupSubText }}>→</span>
          <span>{emojiFor(effectiveTo)}</span>
          <span
            className="font-mono font-semibold"
            style={{ color: P.popupText }}
          >
            {effectiveTo}
          </span>
          {p.type && (
            <span className="text-[11px]" style={{ color: P.popupSubText }}>
              · {p.type.toLowerCase()}
            </span>
          )}
        </div>
        {p.body && (
          <p className="leading-relaxed" style={{ color: P.popupBodyText }}>
            {p.body}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-baseline gap-1.5">
      <span>{p.icon}</span>
      <span style={{ color: P.popupBodyText }}>{p.body}</span>
    </div>
  );
}

export function AgentTracksChart({ fiveHourWindow: fhw, activity }: Props) {
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { mode } = useChartTheme();
  const P = chartPalette(mode);

  const start = new Date(fhw.started_at).getTime();
  const end = new Date(fhw.ended_at).getTime();

  const agents = useMemo(() => {
    const set = new Set<string>();
    for (const a of activity) {
      if (!HIDDEN_AGENTS.has(baseRole(a.agent))) set.add(a.agent);
    }
    // For every scrittore-N visible in this window, make sure critico-sN is
    // also rendered (empty track if no activity). It's the natural pairing
    // and missing critic rows are confusing.
    for (const a of Array.from(set)) {
      if (baseRole(a) === "scrittore") {
        const n = agentSuffix(a);
        if (n > 0) set.add(`critico-s${n}`);
      }
    }
    return Array.from(set).sort(compareAgents);
  }, [activity]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const trackH = 38;
  const trackGap = 6;
  const padT = 28;
  const padB = 24;
  const baseInner = 1100;
  const innerW = baseInner * zoom;
  const tracksH = agents.length * (trackH + trackGap);
  const svgH = padT + tracksH + padB;

  const xOf = (ts: number) =>
    ((Math.max(start, Math.min(end, ts)) - start) / Math.max(1, end - start)) *
    innerW;

  // ── Time axis with "nice" major + minor ticks, density grows with zoom ──
  const NICE_SEC = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  const totalSec = (end - start) / 1000;
  const pxPerSec = innerW / Math.max(1, totalSec);
  const TARGET_MAJOR_PX = 110;
  let majorSec = NICE_SEC[NICE_SEC.length - 1];
  for (const n of NICE_SEC) {
    if (n * pxPerSec >= TARGET_MAJOR_PX) {
      majorSec = n;
      break;
    }
  }
  // Minor: aim for ~14px spacing, snap to nice scale, but cap total minor count
  const MINOR_TARGET_PX = 14;
  const MINOR_MAX = 800;
  let minorSec = NICE_SEC[0];
  for (const n of NICE_SEC) {
    if (n * pxPerSec >= MINOR_TARGET_PX) {
      minorSec = n;
      break;
    }
  }
  while (totalSec / minorSec > MINOR_MAX) {
    const idx = NICE_SEC.indexOf(minorSec);
    if (idx < NICE_SEC.length - 1) minorSec = NICE_SEC[idx + 1];
    else break;
  }
  if (minorSec >= majorSec)
    minorSec = NICE_SEC[Math.max(0, NICE_SEC.indexOf(majorSec) - 1)];

  const majorTicks: number[] = [];
  const minorTicks: number[] = [];
  const startMs = Math.floor(start);
  const endMs = Math.ceil(end);
  const firstMajor = Math.ceil(startMs / (majorSec * 1000)) * (majorSec * 1000);
  for (let t = firstMajor; t <= endMs; t += majorSec * 1000) majorTicks.push(t);
  const firstMinor = Math.ceil(startMs / (minorSec * 1000)) * (minorSec * 1000);
  for (let t = firstMinor; t <= endMs; t += minorSec * 1000) {
    if (Math.round(t / 1000) % majorSec !== 0) minorTicks.push(t);
  }

  // Use the major-second granularity for the label format
  const showSeconds = majorSec < 60;
  const labelFmt = showSeconds ? CLOCK_SEC_FMT : CLOCK_FMT;
  const ticks = majorTicks;

  // Zoom-aware clustering: at low zoom many events fuse into one bar; as the
  // user zooms in, the same events naturally split into separate bars because
  // the gap in milliseconds maps to more pixels. We treat 8 visible pixels as
  // the "same cluster" threshold.
  const CLUSTER_GAP_PX = 22;
  const pxPerMs = innerW / Math.max(1, end - start);
  const CLUSTER_GAP_MS = Math.max(500, CLUSTER_GAP_PX / pxPerMs);
  // Minimum pixels-per-event below which we suppress the individual click lines
  // and let the user click the cluster background instead.
  const LINE_MIN_PX = 12;
  // Visual minimum width of a fused block — same value used during rendering.
  // After clustering we collapse any clusters whose rectangles would overlap.
  const FUSED_MIN_PX = 22;
  const tracksByAgent = useMemo(() => {
    const map = new Map<
      string,
      { sleeps: AgentActivity[]; clusters: Cluster[] }
    >();
    for (const ag of agents) {
      const all = activity.filter((a) => a.agent === ag);
      const sleeps = all.filter((a) => (a.reason ?? "").startsWith("💤"));
      const work = all.filter((a) => !(a.reason ?? "").startsWith("💤"));
      let clusters = clusterByAction(work, CLUSTER_GAP_MS);
      clusters = mergeOverlappingClusters(
        clusters,
        (ts) => xOf(ts),
        FUSED_MIN_PX,
      );
      map.set(ag, { sleeps, clusters });
    }
    return map;
  }, [agents, activity, CLUSTER_GAP_MS, FUSED_MIN_PX, pxPerMs]);

  return (
    <figure
      className="relative rounded-md border"
      style={{
        borderColor: P.figBorder,
        backgroundColor: P.figBg,
        color: P.figText,
      }}
    >
      <header
        className="flex flex-wrap items-baseline justify-between gap-3 border-b px-4 py-3"
        style={{ borderColor: P.headerBorder }}
      >
        <div>
          <h6 className="text-sm font-semibold" style={{ color: P.figText }}>
            Finestra {fhw.window_number} · {fmtClock(start)} → {fmtClock(end)} ·{" "}
            {fmtDay(start)}
          </h6>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] uppercase tracking-wide"
            style={{ color: P.ctrlText }}
          >
            zoom
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(1, z - 1))}
            className="rounded px-2 py-0.5 text-xs transition-colors"
            style={{ backgroundColor: P.ctrlBg, color: P.figText }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = P.ctrlBgHover)
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = P.ctrlBg)
            }
          >
            −
          </button>
          <input
            type="range"
            min={1}
            max={20}
            step={1}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="h-1 w-32 cursor-pointer"
          />
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(20, z + 1))}
            className="rounded px-2 py-0.5 text-xs transition-colors"
            style={{ backgroundColor: P.ctrlBg, color: P.figText }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = P.ctrlBgHover)
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = P.ctrlBg)
            }
          >
            +
          </button>
          <span
            className="w-9 text-right font-mono text-xs"
            style={{ color: P.ctrlText }}
          >
            {zoom}x
          </span>
        </div>
      </header>

      <div className="grid" style={{ gridTemplateColumns: "220px 1fr" }}>
        <div
          className="border-r"
          style={{ borderColor: P.colBorder, backgroundColor: P.colBg }}
        >
          <div
            className="flex items-center gap-2 border-b px-3 text-[10px] uppercase tracking-wide"
            style={{
              height: padT,
              borderColor: P.rowBorder,
              color: P.colHeaderText,
            }}
          >
            <span>agente</span>
          </div>
          {agents.map((ag, idx) => {
            const isLast = idx === agents.length - 1;
            return (
              <div
                key={ag}
                className="flex items-center justify-start gap-2 whitespace-nowrap px-3"
                style={{
                  height: trackH + trackGap,
                  borderBottom: isLast ? undefined : `1px solid ${P.rowBorder}`,
                }}
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: AGENT_PALETTE[ag] ?? "#64748b" }}
                />
                <span className="text-[13px]">{emojiFor(ag)}</span>
                <span
                  className="font-mono text-[13px]"
                  style={{ color: P.agentName }}
                >
                  {ag}
                </span>
              </div>
            );
          })}
          <div style={{ height: padB }} />
        </div>

        <div className="overflow-x-auto overflow-y-hidden">
          <svg
            width={innerW}
            height={svgH}
            viewBox={`0 0 ${innerW} ${svgH}`}
            style={{ display: "block", minWidth: innerW }}
          >
            {ticks.map((tk, i) => (
              <g key={`xt-${i}`}>
                <line
                  x1={xOf(tk)}
                  x2={xOf(tk)}
                  y1={padT}
                  y2={padT + tracksH}
                  stroke={P.gridLine}
                  strokeWidth="0.5"
                />
                <text
                  x={xOf(tk)}
                  y={padT - 8}
                  fontSize="10"
                  textAnchor="middle"
                  fill={P.topAxisText}
                >
                  {labelFmt.format(new Date(tk))}
                </text>
              </g>
            ))}

            {agents.map((ag, i) => {
              const y = padT + i * (trackH + trackGap);
              const color = AGENT_PALETTE[ag] ?? "#64748b";
              const t = tracksByAgent.get(ag) ?? { sleeps: [], clusters: [] };
              return (
                <g key={ag}>
                  <rect
                    x={0}
                    y={y}
                    width={innerW}
                    height={trackH}
                    fill={i % 2 === 0 ? P.bandA : P.bandB}
                  />
                  {/* Sleep / throttle bands — drawn first so they sit behind events */}
                  {t.sleeps.map((sl, j) => {
                    const a = new Date(sl.ts_start).getTime();
                    const b = new Date(sl.ts_end).getTime();
                    const x1 = xOf(a);
                    const w = Math.max(2, xOf(b) - x1);
                    return (
                      <g
                        key={`sl-${j}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected({
                            kind: "single",
                            agent: ag,
                            ts: a,
                            reason: sl.reason,
                            icon: "💤",
                            actionLabel: "throttle / sleep",
                          });
                        }}
                        style={{ cursor: "pointer" }}
                      >
                        <rect
                          x={x1}
                          y={y + trackH - 8}
                          width={w}
                          height={6}
                          fill={P.sleepFill}
                          fillOpacity={P.sleepOpacity}
                          rx="1"
                        />
                      </g>
                    );
                  })}
                  {t.clusters.map((cl, k) => {
                    const x1 = xOf(cl.start);
                    const natW = xOf(cl.end) - x1;
                    const visualW = Math.max(10, natW);
                    const linesVisible =
                      visualW / Math.max(1, cl.count) >= LINE_MIN_PX;
                    // When events are too packed to render as separate lines,
                    // collapse them into a single solid block. The block width is
                    // capped at the cluster bbox + a minimum so it never disappears.
                    const fusedW = Math.max(22, visualW);
                    const onClickCluster = (e: React.MouseEvent) => {
                      e.stopPropagation();
                      if (cl.count === 1) {
                        const ev = cl.events[0];
                        setSelected({
                          kind: "single",
                          agent: ag,
                          ts: ev.ts,
                          reason: ev.reason,
                          icon: cl.icon,
                          actionLabel: cl.actionLabel,
                        });
                      } else {
                        setSelected({
                          kind: "list",
                          agent: ag,
                          start: cl.start,
                          end: cl.end,
                          icon: cl.icon,
                          actionLabel: cl.actionLabel,
                          events: cl.events,
                        });
                      }
                    };
                    return (
                      <g key={k}>
                        {/* Fused block (only when individual lines cannot fit) */}
                        {!linesVisible && (
                          <rect
                            x={x1}
                            y={y + 4}
                            width={fusedW}
                            height={trackH - 8}
                            fill={color}
                            fillOpacity={0.92}
                            rx="3"
                            style={{ cursor: "pointer" }}
                            onClick={onClickCluster}
                          />
                        )}
                        {/* Click-target lines: only render when there is enough
                            pixel room per event. Otherwise the cluster shadow
                            itself is the only click target (= shows the list). */}
                        {(linesVisible
                          ? (() => {
                              const MIN_GAP = 8;
                              let lastX = -Infinity;
                              const positions = cl.events.map((ev) => {
                                const nat = xOf(ev.ts);
                                const x = Math.max(nat, lastX + MIN_GAP);
                                lastX = x;
                                return x;
                              });
                              const bboxR = xOf(cl.end) + 8;
                              const span =
                                positions[positions.length - 1] - positions[0];
                              if (
                                positions[positions.length - 1] > bboxR &&
                                span < bboxR - xOf(cl.start)
                              ) {
                                const shift =
                                  bboxR - positions[positions.length - 1];
                                for (let i = 0; i < positions.length; i++)
                                  positions[i] += shift;
                              }
                              return positions;
                            })()
                          : []
                        ).map((lx, j) => {
                          const ev = cl.events[j];
                          const isSelected =
                            selected != null &&
                            selected.kind === "single" &&
                            selected.agent === ag &&
                            Math.abs(selected.ts - ev.ts) < 500;
                          return (
                            <g
                              key={j}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelected({
                                  kind: "single",
                                  agent: ag,
                                  ts: ev.ts,
                                  reason: ev.reason,
                                  icon: cl.icon,
                                  actionLabel: cl.actionLabel,
                                });
                              }}
                              style={{ cursor: "pointer" }}
                            >
                              {/* invisible 12px wide hit area */}
                              <rect
                                x={lx - 6}
                                y={y + 2}
                                width={12}
                                height={trackH - 4}
                                fill="transparent"
                              />
                              <line
                                x1={lx}
                                x2={lx}
                                y1={y + 4}
                                y2={y + trackH - 4}
                                stroke={color}
                                strokeWidth={isSelected ? 5 : 3.5}
                                strokeLinecap="round"
                              />
                              {isSelected && (
                                <circle
                                  cx={lx}
                                  cy={y + trackH / 2}
                                  r={6}
                                  fill={P.selectedHalo}
                                  stroke={color}
                                  strokeWidth="2"
                                />
                              )}
                            </g>
                          );
                        })}
                      </g>
                    );
                  })}
                </g>
              );
            })}

            {/* Bottom axis baseline */}
            <line
              x1={0}
              x2={innerW}
              y1={padT + tracksH}
              y2={padT + tracksH}
              stroke={P.baseline}
              strokeWidth="0.5"
            />
            {/* Minor ticks: small notches without label */}
            {minorTicks.map((tk, i) => (
              <line
                key={`mn-${i}`}
                x1={xOf(tk)}
                x2={xOf(tk)}
                y1={padT + tracksH}
                y2={padT + tracksH + 3}
                stroke={P.minorTick}
                strokeWidth="0.5"
              />
            ))}
            {/* Major ticks: longer line + label */}
            {majorTicks.map((tk, i) => (
              <g key={`mj-${i}`}>
                <line
                  x1={xOf(tk)}
                  x2={xOf(tk)}
                  y1={padT + tracksH}
                  y2={padT + tracksH + 6}
                  stroke={P.majorTick}
                  strokeWidth="0.6"
                />
                <text
                  x={xOf(tk)}
                  y={padT + tracksH + 16}
                  fontSize="10"
                  textAnchor="middle"
                  fill={P.bottomAxisText}
                >
                  {labelFmt.format(new Date(tk))}
                </text>
              </g>
            ))}
          </svg>
        </div>
      </div>

      {mounted && selected
        ? createPortal(
            <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4">
              <div
                className="absolute inset-0"
                onClick={() => setSelected(null)}
                aria-hidden
              />
              <div
                className="relative max-h-[90vh] w-full max-w-xl overflow-hidden rounded-lg border text-sm shadow-2xl"
                style={{
                  borderColor: P.popupBorder,
                  backgroundColor: P.popupBg,
                  color: P.popupText,
                }}
              >
                {selected.kind === "single" ? (
                  <div className="p-4">
                    <div
                      className="mb-2 flex items-baseline gap-2 border-b pb-2"
                      style={{ borderColor: P.popupHeaderBorder }}
                    >
                      <span className="text-lg">
                        {emojiFor(selected.agent)}
                      </span>
                      <span className="font-mono font-semibold">
                        {selected.agent}
                      </span>
                      <span
                        className="text-[12px]"
                        style={{ color: P.popupSubText }}
                      >
                        {fmtClockSec(selected.ts)} · {fmtDay(selected.ts)}
                      </span>
                    </div>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-base">{selected.icon}</span>
                      <span
                        className="font-semibold"
                        style={{ color: P.popupText }}
                      >
                        {selected.actionLabel}
                      </span>
                    </div>
                    {selected.reason && (
                      <div
                        className="rounded px-3 py-2 text-[12px] leading-relaxed"
                        style={{
                          backgroundColor: P.popupBodyBg,
                          color: P.popupBodyText,
                        }}
                      >
                        <FormattedReason
                          reason={selected.reason}
                          currentAgent={selected.agent}
                        />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelected(null)}
                      className="mt-3 w-full rounded px-3 py-1.5 text-xs font-medium transition-colors"
                      style={{
                        backgroundColor: P.popupCloseBg,
                        color: P.popupText,
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor =
                          P.popupCloseBgHover)
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor = P.popupCloseBg)
                      }
                    >
                      chiudi (Esc)
                    </button>
                  </div>
                ) : (
                  <div className="flex max-h-[90vh] flex-col">
                    <div
                      className="border-b px-4 py-3"
                      style={{ borderColor: P.popupHeaderBorder }}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="text-lg">
                          {emojiFor(selected.agent)}
                        </span>
                        <span className="font-mono font-semibold">
                          {selected.agent}
                        </span>
                        <span
                          className="text-[12px]"
                          style={{ color: P.popupSubText }}
                        >
                          {fmtClockSec(selected.start)} →{" "}
                          {fmtClockSec(selected.end)}
                        </span>
                      </div>
                      <div
                        className="mt-1 flex items-center gap-2"
                        style={{ color: P.popupBodyText }}
                      >
                        <span className="text-base">{selected.icon}</span>
                        <span className="font-semibold">
                          {selected.actionLabel}
                        </span>
                        <span
                          className="text-[11px]"
                          style={{ color: P.popupSubText }}
                        >
                          · {selected.events.length} eventi nel cluster
                        </span>
                      </div>
                    </div>
                    <ul className="flex-1 space-y-2 overflow-y-auto px-4 py-3 text-[11.5px]">
                      {selected.events.map((ev, i) => {
                        const isLast = i === selected.events.length - 1;
                        return (
                          <li
                            key={i}
                            className="flex gap-3 pb-2"
                            style={{
                              borderBottom: isLast
                                ? undefined
                                : `1px solid ${P.popupHeaderBorder}`,
                            }}
                          >
                            <span
                              className="w-16 shrink-0 font-mono"
                              style={{ color: P.popupSubText }}
                            >
                              {fmtClockSec(ev.ts)}
                            </span>
                            <div className="flex-1">
                              <FormattedReason
                                reason={ev.reason}
                                currentAgent={selected.agent}
                              />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    <button
                      type="button"
                      onClick={() => setSelected(null)}
                      className="border-t px-4 py-2 text-xs font-medium transition-colors"
                      style={{
                        borderColor: P.popupHeaderBorder,
                        backgroundColor: P.popupCloseTop,
                        color: P.popupText,
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor =
                          P.popupCloseBgHover)
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor =
                          P.popupCloseTop)
                      }
                    >
                      chiudi (Esc)
                    </button>
                  </div>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </figure>
  );
}
