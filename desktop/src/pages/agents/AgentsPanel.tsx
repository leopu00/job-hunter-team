import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { describeAgentState, type AgentState, type AgentStateTone } from "@/lib/agent-state";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import { formatRelative } from "@/lib/message-display";
import { pluralText } from "../../lib/plural";
import { requestTeamStop } from "./team-stop";
import { useExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import {
  controlAgent,
  pauseTeam,
  readPanelList,
  readPanelScreen,
  readTeamState,
  resumeTeam,
  tomorrowAtEightUtc,
  type ActionResult,
  type AgentAction,
  type Outcome,
  type PanelList,
  type PauseExit,
  type TeamControlState,
} from "../../lib/agent-control";
import type { AgentIdentity, TeamAgent } from "../../lib/existing-team-agents";
import OwnVpsClaim from "../../components/OwnVpsClaim";
import { useRefresh } from "../../shell/router";
import type { PageProps } from "../types";
import { AGENTS_PANEL_TEXT, type AgentsPanelText } from "./AgentsPanel.i18n";
import { UsageLine, UsageShort } from "./AgentUsage";
import { QuestionList, QuestionMarks, questionsSummary } from "./AgentQuestions";

// The chat with the three agents the person talks to is its own component,
// mounted here when it exists in the build (it is optional, as the office's
// parts are: a missing module is no failed build).
type ChatRole = "capitano" | "assistente" | "mentor";
const chatModules = import.meta.glob<{ AgentChatPane?: ComponentType<{ role: ChatRole }> }>(
  "../messages/AgentChatPane.tsx",
  { eager: true },
);
const AgentChatPane = Object.values(chatModules)[0]?.AgentChatPane ?? null;
const CHAT_ROLES = new Set<string>(["capitano", "assistente", "mentor"]);

/** The terminal of the agent in view is read again this often, only while it is open. */
export const SCREEN_REFRESH_MS = 10_000;
/** A terminal that changed this recently says the agent is doing something (the second source). */
const MOVING_MS = 30_000;

const TONE: Record<AgentStateTone, string> = {
  green: "var(--color-green)",
  neutral: "var(--color-muted)",
  amber: "var(--color-yellow)",
  blue: "var(--color-blue)",
  red: "var(--color-red)",
  grey: "var(--color-dim)",
};

/** Who needs the person first, then who works, then the idle, then the off ones. */
const RANK: Record<AgentState, number> = {
  aspetta_umano: 0,
  bloccato: 1,
  avviato_mai_partito: 2,
  lavora: 3,
  idle: 4,
  sconosciuto: 5,
  spento: 6,
};

const SINGLE = new Set(["CAPITANO", "CRITICO", "SENTINELLA", "ASSISTENTE", "MENTOR", "DOTTORE", "MANTENITORE"]);
const SCHEDULED = new Set(["DOTTORE", "MANTENITORE"]);
const REVIEWER = /^CRITICO-S[1-9][0-9]{0,3}$/;

export type PanelRow = {
  session: string;
  role: string;
  agent: TeamAgent | null;
  heldByUser: boolean;
  heldBySafety: boolean;
};

function displayName(session: string): string {
  return session.charAt(0) + session.slice(1).toLowerCase();
}

/**
 * The rows of the list: every session that is up, every session held off,
 * and for a role with neither its first session, off. Sorted by attention.
 */
export function panelRows(list: PanelList, team: TeamControlState | null): PanelRow[] {
  const held = new Map((team?.held ?? []).map((item) => [item.session, item.byUser]));
  const rows = new Map<string, PanelRow>();
  for (const agent of list.agents) {
    rows.set(agent.name, {
      session: agent.name,
      role: agent.role,
      agent,
      heldByUser: held.get(agent.name) === true,
      heldBySafety: held.get(agent.name) === false,
    });
  }
  for (const [session, byUser] of held) {
    if (rows.has(session)) continue;
    const role = session.split("-")[0].toLowerCase();
    rows.set(session, { session, role, agent: null, heldByUser: byUser, heldBySafety: !byUser });
  }
  for (const { role } of list.roles) {
    if ([...rows.values()].some((row) => row.role === role)) continue;
    const prefix = role.toUpperCase();
    const session = SINGLE.has(prefix) ? prefix : `${prefix}-1`;
    rows.set(session, { session, role, agent: null, heldByUser: false, heldBySafety: false });
  }
  const order = list.roles.map((role) => role.role);
  const rank = (row: PanelRow) => (row.agent ? RANK[row.agent.state.state] : 7);
  return [...rows.values()].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      order.indexOf(a.role) - order.indexOf(b.role) ||
      a.session.localeCompare(b.session, "en", { numeric: true }),
  );
}

