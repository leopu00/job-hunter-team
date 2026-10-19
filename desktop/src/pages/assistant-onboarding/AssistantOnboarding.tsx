import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/use-locale";
import type {
  AssistantOnboardingPath,
  AssistantOnboardingProps,
  AssistantOnboardingState,
  AssistantOnboardingStep,
} from "./contract";
import { INITIAL_ASSISTANT_ONBOARDING_STATE } from "./contract";
import { DICTATION_LOCALE } from "../messages/direct-chat.i18n";
import { fill } from "../../lib/text-slots";
import { FIRST_MESSAGE_LABEL, FIRST_MESSAGE_NOTE, FIRST_MESSAGE_PLACEHOLDER } from "./AssistantOnboarding.i18n";
import { ASSISTANT_GUIDE_TEXT } from "./AssistantOnboarding.guide.i18n";
import { VoiceInputControl } from "../../voice-input";
import "./assistant-onboarding.css";

function validInitialState(state: AssistantOnboardingState | undefined): AssistantOnboardingState {
  if (!state?.path || !Object.hasOwn(ASSISTANT_GUIDE_TEXT.it.guides, state.path)) return INITIAL_ASSISTANT_ONBOARDING_STATE;
  const numericStep = Number(state.step);
  const step = (Number.isInteger(numericStep) ? Math.min(4, Math.max(1, numericStep)) : 1) as AssistantOnboardingStep;
  return { path: state.path, step };
}

