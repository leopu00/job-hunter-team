import { useEffect, useState } from "react";
import type { Locale } from "@/i18n/config";
import { appLocale } from "../../lib/app-locale";
import { describeError, errorCodeOf } from "../../lib/error-catalog";
import {
  LOCAL_RUNTIME_REMOVED_EVENT,
  localUninstallAvailable,
  uninstallLocal,
  type LocalUninstallOutcome,
  type UninstallLeftover,
} from "../../lib/local-uninstall";
import type { PageProps } from "../types";
import { COMPUTER_TEXT } from "./computer.i18n";

type Stage =
  | { state: "checking" }
  | { state: "unavailable" }
  | { state: "ready" }
  | { state: "removing"; phase: string | null }
  | { state: "done" }
  | { state: "incomplete"; left: UninstallLeftover[] }
  | { state: "failed"; text: string; action: string };

/**
 * /computer: «Remove JHT from this computer» (Windows). It lists what is
 * deleted and what stays, asks for an explicit confirmation, runs the removal
 * with its phases on screen, and then sends the app back to its first start.
 * The person never needs a terminal.
 */
export function ComputerScreen({
  available = localUninstallAvailable,
  uninstall = uninstallLocal,
  locale: localeOverride,
}: {
  available?: () => Promise<boolean>;
  uninstall?: (onPhase: (text: string) => void) => Promise<LocalUninstallOutcome>;
  locale?: Locale;
}) {
  const locale = localeOverride ?? appLocale();
  const t = COMPUTER_TEXT[locale];
  const [stage, setStage] = useState<Stage>({ state: "checking" });
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let active = true;
    void available()
      .catch(() => false)
      .then((yes) => { if (active) setStage({ state: yes ? "ready" : "unavailable" }); });
    return () => { active = false; };
  }, [available]);

  async function remove() {
    if (!confirmed || stage.state === "removing") return;
    setStage({ state: "removing", phase: null });
    try {
      const outcome = await uninstall((phase) => setStage({ state: "removing", phase }));
      setStage(outcome.complete ? { state: "done" } : { state: "incomplete", left: outcome.left });
    } catch (error) {
      const described = describeError(errorCodeOf(error), { fallback: "uninstall_failed", locale });
      setStage({ state: "failed", text: described.text, action: described.action });
    }
  }

  const removing = stage.state === "removing";
  return (
    <section className="max-w-3xl mx-auto px-5 py-8 text-[12px]" aria-labelledby="computer-title">
      <h1 id="computer-title" className="text-[16px] font-bold">{t.title}</h1>
      <p className="mt-1 text-[var(--color-muted)]">{t.intro}</p>

      {stage.state === "checking" && <p className="mt-5" role="status">…</p>}
      {stage.state === "unavailable" && <p className="mt-5" role="status">{t.unavailable}</p>}

      {stage.state !== "checking" && stage.state !== "unavailable" && (
        <section className="mt-6 flex flex-col gap-3" aria-labelledby="computer-remove-title">
          <h2 id="computer-remove-title" className="text-[13px] font-semibold">{t.removeTitle}</h2>

          {stage.state === "done" ? (
            <div role="status" className="flex flex-col gap-2">
              <p className="font-semibold">{t.doneTitle}</p>
              <p>{t.doneText}</p>
              <button
                type="button"
                className="self-start rounded-md border border-[var(--color-border)] px-3 py-1.5 font-semibold"
                onClick={() => window.dispatchEvent(new CustomEvent(LOCAL_RUNTIME_REMOVED_EVENT))}
              >
                {t.backToFirstRun}
              </button>
            </div>
          ) : (
            <>
              <p>{t.removeIntro}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div aria-labelledby="computer-removes">
                  <h3 id="computer-removes" className="font-semibold">{t.removesTitle}</h3>
                  <ul className="mt-1 list-disc pl-4">{t.removes.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
                <div aria-labelledby="computer-keeps">
                  <h3 id="computer-keeps" className="font-semibold">{t.keepsTitle}</h3>
                  <ul className="mt-1 list-disc pl-4">{t.keeps.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
              </div>
              <p>{t.after}</p>

              {stage.state === "incomplete" && (
                <div role="alert">
                  <p className="font-semibold">{t.incompleteTitle}</p>
                  <p>{t.leftIntro} {stage.left.map((id) => t.left[id]).join(", ")}.</p>
                  <p>{t.incompleteAction}</p>
                </div>
              )}
              {stage.state === "failed" && (
                <div role="alert" style={{ color: "var(--color-red)" }}>
                  <p>{stage.text}</p>
                  <p>{stage.action}</p>
                </div>
              )}

              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={removing}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>{t.confirmLabel}</span>
              </label>
              <button
                type="button"
                className="self-start rounded-md border border-[var(--color-border)] px-3 py-1.5 font-semibold"
                style={{ color: "var(--color-red)" }}
                disabled={!confirmed || removing}
                onClick={() => void remove()}
              >
                {removing ? t.removing : stage.state === "incomplete" || stage.state === "failed" ? t.retry : t.removeButton}
              </button>
              {removing && (
                <p role="status" aria-live="polite">
                  {stage.phase ?? t.removing} <span className="text-[var(--color-muted)]">{t.dontClose}</span>
                </p>
              )}
            </>
          )}
        </section>
      )}
    </section>
  );
}

export default function ComputerPage(_props: PageProps) {
  return <ComputerScreen />;
}