/** What the panel may do on a row; nothing in the read-only view. */
export function rowActions(row: PanelRow, readOnly: boolean): AgentAction[] {
  if (readOnly || SCHEDULED.has(row.session)) return [];
  if (REVIEWER.test(row.session)) return row.agent ? ["stop"] : [];
  if (!row.agent) return row.heldBySafety ? [] : ["start"];
  if (row.heldBySafety) return ["stop"];
  return ["restart", "stop"];
}

type Notice = { ok: boolean; text: string };
type Pending =
  | { kind: "agent"; op: AgentAction; row: PanelRow }
  | { kind: "pause" }
  | { kind: "stop-team" }
  | { kind: "resume" };

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}

/** The full date and time, for a tooltip. */
function fullStamp(at: number): string {
  return new Date(at).toLocaleString(appLocale(), { dateStyle: "short", timeStyle: "medium" });
}

/** Today: the time alone; another day: a short date and the time. The full one goes in the tooltip. */
function stamp(at: number, now = Date.now()): string {
  const d = new Date(at);
  const sameDay = d.toDateString() === new Date(now).toDateString();
  return sameDay
    ? d.toLocaleTimeString(appLocale(), { timeStyle: "medium" })
    : d.toLocaleString(appLocale(), { dateStyle: "short", timeStyle: "short" });
}

/** How long ago, short («2m fa»), as the rest of the app says it. */
function ago(seconds: number | null): string {
  return seconds === null ? "—" : formatRelative(new Date(seconds * 1000).toISOString(), appLocale());
}

function clock(seconds: number | null): string {
  return seconds === null ? "—" : stamp(seconds * 1000);
}

function failureText(code: string): string {
  const copy = describeError(code, { fallback: "agents_unavailable", locale: appLocale() });
  return `${copy.text} ${copy.action} (${code})`;
}

function resultText(t: AgentsPanelText, result: ActionResult, name: string): string {
  const key = {
    started: t.resultStarted,
    already_running: t.resultAlreadyRunning,
    stopped: t.resultStopped,
    already_stopped: t.resultAlreadyStopped,
    restarted: t.resultRestarted,
    paused: t.resultPaused,
    already_paused: t.resultAlreadyPaused,
    resumed: t.resultResumed,
    not_paused: t.resultNotPaused,
  }[result];
  return fill(key, { name });
}

/**
 * Whether the row's agent runs. A listed agent whose state says "spento" (no
 * tmux session: it ended between the list and the state's read) is off, as a
 * row with no session: same word, same led, not counted among the ones up.
 */
export function isUp(row: PanelRow): boolean {
  return row.agent !== null && row.agent.state.state !== "spento";
}

function Led({ row }: { row: PanelRow }) {
  const tone = isUp(row) ? describeAgentState(row.agent!.state, appLocale()).tone : "grey";
  return (
    <span
      aria-hidden
      className="inline-block w-2 h-2 rounded-full shrink-0"
      style={{ background: isUp(row) ? TONE[tone] : "var(--color-border)" }}
    />
  );
}

const CLI_NAME: Record<AgentIdentity["cli"], string> = { claude: "Claude", codex: "Codex", kimi: "Kimi", pi: "pi", local: "" };

/**
 * Who the agent is: «Codex · gpt-5.6-terra · effort alto · su questo computer».
 * Only shown, never decided on (the agent can rewrite its session's options).
 * A part the session does not say is «non so»; Kimi gets no model nor effort
 * from the launcher (its own default), the local scorer neither.
 */
export function identityLine(t: AgentsPanelText, identity: AgentIdentity | null, where: string): string {
  if (!identity) return t.identityUnknown;
  const effortName = { low: t.effortLow, medium: t.effortMedium, high: t.effortHigh };
  const parts: string[] = [identity.cli === "local" ? t.identityLocal : CLI_NAME[identity.cli]];
  if (identity.cli !== "local") {
    parts.push(identity.model ?? (identity.cli === "kimi" ? t.identityModelDefault : t.identityModelUnknown));
    if (identity.cli !== "kimi") parts.push(identity.effort ? fill(t.identityEffort, { effort: effortName[identity.effort] }) : t.identityEffortUnknown);
  }
  if (where) parts.push(where);
  return parts.join(" · ");
}