export default function AssistantOnboarding({
  assistantName: givenName,
  initialState,
  onStateChange,
  onComplete,
  voiceInputBridge,
}: AssistantOnboardingProps) {
  const locale = useLocale();
  const t = ASSISTANT_GUIDE_TEXT[locale];
  const assistantName = givenName ?? t.defaultName;
  const [state, setState] = useState<AssistantOnboardingState>(() => validInitialState(initialState));
  const [completing, setCompleting] = useState(false);
  const [completionError, setCompletionError] = useState(false);
  const [completionVerified, setCompletionVerified] = useState(false);
  const [firstMessage, setFirstMessage] = useState("");
  const dialogueTitle = useRef<HTMLHeadingElement>(null);
  const path = state.path;
  const guide = path ? t.guides[path][state.step - 1] : null;
  const pathLabel = path ? t.paths[path] : "";
  const visibleProgress = state.step === 4 && !completionVerified ? 3 : state.step;

  useEffect(() => {
    if (state.step > 0) dialogueTitle.current?.focus();
  }, [state]);

  function move(next: AssistantOnboardingState) {
    setCompletionError(false);
    setCompletionVerified(false);
    setState(next);
    onStateChange?.(next);
  }

  function choose(path: AssistantOnboardingPath) {
    move({ path, step: 1 });
  }

  function back() {
    if (!state.path) return;
    if (state.step === 1) move(INITIAL_ASSISTANT_ONBOARDING_STATE);
    else move({ path: state.path, step: (state.step - 1) as AssistantOnboardingStep });
  }

  async function next() {
    if (!state.path) return;
    if (state.step === 4) {
      if (completing || completionVerified) return;
      setCompleting(true);
      setCompletionError(false);
      try {
        await onComplete(state, firstMessage.trim());
        setCompletionVerified(true);
      } catch {
        setCompletionError(true);
      } finally {
        setCompleting(false);
      }
      return;
    }
    move({ path: state.path, step: (state.step + 1) as AssistantOnboardingStep });
  }

  return (
    <section
      className="assistant-onboarding"
      aria-labelledby="assistant-onboarding-title"
      data-testid="assistant-onboarding-shell"
      style={{ height: "calc(100svh / var(--zoom, 1) - 3.5rem)" }}
    >
      <header className="assistant-onboarding__header">
        <div>
          <p className="assistant-onboarding__kicker">{t.kicker}</p>
          <h1 id="assistant-onboarding-title">{t.headline}</h1>
        </div>
        <div className="assistant-onboarding__progress-copy" aria-hidden="true">
          {visibleProgress}/4
        </div>
        <div
          className="assistant-onboarding__progress"
          role="progressbar"
          aria-label={t.progressAria}
          aria-valuemin={0}
          aria-valuemax={4}
          aria-valuenow={visibleProgress}
        >
          {[1, 2, 3, 4].map((step) => (
            <span key={step} className={step <= visibleProgress ? "is-complete" : undefined} />
          ))}
        </div>
      </header>

      <div className="assistant-onboarding__body" style={{ overflowY: "auto" }}>
        <aside className="assistant-onboarding__identity" aria-label={fill(t.identityAria, { name: assistantName })}>
          <div className="assistant-onboarding__portrait" aria-hidden="true">
            <span>AI</span>
          </div>
          <div>
            <p className="assistant-onboarding__role">{t.role}</p>
            <h2>{assistantName}</h2>
            <p>{t.intro}</p>
          </div>
        </aside>

        <div className="assistant-onboarding__dialogue" role="region" aria-label={fill(t.dialogueAria, { name: assistantName })}>
          {!guide ? (
            <>
              <p className="assistant-onboarding__speaker">{assistantName}</p>
              <h2 ref={dialogueTitle} tabIndex={-1}>{t.startTitle}</h2>
              <p className="assistant-onboarding__message">{t.startMessage}</p>
              <div className="assistant-onboarding__choices" role="group" aria-label={t.choicesAria}>
                <button type="button" onClick={() => choose("tour")}>
                  <span>01</span>
                  <strong>{t.choices.tour.title}</strong>
                  <small>{t.choices.tour.hint}</small>
                </button>
                <button type="button" onClick={() => choose("requirements")}>
                  <span>02</span>
                  <strong>{t.choices.requirements.title}</strong>
                  <small>{t.choices.requirements.hint}</small>
                </button>
                <button type="button" onClick={() => choose("explore")}>
                  <span>03</span>
                  <strong>{t.choices.explore.title}</strong>
                  <small>{t.choices.explore.hint}</small>
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="assistant-onboarding__dialogue-meta">
                <span>{pathLabel}</span>
                <span>{fill(t.stepOf, { step: state.step })}</span>
              </div>
              <p className="assistant-onboarding__speaker">{assistantName} · {guide.eyebrow}</p>
              <h2 ref={dialogueTitle} tabIndex={-1}>{guide.title}</h2>
              <p className="assistant-onboarding__message" aria-live="polite">{guide.message}</p>
              {state.step === 4 && (
                <div className="assistant-onboarding__composer">
                  <label htmlFor="assistant-first-message">{FIRST_MESSAGE_LABEL[locale]}</label>
                  <div className="assistant-onboarding__composer-row">
                    <textarea
                      id="assistant-first-message"
                      rows={3}
                      value={firstMessage}
                      onChange={(event) => setFirstMessage(event.target.value)}
                      disabled={completing || completionVerified}
                      placeholder={FIRST_MESSAGE_PLACEHOLDER[locale]}
                    />
                    <VoiceInputControl
                      value={firstMessage}
                      onChange={setFirstMessage}
                      locale={DICTATION_LOCALE[locale]}
                      bridge={voiceInputBridge}
                      disabled={completing || completionVerified}
                      className="assistant-onboarding__voice"
                    />
                  </div>
                  <small>{FIRST_MESSAGE_NOTE[locale]}</small>
                </div>
              )}
              {completionError && (
                <p className="assistant-onboarding__error" role="alert">
                  {t.completionError}
                </p>
              )}
              <div className="assistant-onboarding__actions">
                <button type="button" className="assistant-onboarding__back" onClick={back} disabled={completing || completionVerified}>
                  <span aria-hidden="true">←</span> {t.back}
                </button>
                <button
                  type="button"
                  className="assistant-onboarding__next"
                  onClick={() => void next()}
                  disabled={completionVerified || completing || (state.step === 4 && !firstMessage.trim())}
                >
                  {completionVerified
                    ? t.verified
                    : completing
                    ? t.opening
                    : state.step === 4
                      ? completionError
                        ? t.retry
                        : t.toChat
                      : t.next}
                  <span aria-hidden="true">→</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
