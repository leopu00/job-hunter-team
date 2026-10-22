"use client";

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { makeT } from "@/lib/i18n-dict";
import { useLocale } from "@/lib/use-locale";
import { T } from "./TeamControl.i18n";
import { TeamStatusControls } from "./MobileTeamStatus";
import {
  ACTIONS,
  AGENT_NAMES,
  POLL_MAX,
  POLL_MS,
  TARGETS,
  commandUrl,
  confirmCall,
  errorKey,
  fill,
  firstCall,
  isTarget,
  isTerminal,
  readCommandStatus,
  readDoorAnswer,
  type CommandStatus,
  type TeamAction,
  type TeamTarget,
} from "./team-control";

type Waiting = {
  action: TeamAction;
  target: TeamTarget;
  id: string;
  expiresAt: string | null;
};
type Follow = CommandStatus | "lost";

/**
 * Start, stop and restart the team, or one agent, from the website.
 *
 * The site only asks: the database decides (recent session, limits, the closed list of targets) and the
 * paired device runs the command with its own secrets. For the whole team the database answers first with
 * what is about to happen, and the command leaves only after this page sends back the id of that answer.
 * The state of the command (pending, running, done, error) is read from the bus while it runs.
 *
 * The desktop has its own controls for this (the agents' panel): it provides TeamStatusControls and this
 * component stays out.
 */
export default function TeamControl() {
  const locale = useLocale();
  const t = makeT(T, locale);
  const desktopControls = useContext(TeamStatusControls);
  const [target, setTarget] = useState<TeamTarget>("all");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [follow, setFollow] = useState<Follow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const targetName = (value: TeamTarget) =>
    value === "all" ? t("target_all") : AGENT_NAMES[value];

  const poll = useCallback(async (commandId: string) => {
    setFollow("pending");
    for (let attempt = 0; attempt < POLL_MAX; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      if (!alive.current) return;
      try {
        const res = await fetch(commandUrl(commandId), { cache: "no-store" });
        const status = readCommandStatus(
          res.status,
          await res.json().catch(() => null),
        );
        if (status) {
          if (!alive.current) return;
          setFollow(status);
          if (isTerminal(status)) return;
        }
      } catch {
        /* offline for a moment: the next turn asks again */
      }
    }
    if (alive.current) setFollow("lost");
  }, []);

  const send = useCallback(
    async (
      call: { url: string; body: unknown },
      action: TeamAction,
      forTarget: TeamTarget,
    ) => {
      setBusy(true);
      setError(null);
      setFollow(null);
      try {
        const res = await fetch(call.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(call.body),
        });
        const answer = readDoorAnswer(
          res.status,
          await res.json().catch(() => null),
        );
        if (answer.kind === "refused") {
          setWaiting(null);
          setError(errorKey(answer.code));
        } else if (answer.kind === "confirm") {
          setWaiting({
            action,
            target: forTarget,
            id: answer.id,
            expiresAt: answer.expiresAt,
          });
        } else {
          setWaiting(null);
          if (answer.commandId) void poll(answer.commandId);
          else setFollow("done");
        }
      } catch {
        setError("err_generic");
      } finally {
        setBusy(false);
      }
    },
    [poll],
  );

  if (desktopControls) return null;

  return (
    <section
      aria-labelledby="team-control-title"
      data-testid="team-control"
      className="mx-auto mb-8 w-full max-w-[900px] rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 sm:p-5"
    >
      <h2
        id="team-control-title"
        className="text-[15px] font-bold text-[var(--color-white)]"
      >
        {t("title")}
      </h2>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-muted)]">
        {t("intro")}
      </p>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="flex items-center gap-2 text-[12px] text-[var(--color-muted)]">
          {t("target")}
          <select
            data-testid="team-control-target"
            value={target}
            disabled={busy || waiting !== null}
            onChange={(event) => {
              const next = event.target.value;
              if (isTarget(next)) setTarget(next);
            }}
            className="min-h-11 rounded-lg border border-[var(--color-border)] bg-transparent px-2 text-[13px] text-[var(--color-white)]"
          >
            {TARGETS.map((value) => (
              <option key={value} value={value}>
                {targetName(value)}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap gap-2">
          {ACTIONS.map((action) => (
            <button
              key={action}
              type="button"
              data-testid={`team-control-${action}`}
              disabled={busy || waiting !== null}
              onClick={() =>
                void send(firstCall(action, target), action, target)
              }
              className="min-h-11 rounded-lg border border-[var(--color-border)] px-4 text-[13px] font-semibold text-[var(--color-white)] hover:bg-[var(--color-border)]/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t(action)}
            </button>
          ))}
        </div>
      </div>

      {waiting && (
        <div
          role="alertdialog"
          aria-labelledby="team-control-confirm-title"
          data-testid="team-control-confirm"
          className="mt-3 rounded-xl border border-[var(--color-border)] p-3"
        >
          <p
            id="team-control-confirm-title"
            className="text-[13px] font-bold text-[var(--color-white)]"
          >
            {fill(t(`confirm_${waiting.action}`), targetName(waiting.target))}
          </p>
          <p className="mt-1 text-[11px] text-[var(--color-muted)]">
            {t("expires")}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:max-w-sm">
            <button
              type="button"
              data-testid="team-control-cancel"
              disabled={busy}
              onClick={() => setWaiting(null)}
              className="min-h-11 rounded-lg border border-[var(--color-border)] px-3 text-[12px] text-[var(--color-muted)]"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              data-testid="team-control-ok"
              disabled={busy}
              onClick={() =>
                void send(
                  confirmCall(waiting.action, waiting.id),
                  waiting.action,
                  waiting.target,
                )
              }
              className="min-h-11 rounded-lg bg-[var(--color-accent,#2563eb)] px-3 text-[12px] font-bold text-white disabled:opacity-50"
            >
              {busy ? "…" : t("confirm")}
            </button>
          </div>
        </div>
      )}

      <div
        aria-live="polite"
        className="mt-3 min-h-5 text-[12px]"
        data-testid="team-control-status"
      >
        {error && <span className="text-red-300">{t(error)}</span>}
        {!error && follow && (
          <span
            className={
              follow === "error" || follow === "lost"
                ? "text-red-300"
                : follow === "done"
                  ? "text-emerald-300"
                  : "text-[var(--color-muted)]"
            }
          >
            {t(follow === "lost" ? "status_lost" : `status_${follow}`)}
          </span>
        )}
      </div>
    </section>
  );
}