function stateLine(t: AgentsPanelText, row: PanelRow): string {
  if (row.heldBySafety) return t.heldBySafety;
  if (!row.agent || !isUp(row)) return row.heldByUser ? t.heldByUser : t.down;
  return describeAgentState(row.agent.state, appLocale()).line;
}

/** The terminal of the agent in view: read when shown, then again while it stays shown. */
function Terminal({ row, t }: { row: PanelRow; t: AgentsPanelText }) {
  const [screen, setScreen] = useState<Outcome<{ up: boolean; text: string | null }> | null>(null);
  const session = row.session;
  useEffect(() => {
    let live = true;
    setScreen(null);
    const read = () =>
      readPanelScreen(session).then((result) => {
        if (live) setScreen(result);
      });
    void read();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void read();
    }, SCREEN_REFRESH_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [session]);
  if (screen === null) return <p className="text-[11px] text-[var(--color-muted)]">{t.screenReading}</p>;
  if (!screen.ok)
    return (
      <p role="alert" className="text-[11px] text-[var(--color-red)]">
        {failureText(screen.code)}
      </p>
    );
  if (!screen.value.up) return <p className="text-[11px] text-[var(--color-muted)]">{t.screenDown}</p>;
  return (
    <>
      <p className="text-[11px] mb-1 text-[var(--color-muted)]">{fill(t.screenAt, { time: stamp(screen.at) })}</p>
      {/* Text only: React escapes it, nothing in it is ever HTML. */}
      <pre
        data-testid={`panel-terminal-${session}`}
        className="text-[11px] leading-snug whitespace-pre-wrap break-words max-h-[55vh] overflow-auto rounded p-2"
        style={{ background: "var(--color-deep)", color: "var(--color-bright)" }}
      >
        {screen.value.text === "" ? t.screenEmpty : screen.value.text}
      </pre>
    </>
  );
}

