import { useCallback, useEffect, useRef, useState } from "react";
import { describeAgentState, type AgentStateTone } from "@/lib/agent-state";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import {
  readAgentScreen,
  readTeamAgentsShared,
  type AgentScreenReading,
  type TeamAgent,
  type TeamAgentsReading,
} from "../../lib/existing-team-agents";
import { useRefresh } from "../../shell/router";
import type { PageProps } from "../types";
import { EXISTING_TEAM_AGENTS_TEXT, type ExistingTeamAgentsText } from "./readonly.i18n";

const TONE: Record<AgentStateTone, string> = {
  green: "var(--color-green)",
  neutral: "var(--color-muted)",
  amber: "var(--color-yellow)",
  blue: "var(--color-blue)",
  red: "var(--color-red)",
  grey: "var(--color-dim)",
};

function stamp(at: number): string {
  return new Date(at).toLocaleString(appLocale(), { dateStyle: "short", timeStyle: "medium" });
}

function clock(seconds: number | null): string {
  return seconds === null ? "—" : stamp(seconds * 1000);
}

/** One agent: its session, its state and, when opened, its terminal's last lines. */
function AgentRow({ agent, t }: { agent: TeamAgent; t: ExistingTeamAgentsText }) {
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState<AgentScreenReading | null>(null);
  const latest = useRef(0);
  const state = describeAgentState(agent.state, appLocale());

  const toggle = async () => {
    const mine = ++latest.current;
    if (open) {
      setOpen(false);
      setScreen(null);
      return;
    }
    setOpen(true);
    setScreen(null);
    // Read once, when the person opens it: never in the background.
    const read = await readAgentScreen(agent.name);
    if (latest.current === mine) setScreen(read);
  };
  useEffect(
    () => () => {
      latest.current++;
    },
    [],
  );

  const failure =
    screen?.kind === "error" ? describeError(screen.code, { fallback: "agents_unavailable", locale: appLocale() }) : null;
  return (
    <li
      data-testid={`agent-${agent.name}`}
      data-state={agent.state.state}
      className="rounded-lg border p-3"
      style={{ borderColor: "var(--color-border)", background: "var(--color-card)" }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-semibold tracking-widest" style={{ color: "var(--color-white)" }}>
          {agent.name}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--color-green)" }}>
          {t.up}
        </span>
      </div>
      <p data-testid={`agent-${agent.name}-state`} className="mt-1 text-[11px]" style={{ color: TONE[state.tone] }}>
        {state.line}
      </p>
      <p className="mt-1 text-[10px]" style={{ color: "var(--color-muted)" }}>
        {t.started.replace("{time}", clock(agent.created))} · {t.activity.replace("{time}", clock(agent.activity))}
      </p>
      <button
        type="button"
        onClick={() => void toggle()}
        aria-expanded={open}
        className="mt-2 text-[10px] font-semibold tracking-widest uppercase px-2 py-1 rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)]"
      >
        {open ? t.close : t.open}
      </button>
      {open && (
        <div data-testid={`agent-${agent.name}-screen`} className="mt-2">
          {screen === null && (
            <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
              {t.screenReading}
            </p>
          )}
          {failure && screen?.kind === "error" && (
            <p role="alert" className="text-[11px]" style={{ color: "var(--color-red)" }}>
              {failure.text} {failure.action} ({screen.code})
            </p>
          )}
          {screen?.kind === "read" && !screen.up && (
            <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
              {t.screenDown}
            </p>
          )}
          {screen?.kind === "read" && screen.up && (
            <>
              <p className="text-[10px] mb-1" style={{ color: "var(--color-muted)" }}>
                {t.screenAt.replace("{time}", stamp(screen.at))}
              </p>
              {/* Text only: React escapes it, nothing in it is ever HTML. */}
              <pre
                data-testid={`agent-${agent.name}-terminal`}
                className="text-[10px] leading-snug whitespace-pre-wrap break-words max-h-80 overflow-auto rounded p-2"
                style={{ background: "var(--color-deep)", color: "var(--color-bright)" }}
              >
                {screen.text === "" ? t.screenEmpty : screen.text}
              </pre>
            </>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * «Agenti» of an existing team that is only read: every agent session the
 * product creates on its VPS, up or not, the state the team computes for each
 * (unknown when the VPS does not publish it) and, on request, the last lines
 * of a terminal. Nothing here starts, stops or writes to an agent, and nothing
 * is read from the cloud.
 */
export default function ExistingTeamAgentsPage(_props: PageProps) {
  const t = EXISTING_TEAM_AGENTS_TEXT[appLocale()];
  const [reading, setReading] = useState<TeamAgentsReading>({ kind: "unknown" });
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);

  const read = useCallback(async () => {
    const mine = ++latest.current;
    setBusy(true);
    const result = await readTeamAgentsShared();
    if (latest.current !== mine) return;
    setReading(result);
    setBusy(false);
  }, []);
  useEffect(() => {
    void read();
    return () => {
      latest.current++;
    };
  }, [read]);
  useRefresh(() => void read());

  const failure =
    reading.kind === "error" ? describeError(reading.code, { fallback: "agents_unavailable", locale: appLocale() }) : null;

  return (
    <div className="max-w-3xl mx-auto px-5 pt-8 pb-10" style={{ animation: "fade-in 0.35s ease both" }}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <h1 className="text-xl font-bold uppercase tracking-[0.18em] leading-none" style={{ color: "var(--color-white)" }}>
          {t.title}
        </h1>
        <button
          type="button"
          onClick={() => void read()}
          disabled={busy}
          className="text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)] disabled:opacity-60 disabled:cursor-wait"
        >
          {busy ? t.refreshing : t.refresh}
        </button>
      </div>
      <p className="text-[11px] mb-1" style={{ color: "var(--color-muted)" }}>
        {t.intro}
      </p>
      <p data-testid="agents-read-only" className="text-[11px] mb-5" style={{ color: "var(--color-muted)" }}>
        {t.readOnly}
      </p>

      {reading.kind === "unknown" && (
        <p className="text-[12px]" style={{ color: "var(--color-muted)" }}>
          {t.unknown}
        </p>
      )}

      {reading.kind === "error" && failure && (
        <div role="alert" data-testid="agents-error" className="text-[12px]" style={{ color: "var(--color-red)" }}>
          <strong>{t.failed}</strong>
          <p>
            {failure.text} {failure.action} ({reading.code})
          </p>
          <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
            {t.failedAt.replace("{time}", stamp(reading.at))}
          </p>
        </div>
      )}

      {reading.kind === "read" && (
        <section aria-busy={busy} data-testid="agents-read">
          <p className="text-[11px] mb-3" style={{ color: "var(--color-muted)" }}>
            {t.readAt.replace("{time}", stamp(reading.at))}
          </p>
          {!reading.read.statesKnown && (
            <p data-testid="agents-states-unknown" className="text-[11px] mb-3" style={{ color: "var(--color-dim)" }}>
              {t.statesUnknown}
            </p>
          )}
          <ul className="flex flex-col gap-2" style={{ opacity: busy ? 0.55 : 1 }}>
            {reading.read.roles.flatMap(({ role, multi }) => {
              const sessions = reading.read.agents.filter((agent) => agent.role === role);
              if (sessions.length > 0) return sessions.map((agent) => <AgentRow key={agent.name} agent={agent} t={t} />);
              return [
                <li
                  key={role}
                  data-testid={`agent-role-${role}`}
                  data-state="down"
                  className="rounded-lg border p-3 flex items-center justify-between gap-3"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <span className="text-[12px] font-semibold tracking-widest" style={{ color: "var(--color-muted)" }}>
                    {role.toUpperCase()}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--color-dim)" }}>
                    {multi ? t.noneUp : t.down}
                  </span>
                </li>,
              ];
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
