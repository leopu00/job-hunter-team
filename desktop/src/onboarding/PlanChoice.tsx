import { useEffect, useRef, useState } from "react";
import type { PlanChoiceData, PlanOption } from "../lib/provider-plan";
import type { OnboardingCopy } from "./onboarding.i18n";

type View =
  | { kind: "loading" }
  | { kind: "ready"; data: PlanChoiceData }
  | { kind: "done"; label: string }
  | { kind: "later" }
  | { kind: "hidden" };

/**
 * The subscription plan, asked after the provider's login and before the team starts: the Capitano's first
 * run does not open without one. The plans are the registry's; what Codex reports for the account is only
 * the one preselected, and nothing is written until the person presses «Confirm». While the choice is
 * pending the start of the team waits (`onBlock`); if the plans cannot be read the choice is not shown and
 * the setup goes on (the Assistente asks in the chat), and «I'll say it later» leaves it to the chat too.
 */
export default function PlanChoice({ t, load, declare, onBlock }: {
  t: OnboardingCopy;
  load: () => Promise<PlanChoiceData>;
  declare: (plan: string) => Promise<PlanOption>;
  /** True while the person still has to choose (or leave it for the chat). */
  onBlock: (blocked: boolean) => void;
}) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  // The props of the latest render: the plans are read once, when the step opens.
  const latest = useRef({ load, declare, onBlock });
  latest.current = { load, declare, onBlock };

  useEffect(() => {
    let cancelled = false;
    latest.current.onBlock(true);
    latest.current.load().then((data) => {
      if (cancelled) return;
      if (data.declared) {
        setView({ kind: "done", label: data.declared.label });
        latest.current.onBlock(false);
        return;
      }
      setSelected(data.suggested);
      setView({ kind: "ready", data });
    }).catch(() => {
      if (cancelled) return;
      setView({ kind: "hidden" });
      latest.current.onBlock(false);
    });
    return () => {
      cancelled = true;
      latest.current.onBlock(false);
    };
  }, []);

  async function confirm() {
    if (selected === null || pending) return;
    setPending(true);
    setFailed(false);
    try {
      const declared = await latest.current.declare(selected);
      setView({ kind: "done", label: declared.label });
      latest.current.onBlock(false);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  if (view.kind === "hidden") return null;
  if (view.kind === "loading") return <p className="onboarding-hint" role="status" data-testid="plan-loading">{t.planLoading}</p>;
  if (view.kind === "done") return <p className="onboarding-hint" role="status" data-testid="plan-declared">{t.planDeclared(view.label)}</p>;
  if (view.kind === "later") return <p className="onboarding-hint" role="status" data-testid="plan-later">{t.planLaterNote}</p>;

  const { data } = view;
  return (
    <section className="onboarding-provider-console onboarding-plan" aria-label={t.planTitle} data-testid="plan-choice">
      <div className="onboarding-provider-console__heading"><div><strong>{t.planTitle}</strong><small>{t.planText}</small></div></div>
      <div className="onboarding-plan__list" role="radiogroup" aria-label={t.planGroupAria}>
        {data.plans.map((plan) => (
          <label key={plan.id} className={`onboarding-plan__option${selected === plan.id ? " is-selected" : ""}`}>
            <input type="radio" name="subscription-plan" value={plan.id} checked={selected === plan.id} disabled={pending} onChange={() => setSelected(plan.id)} />
            <span><strong>{plan.label}</strong>{plan.price && <>{" "}<small>{plan.price}</small></>}</span>
            {plan.id === data.suggested && <span className="onboarding-choice__badge">{t.planSuggested}</span>}
          </label>
        ))}
      </div>
      {data.suggested && <small className="onboarding-hint">{t.planSuggestedHint}</small>}
      {selected === null && <small className="onboarding-hint">{t.planChoose}</small>}
      {failed && <p className="onboarding-error" role="alert" data-testid="plan-failed">{t.planFailed}</p>}
      <div className="onboarding-runtime-actions">
        <button className="onboarding-secondary" type="button" data-testid="plan-later-button" disabled={pending} onClick={() => { setView({ kind: "later" }); latest.current.onBlock(false); }}>{t.planLater}</button>
        <button className="onboarding-primary" type="button" data-testid="plan-confirm" disabled={selected === null || pending} onClick={() => void confirm()}>
          {pending ? t.planSaving : t.planConfirm}<span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}
