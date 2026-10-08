import { FormEvent, KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import SshKeyPicker from "../components/SshKeyPicker";
import type {
  ExecutionHost,
  OnboardingFlowProps,
  OperationalStage,
  SubscriptionProvider,
} from "../lib/onboarding";
import {
  collectionArtwork,
  OnboardingArtwork,
  runtimeArtwork,
} from "./OnboardingArtwork";
import { OAuthLoginTakeover } from "../oauth-login-takeover";
import { describeError } from "../lib/error-catalog";
import { appLocale } from "../lib/app-locale";
import VpsProfileImport from "./VpsProfileImport";
import { ONBOARDING_TEXT, type OnboardingCopy } from "./onboarding.i18n";
import { WINDOWS_SETUP } from "./windows-setup";
import "./onboarding.css";

function emptyVpsHost(): ExecutionHost {
  return { kind: "vps", address: "", user: "root", port: 22, keyPath: "" };
}
const COLLECTION_STEP_COUNT = 4;

// Codex is the provider the onboarding proposes: first, and already chosen.
const PROPOSED_PROVIDER: SubscriptionProvider = "codex";
// Product names and plans: the same in every language, but the Kimi plan's.
function providers(t: OnboardingCopy): Array<{ value: SubscriptionProvider; label: string; vendor: string; mark: string }> {
  return [
    { value: "codex", label: "Codex", vendor: "OpenAI · ChatGPT Plus/Pro", mark: "CX" },
    { value: "claude", label: "Claude Code", vendor: "Anthropic · Claude Pro/Max", mark: "CL" },
    { value: "kimi", label: "Kimi", vendor: t.kimiVendor, mark: "KM" },
  ];
}
const PROVIDER_VALUES: SubscriptionProvider[] = ["codex", "claude", "kimi"];
const RUNTIME_STAGE_ORDER: OperationalStage[] = ["ssh-host-key", "runtime", "container", "provider", "provider-login", "team-start", "assistant"];

function runtimeStages(host: ExecutionHost, t: OnboardingCopy): Array<{ value: OperationalStage; label: string; detail: string }> {
  return RUNTIME_STAGE_ORDER
    .filter((stage) => host.kind !== "local" || stage !== "ssh-host-key")
    .map((stage) => ({ value: stage, ...t.stages[stage] }));
}

function providerName(provider: SubscriptionProvider, t: OnboardingCopy) {
  return providers(t).find((item) => item.value === provider)?.label ?? provider;
}

function hostName(host: ExecutionHost, t: OnboardingCopy) {
  return host.kind === "local" ? t.thisComputer : t.vpsServer;
}

function moveRadio<T extends string>(
  event: KeyboardEvent<HTMLButtonElement>,
  options: readonly T[],
  current: T | null,
  select: (value: T) => void,
) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
  const index = current === null ? 0 : Math.max(0, options.indexOf(current));
  const next = options[(index + direction + options.length) % options.length];
  const group = event.currentTarget.closest('[role="radiogroup"]');
  select(next);
  group?.querySelector<HTMLButtonElement>(`[data-radio-value="${next}"]`)?.focus();
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function RuntimeView({ host, t, locale, runtime, activity, onRetry, onRestart, onExitFailure, onRuntimeAction, providerLogin, sshHostKey, onConfirmHostKey, onCancelHostKey, onProviderInput, onProviderClose, onProviderRestart, onRecreatePodmanMachine }: Pick<OnboardingFlowProps, "runtime" | "activity" | "onRetry" | "onRestart" | "onExitFailure" | "onRuntimeAction" | "providerLogin" | "sshHostKey" | "onConfirmHostKey" | "onCancelHostKey" | "onProviderInput" | "onProviderClose" | "onProviderRestart" | "onRecreatePodmanMachine"> & { host: ExecutionHost; t: OnboardingCopy; locale: string }) {
  const [pending, setPending] = useState(false);
  const [confirmingRecreate, setConfirmingRecreate] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const pendingRef = useRef(false);
  const failureHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusedFailureKeyRef = useRef<string | null>(null);
  const failureKey = runtime.status === "failed" ? `${runtime.stage}:${runtime.code ?? "unknown"}` : null;

  useEffect(() => {
    setPending(false);
    setActionFailed(false);
    setConfirmingRecreate(false);
  }, [runtime.status, "stage" in runtime ? runtime.stage : "ready"]);

  useEffect(() => {
    if (!activity || runtime.status !== "working") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [activity?.startedAt, runtime.status]);

  useEffect(() => {
    if (!failureKey) {
      focusedFailureKeyRef.current = null;
      return;
    }
    if (focusedFailureKeyRef.current === failureKey) return;
    focusedFailureKeyRef.current = failureKey;
    failureHeadingRef.current?.focus();
  }, [failureKey]);

  if (runtime.status === "ready") {
    return (
      <main className="onboarding-shell onboarding-shell--complete">
        <section className="onboarding-complete" aria-live="polite">
          <OnboardingArtwork name="assistantReady" />
          <span className="onboarding-complete__mark" aria-hidden="true">✓</span>
          <p className="onboarding-eyebrow">{t.readyEyebrow}</p>
          <h1>{t.readyTitle}</h1>
          <p>{t.readyText}</p>
          <div className="onboarding-ready-team" aria-label={t.readyAgentsAria}>
            {t.agents.map((agent) => <span key={agent}>{agent}</span>)}
          </div>
        </section>
      </main>
    );
  }
  if (runtime.status === "collecting") return null;

  const failed = runtime.status === "failed";
  const actionRequired = runtime.status === "action-required";
  const visibleRuntimeStages = runtimeStages(host, t);
  const activeIndex = visibleRuntimeStages.findIndex((stage) => stage.value === runtime.stage);
  const activeLabel = visibleRuntimeStages[activeIndex]?.label ?? t.configuration;
  const failureTitle = failed && runtime.title ? runtime.title : t.configureAgain(activeLabel);
  const completedSteps = Math.max(0, activeIndex);
  const currentActivity = !failed && activity?.current?.stage === runtime.stage ? activity.current : undefined;
  const currentActivityName = currentActivity ? t.activityStages[currentActivity.nativeStage] : undefined;
  const elapsed = activity ? formatElapsed(now - activity.startedAt) : "00:00";

  if (runtime.stage === "provider-login" && providerLogin) {
    return (
      <main className="onboarding-shell">
        <header className="onboarding-header">
          <div className="onboarding-brand" aria-label="Job Hunter Team"><span className="onboarding-brand__mark" aria-hidden="true">J</span><span>Job Hunter Team</span></div>
          <span className="onboarding-session">{t.setupProtected}</span>
        </header>
        <div className="onboarding-layout">
          <aside className="onboarding-progress">
            <p className="onboarding-eyebrow">{t.providerLoginEyebrow}</p>
            <h1>{t.providerLoginTitle}</h1>
            <p className="onboarding-progress__intro">{t.providerLoginIntro}</p>
            <p className="onboarding-progress__privacy">{t.noApiKey}</p>
          </aside>
          <OAuthLoginTakeover
            provider={providerLogin.provider}
            providerName={providerName(providerLogin.provider, t)}
            actions={providerLogin.actions}
            verifying={providerLogin.status === "verifying"}
            connectionState={providerLogin.connectionState}
            elapsedMs={Math.max(0, now - providerLogin.startedAt)}
            safeErrorMessage={providerLogin.safeErrorMessage ?? (failed ? runtime.message : null)}
            onSubmitInput={onProviderInput}
            onCancel={onProviderClose}
            onRestart={onProviderRestart}
          />
        </div>
      </main>
    );
  }

  async function invoke(action: () => Promise<void>, reportFailure = true) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true); setActionFailed(false);
    try { await action(); } catch { if (reportFailure) setActionFailed(true); } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  const actionLabel = runtime.stage === "assistant"
    ? t.openAssistant
    : runtime.stage === "team-start"
      ? t.startTeam
      : runtime.stage === "ssh-host-key" ? t.confirmFingerprint : t.signInProvider;
  // What the deletion loses and what the person redoes after it, from the
  // catalog like every other sentence of this flow.
  const recreateConfirm = describeError("podman_machine_recreate_confirm", { locale });
  // Deleting the machine is never one click: the first button only asks.
  const recreatePodmanMachine = failed && runtime.code === "podman_machine_mounts_home" && host.kind === "local"
    ? onRecreatePodmanMachine
    : undefined;
  const action = failed
    ? onRetry
    : runtime.stage === "ssh-host-key" ? onConfirmHostKey : () => onRuntimeAction(runtime.stage as "provider-login" | "team-start" | "assistant");
  return (
    <main className="onboarding-shell">
      <header className="onboarding-header">
        <div className="onboarding-brand" aria-label="Job Hunter Team"><span className="onboarding-brand__mark" aria-hidden="true">J</span><span>Job Hunter Team</span></div>
        <span className="onboarding-session">{t.setupProtected}</span>
      </header>
      <div className="onboarding-layout">
        <aside className="onboarding-progress">
          <p className="onboarding-eyebrow">{t.autoEyebrow}</p><h1>{t.autoTitle}</h1>
          <p className="onboarding-progress__intro">{t.autoIntro}</p>
          <p className="onboarding-progress__privacy">{t.noApiKey}</p>
        </aside>
        <section className={`onboarding-runtime-card${failed ? " onboarding-runtime-card--failed" : ""}`} aria-busy={pending}>
          <p className="onboarding-eyebrow">{failed ? t.interventionRequired : actionRequired ? t.yourTurn : t.inProgressEyebrow}</p>
          <h2
            ref={failureHeadingRef}
            tabIndex={failed ? -1 : undefined}
          >{failed ? failureTitle : actionRequired ? activeLabel : t.preparing(activeLabel)}</h2>
          <OnboardingArtwork name={runtimeArtwork(runtime)} />
          <section className="onboarding-runtime-progress" aria-label={t.progressAria}>
            <div className="onboarding-runtime-progress__heading">
              <div>
                <strong>{currentActivityName ?? activeLabel}</strong>
                <small>{failed ? t.stepInterrupted : currentActivity?.description ?? runtime.message}</small>
              </div>
              <span>{t.elapsed} <time>{elapsed}</time></span>
            </div>
            <progress aria-label={t.stepsCompletedAria} max={visibleRuntimeStages.length} value={completedSteps} />
            <div className="onboarding-runtime-progress__meta"><span>{t.stepOf(Math.max(1, activeIndex + 1), visibleRuntimeStages.length)}</span><span>{t.completedCount(completedSteps)}</span></div>
            {runtime.status === "working" && (
              <div
                className="onboarding-runtime-progress__indeterminate"
                role="progressbar"
                aria-label={t.progressOf(currentActivityName ?? activeLabel)}
                aria-valuetext={t.percentUnknown}
              ><i /></div>
            )}
          </section>
          <div
            className="onboarding-runtime-status"
            aria-live={failed ? undefined : "polite"}
            role={failed ? "alert" : "status"}
          >
            <span className="onboarding-runtime-status__pulse" aria-hidden="true">{failed ? "!" : actionRequired ? "→" : "••"}</span>
            <div>
              {!failed && <strong>{actionRequired ? t.actionNeeded : t.dontClose}</strong>}
              <small>{runtime.message}</small>
              {failed && runtime.action && <small className="onboarding-runtime-status__action">{t.whatToDo(runtime.action)}</small>}
            </div>
          </div>
          <ol className="onboarding-runtime-track">
            {visibleRuntimeStages.map((stage, index) => (
              <li key={stage.value} className={index < activeIndex ? "is-complete" : index === activeIndex ? "is-active" : undefined}>
                <span>{index < activeIndex ? "✓" : index + 1}</span><div><strong>{stage.label}</strong><small>{stage.detail}</small></div>
                <em>{index < activeIndex ? t.trackReady : index === activeIndex ? failed ? t.trackRetry : actionRequired ? t.trackWaiting : t.trackRunning : t.trackQueued}</em>
              </li>
            ))}
          </ol>
          <details className="onboarding-activity-details">
            <summary>{t.activityDetails} <span>{activity?.events.length ?? 0}</span></summary>
            {activity?.events.length ? (
              <ol>
                {activity.events.map((event) => (
                  <li key={event.id} className={event.status === "completed" ? "is-complete" : event.status === "failed" ? "is-failed" : "is-active"}>
                    <time>{formatElapsed(event.elapsedMs)}</time>
                    <div><strong>{t.activityStages[event.nativeStage]}</strong><small>{event.description}</small></div>
                    <span>{event.status === "completed" ? t.eventDone : event.status === "failed" ? t.eventError : t.eventRunning}</span>
                  </li>
                ))}
              </ol>
            ) : <p>{t.waitingFirstUpdate}</p>}
          </details>
          {failed && runtime.code && (
            <details className="onboarding-activity-details onboarding-technical-details">
              <summary>{t.technicalDetails}</summary>
              <dl>
                <div><dt>{t.code}</dt><dd><code>{runtime.code}</code></dd></div>
              </dl>
            </details>
          )}
          {runtime.stage === "ssh-host-key" && sshHostKey && (
            <section className="onboarding-provider-console" aria-label={t.hostKeyAria}>
              <div className="onboarding-provider-console__heading"><div><strong>{t.hostKeyTitle}</strong><small>{t.hostKeyText}</small></div></div>
              <dl className="onboarding-review">
                <div><dt>{t.algorithm}</dt><dd>{sshHostKey.algorithm}</dd></div>
                <div><dt>{t.fingerprint}</dt><dd>{sshHostKey.fingerprint}</dd></div>
              </dl>
            </section>
          )}
          {recreatePodmanMachine && confirmingRecreate && (
            <section className="onboarding-provider-console" aria-label={t.recreateAria}>
              <div className="onboarding-provider-console__heading"><div><strong>{t.recreateTitle}</strong><small>{t.recreateText}</small><small>{recreateConfirm.text}</small><small>{recreateConfirm.action}</small></div></div>
            </section>
          )}
          {actionFailed && <p className="onboarding-error" role="alert">{t.actionFailed}</p>}
          {failed && runtime.retryable === false && !runtime.action && runtime.code !== "container_version_incompatible" && <p className="onboarding-error">{t.fixData}</p>}
          <div className="onboarding-runtime-actions">
            {!failed && <button className="onboarding-secondary" type="button" onClick={() => invoke(onRestart)} disabled={pending}>
              {t.restart}
            </button>}
            {failed && runtime.retryable === false && (
              <button className="onboarding-secondary" type="button" onClick={onExitFailure} disabled={pending}>
                {t.backToHost}
              </button>
            )}
            {recreatePodmanMachine && !confirmingRecreate && (
              <button className="onboarding-primary" type="button" onClick={() => setConfirmingRecreate(true)} disabled={pending}>
                {t.recreate}<span aria-hidden="true">→</span>
              </button>
            )}
            {recreatePodmanMachine && confirmingRecreate && (
              <>
              <button className="onboarding-secondary" type="button" onClick={() => setConfirmingRecreate(false)} disabled={pending}>{t.cancel}</button>
              <button className="onboarding-primary" type="button" onClick={() => invoke(recreatePodmanMachine, false)} disabled={pending}>
                {pending ? t.recreating : t.recreateYes}<span aria-hidden="true">→</span>
              </button>
              </>
            )}
            {((failed && runtime.retryable !== false) || actionRequired) && (
              <>
              {runtime.stage === "ssh-host-key" && !failed && <button className="onboarding-secondary" type="button" onClick={onCancelHostKey} disabled={pending}>{t.cancel}</button>}
              <button className="onboarding-primary" type="button" onClick={() => invoke(action, !failed)} disabled={pending}>
                {pending ? failed ? t.verifying : t.wait : failed ? t.retryPrepare : actionLabel}<span aria-hidden="true">→</span>
              </button>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export function OnboardingFlow({ account, platform, runtime, activity, onSubmit, onRetry, onRestart, onExitFailure, onRuntimeAction, providerLogin, sshHostKey, onConfirmHostKey, onCancelHostKey, onProviderInput, onProviderClose, onProviderRestart, onRecreatePodmanMachine, previousLocalData = false, locale: localeOverride }: OnboardingFlowProps) {
  const locale = localeOverride ?? appLocale();
  const t = ONBOARDING_TEXT[locale];
  const providerChoices = providers(t);
  // Windows runs the team locally too, with Podman inside WSL.
  const localRuntimeSupported = platform === "macos" || platform === "linux" || platform === "windows";
  const [step, setStep] = useState(0);
  const [host, setHost] = useState<ExecutionHost>(() => localRuntimeSupported ? { kind: "local" } : emptyVpsHost());
  const [provider, setProvider] = useState<SubscriptionProvider | null>(PROPOSED_PROVIDER);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!localRuntimeSupported) {
      setHost((current) => current.kind === "vps" ? current : emptyVpsHost());
    }
  }, [localRuntimeSupported]);

  useLayoutEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  if (runtime.status !== "collecting") return <RuntimeView host={host} t={t} locale={locale} runtime={runtime} activity={activity} onRetry={onRetry} onRestart={onRestart} onExitFailure={exitFailure} onRuntimeAction={onRuntimeAction} providerLogin={providerLogin} sshHostKey={sshHostKey} onConfirmHostKey={onConfirmHostKey} onCancelHostKey={onCancelHostKey} onProviderInput={onProviderInput} onProviderClose={onProviderClose} onProviderRestart={onProviderRestart} onRecreatePodmanMachine={onRecreatePodmanMachine} />;

  const hostIsValid = (localRuntimeSupported && host.kind === "local") ||
    (host.kind === "vps" && Boolean(host.address.trim() && host.user.trim() && host.port > 0 && host.port <= 65535 && host.keyPath.trim()));

  function next(event: FormEvent) {
    event.preventDefault(); setSubmitError(false); setStep((current) => Math.min(current + 1, COLLECTION_STEP_COUNT - 1));
  }
  async function finish(event: FormEvent) {
    event.preventDefault();
    if (!hostIsValid || !provider || submitting) return;
    setSubmitting(true); setSubmitError(false);
    try {
      await onSubmit({
        host: host.kind === "vps" ? { ...host, address: host.address.trim(), user: host.user.trim(), keyPath: host.keyPath.trim() } : host,
        provider,
      });
    } catch { setSubmitError(true); } finally { setSubmitting(false); }
  }

  function exitFailure() {
    setStep(1);
    setSubmitError(false);
    onExitFailure();
  }

  return (
    <main className="onboarding-shell">
      <header className="onboarding-header">
        <div className="onboarding-brand" aria-label="Job Hunter Team"><span className="onboarding-brand__mark" aria-hidden="true">J</span><span>Job Hunter Team</span></div>
        <span className="onboarding-session">
          {account.identity === "local" ? t.localProfileActive : t.googleLinked}
        </span>
      </header>
      <div className="onboarding-layout">
        <aside className="onboarding-progress" aria-label={t.progressAria}>
          <p className="onboarding-eyebrow">{t.firstSetupEyebrow}</p><h1>{t.firstSetupTitle}</h1>
          <p className="onboarding-progress__intro">{t.firstSetupIntro}</p>
          <ol>{t.steps.map((label, index) => <li key={label} className={index === step ? "is-current" : index < step ? "is-complete" : undefined} aria-current={index === step ? "step" : undefined}><span>{index < step ? "✓" : index + 1}</span><div><small>{t.stepNumber(index + 1)}</small><strong>{label}</strong></div></li>)}</ol>
          <p className="onboarding-progress__privacy">{t.noApiKey}</p>
        </aside>

        <section className="onboarding-card">
          <div className="onboarding-card__step">{String(step + 1).padStart(2, "0")} / {String(COLLECTION_STEP_COUNT).padStart(2, "0")}</div>
          {step === 0 && <form onSubmit={next} className="onboarding-panel">
            <OnboardingArtwork name={collectionArtwork(step, host)} />
            <div className="onboarding-account-mark" aria-hidden="true">{(account.displayName || "J").trim().charAt(0).toUpperCase() || "J"}</div>
            <p className="onboarding-eyebrow">{account.identity === "local" ? t.welcomeEyebrowLocal : t.welcomeEyebrowAccount}</p><h2 ref={headingRef} tabIndex={-1}>{t.hello(account.displayName ?? "")}</h2>
            <p className="onboarding-lede">{account.identity === "local" ? t.welcomeLedeLocal : t.welcomeLedeAccount}</p>
            <div className="onboarding-callout"><span aria-hidden="true">01</span><p><strong>{t.calloutStrong}</strong> {t.calloutText}</p></div>
            <button className="onboarding-primary" type="submit">{t.startSetup} <span aria-hidden="true">→</span></button>
          </form>}

          {step === 1 && <>
          <form onSubmit={next} className="onboarding-panel">
            <OnboardingArtwork name={collectionArtwork(step, host)} />
            <p className="onboarding-eyebrow">{t.hostEyebrow}</p><h2 ref={headingRef} tabIndex={-1}>{t.hostTitle}</h2>
            {localRuntimeSupported
              ? <p className="onboarding-lede">{t.hostLedeLocal}</p>
              : <p className="onboarding-lede">{t.hostLedeVpsOnly}</p>}
            <div className="onboarding-choice-grid" role="radiogroup" aria-label={t.hostGroupAria}>
              {localRuntimeSupported && <button data-radio-value="local" tabIndex={host.kind === "local" ? 0 : -1} className={`onboarding-choice${host.kind === "local" ? " is-selected" : ""}`} type="button" role="radio" aria-checked={host.kind === "local"} onKeyDown={(event) => moveRadio(event, ["local", "vps"] as const, host.kind, (kind) => setHost(kind === "local" ? { kind } : emptyVpsHost()))} onClick={() => setHost({ kind: "local" })}><span className="onboarding-choice__icon">PC</span><strong>{t.thisComputer}</strong><small>{platform === "windows" ? t.thisComputerWindows : t.thisComputerOther}</small><span className="onboarding-choice__check">✓</span></button>}
              <button data-radio-value="vps" tabIndex={host.kind === "vps" || !localRuntimeSupported ? 0 : -1} className={`onboarding-choice${host.kind === "vps" ? " is-selected" : ""}`} type="button" role="radio" aria-checked={host.kind === "vps"} onKeyDown={(event) => moveRadio(event, localRuntimeSupported ? ["local", "vps"] as const : ["vps"] as const, host.kind, (kind) => setHost(kind === "local" ? { kind } : emptyVpsHost()))} onClick={() => setHost(emptyVpsHost())}><span className="onboarding-choice__icon">VPS</span><strong>{t.vpsServer}</strong><small>{t.vpsDetail}</small><span className="onboarding-choice__check">✓</span></button>
            </div>
            {host.kind === "vps" && <div className="onboarding-fields onboarding-vps-fields">
              <label className="onboarding-field onboarding-field--full"><span>{t.vpsAddress}</span><input value={host.address} onChange={(event) => setHost({ ...host, address: event.target.value })} placeholder={t.vpsAddressPlaceholder} required /></label>
              <label className="onboarding-field"><span>{t.sshUser}</span><input value={host.user} onChange={(event) => setHost({ ...host, user: event.target.value })} required /></label>
              <label className="onboarding-field"><span>{t.sshPort}</span><input type="number" min="1" max="65535" value={host.port} onChange={(event) => setHost({ ...host, port: Number(event.target.value) })} required /></label>
              <div className="onboarding-field onboarding-field--full"><span>{t.sshKey}</span><SshKeyPicker value={host.keyPath} onChange={(keyPath) => setHost({ ...host, keyPath })} disabled={submitting} /></div>
            </div>}
            <div className="onboarding-actions"><button className="onboarding-secondary" type="button" onClick={() => setStep(0)}>{t.back}</button><button className="onboarding-primary" type="submit" disabled={!hostIsValid}>{t.continue} <span aria-hidden="true">→</span></button></div>
          </form>
          {account.identity === "local" && host.kind === "local" && <VpsProfileImport />}
          </>}

          {step === 2 && <form onSubmit={next} className="onboarding-panel">
            <OnboardingArtwork name={collectionArtwork(step, host)} />
            <p className="onboarding-eyebrow">{t.providerEyebrow}</p><h2 ref={headingRef} tabIndex={-1}>{t.providerTitle}</h2><p className="onboarding-lede">{t.providerLede}</p>
            <div className="onboarding-choice-grid onboarding-choice-grid--providers" role="radiogroup" aria-label={t.providerGroupAria}>
              {providerChoices.map((item, index) => <button key={item.value} data-radio-value={item.value} tabIndex={provider === item.value || (provider === null && index === 0) ? 0 : -1} className={`onboarding-choice${provider === item.value ? " is-selected" : ""}`} type="button" role="radio" aria-checked={provider === item.value} onKeyDown={(event) => moveRadio(event, PROVIDER_VALUES, provider, setProvider)} onClick={() => setProvider(item.value)}><span className="onboarding-choice__icon">{item.mark}</span><strong>{item.label}</strong><small>{item.vendor}</small><span className="onboarding-choice__check">✓</span></button>)}
            </div>
            <p className="onboarding-subscription-note"><strong>{t.subscriptionStrong}</strong> {t.subscriptionText}</p>
            <div className="onboarding-actions"><button className="onboarding-secondary" type="button" onClick={() => setStep(1)}>{t.back}</button><button className="onboarding-primary" type="submit" disabled={!provider}>{t.reviewSetup} <span aria-hidden="true">→</span></button></div>
          </form>}

          {step === 3 && provider && <form onSubmit={finish} className="onboarding-panel">
            <OnboardingArtwork name={collectionArtwork(step, host)} />
            <p className="onboarding-eyebrow">{t.reviewEyebrow}</p><h2 ref={headingRef} tabIndex={-1}>{t.reviewTitle}</h2><p className="onboarding-lede">{t.reviewLede}</p>
            <dl className="onboarding-review">
              <div><dt>{t.environment}</dt><dd>{hostName(host, t)}</dd></div><div><dt>{t.provider}</dt><dd>{providerName(provider, t)}<small>{t.viaSubscription}</small></dd></div>
            </dl>
            {host.kind === "local" && platform === "windows" && <div className="onboarding-review-note" role="note" aria-label={t.installsAria}>
              <p>{t.installsIntro}</p>
              <ul>{t.installs(WINDOWS_SETUP).map((item) => <li key={item}>{item}</li>)}</ul>
              <p>{t.installsRemoval}</p>
            </div>}
            {host.kind === "local" && previousLocalData && <p className="onboarding-review-note" role="note" aria-label={t.previousAria}>{account.identity === "local"
              ? t.previousLocal
              : t.previousAccount}</p>}
            {submitError && <p className="onboarding-error" role="alert">{t.submitError}</p>}
            <div className="onboarding-actions"><button className="onboarding-secondary" type="button" onClick={() => { setSubmitError(false); setStep(2); }} disabled={submitting}>{t.edit}</button><button className="onboarding-primary" type="submit" disabled={submitting}>{submitting ? t.starting : t.prepareTeam}<span aria-hidden="true">→</span></button></div>
          </form>}
        </section>
      </div>
    </main>
  );
}