function Confirm({
  t,
  pending,
  where,
  busy,
  onCancel,
  onConfirm,
}: {
  t: AgentsPanelText;
  pending: Pending;
  where: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (exit?: PauseExit) => void;
}) {
  const [exit, setExit] = useState<"h1" | "h4" | "tomorrow" | "weekly">("h4");
  let title: string;
  let body: string[];
  let danger = false;
  if (pending.kind === "agent") {
    const name = displayName(pending.row.session);
    title = fill({ start: t.confirmStart, stop: t.confirmStop, restart: t.confirmRestart }[pending.op], { name, where });
    body = [fill({ start: t.bodyStart, stop: t.bodyStop, restart: t.bodyRestart }[pending.op], { name })];
    if (pending.op === "stop" && pending.row.session === "CAPITANO") body.push(t.bodyStopCaptain);
    if (pending.op === "stop" && pending.row.session === "ASSISTENTE") body.push(t.bodyStopAssistant);
    danger = pending.op !== "start";
  } else if (pending.kind === "pause") {
    title = fill(t.confirmPause, { where });
    body = [t.bodyPause];
  } else if (pending.kind === "stop-team") {
    title = fill(t.confirmStopTeam, { where });
    body = [t.bodyStopTeam];
    danger = true;
  } else {
    title = fill(t.confirmResume, { where });
    body = [t.bodyResume];
  }
  const choose = (): PauseExit | undefined => {
    if (pending.kind !== "pause") return undefined;
    if (exit === "h1") return { kind: "hours", hours: 1 };
    if (exit === "h4") return { kind: "hours", hours: 4 };
    if (exit === "tomorrow") return { kind: "until", until: tomorrowAtEightUtc() };
    return { kind: "weekly_reset" };
  };
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="panel-confirm-title"
      data-testid="panel-confirm"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
    >
      <div className="max-w-md w-full rounded-lg border p-4" style={{ background: "var(--color-panel)", borderColor: "var(--color-border)" }}>
        <h2 id="panel-confirm-title" className="text-[13px] font-bold mb-2" style={{ color: "var(--color-white)" }}>
          {title}
        </h2>
        {body.map((line) => (
          <p key={line} className="text-[12px] mb-2" style={{ color: "var(--color-bright)" }}>
            {line}
          </p>
        ))}
        {pending.kind === "pause" && (
          <fieldset className="flex flex-col gap-1 my-2 text-[12px]" style={{ color: "var(--color-bright)" }}>
            {(
              [
                ["h1", t.pauseHours1],
                ["h4", t.pauseHours4],
                ["tomorrow", t.pauseTomorrow],
                ["weekly", t.pauseWeekly],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2">
                <input type="radio" name="pause-exit" value={value} checked={exit === value} onChange={() => setExit(value)} />
                {label}
              </label>
            ))}
          </fieldset>
        )}
        <div className="flex justify-end gap-2 mt-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="text-[11px] font-semibold uppercase tracking-widest px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-muted)]"
          >
            {t.cancel}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(choose())}
            disabled={busy}
            className="text-[11px] font-semibold uppercase tracking-widest px-3 py-1.5 rounded border disabled:opacity-60 disabled:cursor-wait"
            style={
              danger
                ? { color: "var(--color-red)", borderColor: "var(--color-red)" }
                : { color: "var(--color-green)", borderColor: "var(--color-green)" }
            }
          >
            {busy ? t.working : t.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * «Agenti»: the team's agents on this computer or on its VPS, sorted by who
 * needs the person first, with their state, their terminal and, outside the
 * read-only view, the controls. Every action is confirmed, names where it
 * goes, and says what happened only once the team said so.
 */
export default function AgentsPanel({ search }: PageProps) {
  const t = AGENTS_PANEL_TEXT[appLocale()];
  const readOnly = useExistingTeamReadOnly() !== null;
  const [list, setList] = useState<Outcome<PanelList> | null>(null);
  const [team, setTeam] = useState<TeamControlState | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(search.get("agent")?.toUpperCase() ?? null);
  const [tab, setTab] = useState<"terminal" | "chat">("terminal");
  const [pending, setPending] = useState<Pending | null>(null);
  const [acting, setActing] = useState(false);
  const [notices, setNotices] = useState<Record<string, Notice>>({});
  const [now, setNow] = useState(() => Date.now());
  const latest = useRef(0);

  const read = useCallback(async () => {
    const mine = ++latest.current;
    setBusy(true);
    const [listed, state] = await Promise.all([readPanelList(), readTeamState()]);
    if (latest.current !== mine) return;
    setList(listed);
    setTeam(state.ok ? state.value : null);
    setNow(Date.now());
    setBusy(false);
  }, []);
  useEffect(() => {
    void read();
    return () => {
      latest.current++;
    };
  }, [read]);
  useRefresh(() => void read());

  const rows = useMemo(() => (list?.ok ? panelRows(list.value, team) : []), [list, team]);
  const current =
    rows.find((row) => row.session === selected) ??
    rows.find((row) => row.role === selected?.toLowerCase()) ??
    rows[0] ??
    null;
  const where = list?.ok
    ? list.value.where === "vps"
      ? fill(t.whereVps, { label: list.value.label ?? "" })
      : t.whereLocal
    : "";

  const runPending = async (exit?: PauseExit) => {
    if (!pending || !list?.ok) return;
    const target = list.value.target;
    setActing(true);
    let key = "team";
    let done: Outcome<ActionResult>;
    if (pending.kind === "stop-team") {
      const stopped = await requestTeamStop();
      setNotices((all) => ({ ...all, team: { ok: stopped.ok, text: stopped.ok ? t.resultStopRequested : t.stopTeamFailed } }));
      setActing(false);
      setPending(null);
      await read();
      return;
    }
    if (pending.kind === "agent") {
      key = pending.row.session;
      done = await controlAgent(pending.op, pending.row.session, target);
    } else if (pending.kind === "pause") {
      done = exit ? await pauseTeam(exit, target) : { ok: false, at: Date.now(), code: "agent_control_invalid" };
    } else {
      done = await resumeTeam(target);
    }
    const name = pending.kind === "agent" ? displayName(pending.row.session) : "";
    setNotices((all) => ({
      ...all,
      [key]: done.ok ? { ok: true, text: resultText(t, done.value, name) } : { ok: false, text: failureText(done.code) },
    }));
    setActing(false);
    setPending(null);
    await read();
  };

  const counts = useMemo(() => {
    const up = rows.filter(isUp);
    return {
      waiting: up.filter((row) => row.agent?.state.state === "aspetta_umano").length,
      working: up.filter((row) => row.agent?.state.state === "lavora").length,
      up: up.length,
      total: rows.length,
      // only to be shown: the questions of the agents that are up, null where the team does not say them
      questions: questionsSummary(t, up.map((row) => row.agent!.questions)),
    };
  }, [rows, t]);

  const teamLine = (() => {
    if (!team) return null;
    if (team.halted) return t.teamHalted;
    if (team.standby.state === "active")
      return team.standby.weeklyReset || !team.standby.until
        ? t.teamPausedWeekly
        : fill(t.teamPausedUntil, { time: stamp(Date.parse(team.standby.until)) });
    if (team.standby.state === "expired") return t.teamPauseEnding;
    return t.teamActive;
  })();
  const paused = team?.standby.state === "active";
  // The user's full-throttle override (JHT-T33): on with its end, ending within the hour, or ended.
  const burnLine = (() => {
    const burn = team?.burnIntent;
    if (!burn) return null;
    if (burn.state === "expired") return t.burnEnded;
    if (burn.state !== "active" || burn.remainingMin === null || burn.expiresAt === null) return null;
    const time = stamp(Date.parse(burn.expiresAt));
    return fill(burn.remainingMin <= 60 ? t.burnEnding : t.burnOn, { time, minutes: String(burn.remainingMin) });
  })();

  return (
    <div className="max-w-6xl mx-auto px-5 pt-6 pb-8" style={{ animation: "fade-in 0.35s ease both" }}>
      <div className="flex items-start justify-between gap-4 mb-2">
        <h1 className="text-xl font-bold uppercase tracking-[0.18em] leading-none" style={{ color: "var(--color-white)" }}>
          {t.title}
        </h1>
        <button
          type="button"
          onClick={() => void read()}
          disabled={busy}
          className="text-[11px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)] disabled:opacity-60 disabled:cursor-wait"
        >
          {busy ? t.refreshing : t.refresh}
        </button>
      </div>
      {list?.ok && <p className="text-[11px] mb-1 text-[var(--color-muted)]">{fill(t.intro, { where })}</p>}
      {readOnly && (
        <p data-testid="panel-read-only" className="text-[11px] mb-2 text-[var(--color-muted)]">
          {t.readOnly}
        </p>
      )}

      {list === null && <p className="text-[12px] text-[var(--color-muted)]">{t.reading}</p>}
      {list && !list.ok && (
        <div role="alert" data-testid="panel-error" className="text-[12px] text-[var(--color-red)]">
          <strong>{t.failed}</strong>
          <p>{failureText(list.code)}</p>
          <p className="text-[11px] text-[var(--color-muted)]">{fill(t.failedAt, { time: stamp(list.at) })}</p>
        </div>
      )}

      {list?.ok && (
        <>
          {!readOnly && (list.value.ownVps === "claimable" || list.value.ownVps === "key_changed") && (
            <OwnVpsClaim
              reason={list.value.ownVps === "key_changed" ? "own_vps_key_changed" : "own_vps_claim_required"}
              onClaimed={() => void read()}
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3 rounded border px-3 py-2" style={{ borderColor: "var(--color-border)" }}>
            <span data-testid="panel-summary" className="text-[11px]" style={{ color: "var(--color-bright)" }}>
              {[
                pluralText(appLocale(), counts.waiting, t.summaryWaiting),
                pluralText(appLocale(), counts.working, t.summaryWorking),
                pluralText(appLocale(), counts.up, t.summaryUp, { total: counts.total }),
              ].join(" · ")}
              {counts.up > 0 && (
                <>
                  {" · "}
                  <span data-testid="panel-questions-summary" title={t.questionsSummaryHelp}>
                    {counts.questions}
                  </span>
                </>
              )}
              {teamLine && (
                <>
                  {" · "}
                  <span data-testid="panel-team-state">{teamLine}</span>
                </>
              )}
              {burnLine && (
                <>
                  {" · "}
                  <span data-testid="panel-burn-intent">{burnLine}</span>
                </>
              )}
            </span>
            {!readOnly && team && !team.halted && (
              <div className="flex gap-2">
                <button
                  type="button"
                  data-testid={paused ? "panel-resume" : "panel-pause"}
                  onClick={() => setPending(paused ? { kind: "resume" } : { kind: "pause" })}
                  className="text-[11px] font-semibold uppercase tracking-widest px-3 py-1 rounded border border-[var(--color-border)] text-[var(--color-bright)]"
                >
                  {paused ? t.resume : t.pause}
                </button>
                <button
                  type="button"
                  data-testid="panel-stop-team"
                  onClick={() => setPending({ kind: "stop-team" })}
                  className="text-[11px] font-semibold uppercase tracking-widest px-3 py-1 rounded border"
                  style={{ color: "var(--color-red)", borderColor: "var(--color-red)" }}
                >
                  {t.stopTeam}
                </button>
              </div>
            )}
          </div>
          {!readOnly && team && !team.halted && (
            <p data-testid="panel-team-help" className="text-[11px] -mt-2 mb-3 text-[var(--color-muted)]">
              {t.teamControlsHelp}
            </p>
          )}
          {notices.team && (
            <p role={notices.team.ok ? "status" : "alert"} className="text-[11px] mb-2" style={{ color: notices.team.ok ? "var(--color-green)" : "var(--color-red)" }}>
              {notices.team.text}
            </p>
          )}
          {!list.value.statesKnown && (
            <p data-testid="panel-states-unknown" className="text-[11px] mb-3 text-[var(--color-dim)]">
              {t.statesUnknown}
            </p>
          )}
          <p className="text-[11px] mb-2 text-[var(--color-muted)]">{fill(t.readAt, { time: stamp(list.at) })}</p>

          <div className="flex flex-col md:flex-row gap-3 min-h-0">
            <ul aria-label={t.title} className="md:w-[260px] shrink-0 flex flex-col gap-px rounded border overflow-hidden" style={{ borderColor: "var(--color-border)", opacity: busy ? 0.6 : 1 }}>
              {rows.map((row) => {
                const active = current?.session === row.session;
                return (
                  <li key={row.session}>
                    <button
                      type="button"
                      data-testid={`panel-row-${row.session}`}
                      data-state={row.agent ? row.agent.state.state : "down"}
                      title={row.agent ? identityLine(t, row.agent.identity, where) : undefined}
                      aria-current={active ? "true" : undefined}
                      onClick={() => {
                        setSelected(row.session);
                        setTab("terminal");
                      }}
                      className="w-full text-left px-3 py-1.5 flex items-center gap-2"
                      style={{ background: active ? "var(--color-card)" : "transparent" }}
                    >
                      <Led row={row} />
                      <span className="text-[11px] font-semibold tracking-wider w-[110px] shrink-0" style={{ color: isUp(row) ? "var(--color-white)" : "var(--color-muted)" }}>
                        {row.session}
                      </span>
                      <span className="text-[11px] min-w-0 leading-snug break-words" style={{ color: "var(--color-muted)" }}>
                        {stateLine(t, row)}
                        {isUp(row) && <UsageShort t={t} usage={row.agent!.usage} />}
                        {isUp(row) && <QuestionMarks t={t} questions={row.agent!.questions} />}
                      </span>
                    </button>
                    {notices[row.session] && !notices[row.session].ok && (
                      <p role="alert" className="px-3 pb-1 text-[11px] text-[var(--color-red)]">
                        {notices[row.session].text}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>

            {current && (
              <section className="flex-1 min-w-0 rounded border p-3" style={{ borderColor: "var(--color-border)" }} aria-label={current.session}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Led row={current} />
                      <span className="text-[13px] font-bold tracking-widest" style={{ color: "var(--color-white)" }}>
                        {current.session}
                      </span>
                      <span className="text-[11px] uppercase tracking-widest" style={{ color: current.agent ? "var(--color-green)" : "var(--color-dim)" }}>
                        {isUp(current) ? t.up : current.heldByUser ? t.heldByUser : t.down}
                      </span>
                    </div>
                    <p
                      data-testid="panel-state"
                      className="text-[11px] mt-1"
                      style={{ color: current.agent ? TONE[describeAgentState(current.agent.state, appLocale()).tone] : "var(--color-dim)" }}
                    >
                      {stateLine(t, current)}
                    </p>
                    {current.agent && (
                      <p data-testid="panel-identity" className="text-[11px] mt-0.5 text-[var(--color-muted)]">
                        {identityLine(t, current.agent.identity, where)}
                      </p>
                    )}
                    {current.agent && (
                      <p
                        data-testid="panel-times"
                        className="text-[11px] mt-0.5 text-[var(--color-muted)]"
                        title={`${fill(t.started, { time: current.agent.created === null ? "—" : fullStamp(current.agent.created * 1000) })} · ${fill(t.activity, { time: current.agent.activity === null ? "—" : fullStamp(current.agent.activity * 1000) })}`}
                      >
                        {fill(t.started, { time: clock(current.agent.created) })} · {fill(t.activity, { time: ago(current.agent.activity) })}
                        {current.agent.activity !== null &&
                          current.agent.state.state !== "lavora" &&
                          now - current.agent.activity * 1000 < MOVING_MS && (
                            <span data-testid="panel-moving"> · {fill(t.screenMoving, { seconds: Math.max(0, Math.round((now - current.agent.activity * 1000) / 1000)) })}</span>
                          )}
                      </p>
                    )}
                    {isUp(current) && <UsageLine t={t} usage={current.agent!.usage} />}
                    {isUp(current) && <QuestionList t={t} questions={current.agent!.questions} readOnly={readOnly} now={now} />}
                    {SCHEDULED.has(current.session) && <p className="text-[11px] mt-1 text-[var(--color-dim)]">{t.maintenance}</p>}
                    {REVIEWER.test(current.session) && <p className="text-[11px] mt-1 text-[var(--color-dim)]">{t.reviewer}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    {rowActions(current, readOnly).map((op) => (
                      <button
                        key={op}
                        type="button"
                        data-testid={`panel-${op}`}
                        onClick={() => setPending({ kind: "agent", op, row: current })}
                        className={`text-[11px] font-semibold uppercase tracking-widest px-3 py-1 rounded border ${op === "stop" ? "ml-3" : ""}`}
                        style={
                          op === "stop"
                            ? { color: "var(--color-red)", borderColor: "var(--color-red)" }
                            : op === "start"
                              ? { color: "var(--color-green)", borderColor: "var(--color-green)" }
                              : { color: "var(--color-bright)", borderColor: "var(--color-border)" }
                        }
                      >
                        {{ start: t.start, stop: t.stop, restart: t.restart }[op]}
                      </button>
                    ))}
                  </div>
                </div>
                {notices[current.session] && (
                  <p
                    role={notices[current.session].ok ? "status" : "alert"}
                    data-testid="panel-notice"
                    className="text-[11px] mt-2"
                    style={{ color: notices[current.session].ok ? "var(--color-green)" : "var(--color-red)" }}
                  >
                    {notices[current.session].text}
                  </p>
                )}

                <div role="tablist" className="flex gap-3 mt-3 mb-2 border-b" style={{ borderColor: "var(--color-border)" }}>
                  {(["terminal", ...(CHAT_ROLES.has(current.role) && current.session === current.role.toUpperCase() ? ["chat"] : [])] as const).map((name) => (
                    <button
                      key={name}
                      role="tab"
                      type="button"
                      aria-selected={tab === name}
                      onClick={() => setTab(name as "terminal" | "chat")}
                      className="text-[11px] font-semibold uppercase tracking-widest pb-1"
                      style={{ color: tab === name ? "var(--color-white)" : "var(--color-muted)", borderBottom: tab === name ? "2px solid var(--color-white)" : "2px solid transparent" }}
                    >
                      {name === "terminal" ? t.tabTerminal : t.tabChat}
                    </button>
                  ))}
                </div>
                {tab === "chat" && CHAT_ROLES.has(current.role) ? (
                  AgentChatPane ? (
                    <AgentChatPane role={current.role as ChatRole} />
                  ) : (
                    <p className="text-[11px] text-[var(--color-muted)]">{fill(t.chatSoon, { name: displayName(current.session) })}</p>
                  )
                ) : current.agent ? (
                  <Terminal key={current.session} row={current} t={t} />
                ) : (
                  <p className="text-[11px] text-[var(--color-muted)]">{t.screenDown}</p>
                )}
              </section>
            )}
          </div>
        </>
      )}

      {pending && list?.ok && (
        <Confirm t={t} pending={pending} where={where} busy={acting} onCancel={() => setPending(null)} onConfirm={(exit) => void runPending(exit)} />
      )}
    </div>
  );
}
