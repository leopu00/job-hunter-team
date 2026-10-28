import { Fragment, FormEvent, KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Locale } from "@/i18n/config";
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
import { describeError, errorCodeOf, type DescribedError } from "../lib/error-catalog";
import { cleanImagesResult } from "../lib/clean-images";
import { appLocale } from "../lib/app-locale";
import { runtimeText } from "../lib/onboarding-runtime.i18n";
import VpsProfileImport from "./VpsProfileImport";
import CloserDesktopPanel from "../closer-desktop/CloserDesktopPanel";
import FirstSetupAssistance from "./FirstSetupAssistance";
import { ASSISTANCE_TEXT } from "./assistance.i18n";
import { LOGIN_TEXT } from "../components/login-screen.i18n";
import { fill } from "../lib/text-slots";
import { ONBOARDING_TEXT, type OnboardingCopy } from "./onboarding.i18n";
import { WINDOWS_SETUP } from "./windows-setup";
import { savedVpsBridge, type SavedVps } from "../lib/saved-vps";
import { SetupSupportReport } from "./SetupSupportReport";
import RuntimePhaseDetail, { pullBar } from "./RuntimePhaseDetail";
import PlanChoice from "./PlanChoice";
import "./onboarding.css";

function emptyVpsHost(): ExecutionHost {
  return { kind: "vps", address: "", user: "", port: 22, keyPath: "" };
}
const COLLECTION_STEP_COUNT = 4;

// Codex is the only provider the onboarding offers (0.4: one subscription, ChatGPT's): already chosen, and
// labelled as recommended. A team already on Claude Code keeps working; it is just not offered again.
const PROPOSED_PROVIDER: SubscriptionProvider = "codex";
// Product names and plans: the same in every language.
function providers(t: OnboardingCopy): Array<{ value: SubscriptionProvider; label: string; vendor: string; mark: string; recommended?: string }> {
  return [
    { value: "codex", label: "Codex", vendor: "OpenAI · ChatGPT Plus/Pro", mark: "CX", recommended: t.providerRecommended },
  ];
}
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

/** The notice of a Podman machine that has less memory than the team needs (the Mac setup sends it, the log has install.sh's own warning). */
const MACHINE_MEMORY_NOTICE = "ui_notice_podman_machine_memory_low";

/**
 * What the setup said and the person should know (install.ps1's notices, the autostart that did not hold): shown in every view of the setup, not only while a step runs.
 * The notice of a machine with too little memory carries the same recreation as the folders error, with the same confirmation:
 * the machine is never resized or deleted by itself.
 */
function SetupNotices({ notices, t, locale, onRecreate, locked }: {
  notices: readonly string[] | undefined;
  t: OnboardingCopy;
  locale: Locale;
  /** Absent where the machine cannot be recreated from here (a VPS, the Windows runtime). */
  onRecreate?: () => Promise<void>;
  /** A step is running: recreating now would pull the machine from under it. */
  locked?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  if (!notices?.length) return null;
  const memoryNotice = runtimeText(MACHINE_MEMORY_NOTICE, locale);
  const recreateConfirm = describeError("podman_machine_recreate_confirm", { locale });
  async function recreate() {
    if (!onRecreate || pending) return;
    setPending(true);
    try { await onRecreate(); } catch { /* the setup shows the failure it ends with */ } finally {
      setPending(false);
      setConfirming(false);
    }
  }
  return (
    <div className="onboarding-runtime-notice" role="note">
      <span className="onboarding-runtime-notice__mark" aria-hidden="true">!</span>
      <div>
        {notices.map((notice) => <p key={notice}>{notice}</p>)}
        {onRecreate && !locked && memoryNotice !== null && notices.includes(memoryNotice) && (
          <div data-testid="machine-memory-recreate">
            {confirming && (
              <section className="onboarding-provider-console" aria-label={t.recreateAria}>
                <div className="onboarding-provider-console__heading"><div><strong>{t.recreateTitle}</strong><small>{t.recreateText}</small><small>{recreateConfirm.text}</small><small>{recreateConfirm.action}</small></div></div>
              </section>
            )}
            {!confirming && (
              <button className="onboarding-secondary" type="button" onClick={() => setConfirming(true)} disabled={pending}>{t.recreate}</button>
            )}
            {confirming && (
              <>
                <button className="onboarding-secondary" type="button" onClick={() => setConfirming(false)} disabled={pending}>{t.cancel}</button>
                <button className="onboarding-primary" type="button" onClick={() => void recreate()} disabled={pending}>
                  {pending ? t.recreating : t.recreateYes}<span aria-hidden="true">→</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// A Windows path has no spaces: the line may break after a separator instead of in the middle of a folder name.
function PathWithBreaks({ path }: { path: string }) {
  return <>{(path.match(/[^\\/]*[\\/]?/g)?.filter(Boolean) ?? [path]).map((part, index) => <Fragment key={index}>{index > 0 && <wbr />}{part}</Fragment>)}</>;
}

function RuntimeView({ host, platform, t, locale, runtime, activity, onRetry, onRestart, onExitFailure, onRuntimeAction, providerLogin, sshHostKey, onConfirmHostKey, onCancelHostKey, onProviderInput, onProviderClose, onProviderRestart, onRecreatePodmanMachine, onUseLocalData, onSetAsideLocalData, onFreeDiskSpace, onLoadPlans, onDeclarePlan, runtimeLogPath, onOpenRuntimeLog, onOpenWithoutTeam }: Pick<OnboardingFlowProps, "platform" | "runtime" | "activity" | "onRetry" | "onRestart" | "onExitFailure" | "onRuntimeAction" | "providerLogin" | "sshHostKey" | "onConfirmHostKey" | "onCancelHostKey" | "onProviderInput" | "onProviderClose" | "onProviderRestart" | "onRecreatePodmanMachine" | "onUseLocalData" | "onSetAsideLocalData" | "onFreeDiskSpace" | "onLoadPlans" | "onDeclarePlan" | "runtimeLogPath" | "onOpenRuntimeLog" | "onOpenWithoutTeam"> & { host: ExecutionHost; t: OnboardingCopy; locale: Locale }) {
  const [pending, setPending] = useState(false);
  const [confirmingRecreate, setConfirmingRecreate] = useState(false);
  const [confirmingFreeSpace, setConfirmingFreeSpace] = useState(false);
  // The choice for data no profile has taken: which one is being confirmed, and what it said.
  const [confirmingData, setConfirmingData] = useState<"use" | "aside" | null>(null);
  const [dataResult, setDataResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [freeSpaceResult, setFreeSpaceResult] = useState<DescribedError | null>(null);
  const [actionFailed, setActionFailed] = useState(false);
  // The plan is still to be chosen: the team does not start before the person chooses it or leaves it to the chat.
  const [planBlocked, setPlanBlocked] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const pendingRef = useRef(false);
  // Which call of `invoke` is the latest: a screen that changed ends the calls started before it, so one that
  // returns late cannot free (or keep) the guard of a newer one.
  const invokeToken = useRef(0);
  const failureHeadingRef = useRef<HTMLHeadingElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const focusedFailureKeyRef = useRef<string | null>(null);
  const failureKey = runtime.status === "failed" ? `${runtime.stage}:${runtime.code ?? "unknown"}` : null;

  useEffect(() => {
    // A new screen: its buttons work at the first click, even if the retry that led here has not returned yet.
    invokeToken.current += 1;
    pendingRef.current = false;
    setPending(false);
    setActionFailed(false);
    setConfirmingRecreate(false);
    setConfirmingFreeSpace(false);
    setFreeSpaceResult(null);
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

  // When the person has to act (confirm the fingerprint, sign in, start the
  // team) the button is at the bottom of a tall page: bring it into view, or
  // a tester in a 660 px window sees «action required» and nothing to press.
  const actionKey = runtime.status === "action-required" ? `${runtime.stage}:${sshHostKey ? "key" : ""}` : null;
  useEffect(() => {
    if (!actionKey) return;
    actionsRef.current?.scrollIntoView?.({ block: "end", behavior: "smooth" });
  }, [actionKey]);

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
          <SetupNotices notices={activity?.notices} t={t} locale={locale} onRecreate={host.kind === "local" ? onRecreatePodmanMachine : undefined} locked={false} />
        </section>
      </main>
    );
  }
  if (runtime.status === "collecting") return null;

  const failed = runtime.status === "failed";
  // A failed step that is only waiting for the person (the team runs, stop it first): same card, calm tone.
  const calm = runtime.status === "failed" && runtime.calm === true;
  const actionRequired = runtime.status === "action-required";
  const visibleRuntimeStages = runtimeStages(host, t);
  const activeIndex = visibleRuntimeStages.findIndex((stage) => stage.value === runtime.stage);
  const activeLabel = visibleRuntimeStages[activeIndex]?.label ?? t.configuration;
  const failureTitle = failed && runtime.title ? runtime.title : t.configureAgain(activeLabel);
  // A stopped runtime is not «ready»: the Runtime and Container steps say so until the start wakes them.
  const runtimeStopped = runtime.status === "action-required" && runtime.runtimeStopped === true;
  const isStoppedStep = (value: string) => runtimeStopped && (value === "runtime" || value === "container");
  const stoppedBefore = visibleRuntimeStages.slice(0, Math.max(0, activeIndex)).filter((stage) => isStoppedStep(stage.value)).length;
  const completedSteps = Math.max(0, activeIndex) - stoppedBefore;
  // A preparation that failed after part of it was done: trying again runs the same preparation, which
  // checks what is already there, so it is offered as «Resume» and says what is already in place.
  const resumable = failed && runtime.retryable !== false &&
    (completedSteps > 0 || !!activity?.events.some((event) => event.status === "completed"));
  // After the provider's login, before the team starts: the plan the Capitano's first run needs is chosen here.
  const planAsked = runtime.stage === "team-start" && actionRequired && !!onLoadPlans && !!onDeclarePlan;
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
            <SetupNotices notices={activity?.notices} t={t} locale={locale} onRecreate={host.kind === "local" ? onRecreatePodmanMachine : undefined} locked={runtime.status === "working"} />
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
    const mine = ++invokeToken.current;
    setPending(true); setActionFailed(false);
    try { await action(); } catch { if (reportFailure && invokeToken.current === mine) setActionFailed(true); } finally {
      if (invokeToken.current === mine) {
        pendingRef.current = false;
        setPending(false);
      }
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
  // «Free up space» on a full disk: only after a confirmation, never on
  // Windows' own runtime (jht.ps1 has no cleaning command yet).
  const freeDiskSpace = failed && runtime.code === "disk_low" && !(platform === "windows" && host.kind === "local")
    ? onFreeDiskSpace
    : undefined;
  // Data in ~/.jht that no profile has taken: never a dead end. «Use» only for a local profile
  // (it makes the data theirs), «set aside» for both; each one only after a confirmation.
  const dataChoice = failed && runtime.code === "local_account_owner_missing" && host.kind === "local";
  const adoptLocalData = dataChoice ? onUseLocalData : undefined;
  const setAsideLocalData = dataChoice ? onSetAsideLocalData : undefined;
  async function chooseData(choice: "use" | "aside") {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true); setDataResult(null);
    let done = false;
    try {
      if (choice === "use") {
        await adoptLocalData?.();
      } else {
        const folder = await setAsideLocalData?.();
        // Where the data went stays on screen while the setup starts again.
        if (folder) setDataResult({ ok: true, text: t.dataAsideDone.replace("{folder}", folder) });
      }
      done = true;
    } catch (error) {
      const { text, action } = describeError(errorCodeOf(error), { locale, fallback: "local_data_set_aside_failed" });
      setDataResult({ ok: false, text: `${text} ${action}` });
    } finally {
      setConfirmingData(null);
      pendingRef.current = false;
      setPending(false);
    }
    // The setup starts again; what it finds is its own to say.
    if (done) await onRetry().catch(() => setActionFailed(true));
  }
  const freeSpaceConfirm = describeError(
    platform === "macos" && host.kind === "local" ? "clean_images_confirm_vm" : "clean_images_confirm", { locale });
  async function freeSpace() {
    if (!freeDiskSpace || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true); setConfirmingFreeSpace(false); setFreeSpaceResult(null);
    try {
      const { code, bytes } = cleanImagesResult(await freeDiskSpace());
      setFreeSpaceResult(describeError(code, { locale, bytes }));
    } catch (error) {
      setFreeSpaceResult(describeError(errorCodeOf(error), { locale, fallback: "clean_images_failed" }));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  // the retry of a failed step is told the same wherever it is offered
  const retryLabel = pending ? t.verifying : resumable ? t.resumeSetup : t.retryPrepare;
  const action = failed
    ? onRetry
    : runtime.stage === "ssh-host-key" ? onConfirmHostKey : () => onRuntimeAction(runtime.stage as "provider-login" | "team-start" | "assistant");
  // The reason is the catalog's sentence for the failure's code. When a step failed it sits right
  // under the title, above the artwork and the step list, so it is read before anything else.
  const status = (
    <div
      className="onboarding-runtime-status"
      aria-live={failed ? undefined : "polite"}
      role={failed ? "alert" : "status"}
    >
      <span className="onboarding-runtime-status__pulse" aria-hidden="true">{calm ? "→" : failed ? "!" : actionRequired ? "→" : "••"}</span>
      <div>
        {!failed && <strong>{actionRequired ? t.actionNeeded : t.dontClose}</strong>}
        <small>{runtime.message}</small>
        {failed && runtime.action && <small className="onboarding-runtime-status__action">{t.whatToDo(runtime.action)}</small>}
        {/* the retry also sits here, beside the reason and the log: the one under the step list is out of view in a short window */}
        {failed && runtime.retryable !== false && (
          <small className="onboarding-runtime-status__retry">
            <button className="onboarding-secondary" type="button" data-testid="onboarding-retry-here" onClick={() => void invoke(onRetry, false)} disabled={pending}>
              {retryLabel}
            </button>
          </small>
        )}
        {failed && host.kind === "local" && runtimeLogPath && (
          <small className="onboarding-runtime-status__log">
            {t.runtimeLogAt} <code><PathWithBreaks path={runtimeLogPath} /></code>{" "}
            {onOpenRuntimeLog && <button className="onboarding-secondary" type="button" onClick={() => void onOpenRuntimeLog()}>{t.openRuntimeLog}</button>}
          </small>
        )}
      </div>
    </div>
  );
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
        <section className={`onboarding-runtime-card${failed && !calm ? " onboarding-runtime-card--failed" : ""}`} aria-busy={pending}>
          <p className="onboarding-eyebrow">{calm ? t.yourTurn : failed ? t.interventionRequired : actionRequired ? t.yourTurn : t.inProgressEyebrow}</p>
          <h2
            ref={failureHeadingRef}
            tabIndex={failed ? -1 : undefined}
          >{failed ? failureTitle : actionRequired ? activeLabel : t.preparing(activeLabel)}</h2>
          {failed && status}
          {/* The recreation of the machine is the way out of this error: it sits right under the reason, not below the step list. */}
          {recreatePodmanMachine && (
            <div className="onboarding-runtime-recreate" data-testid="recreate-podman-machine">
              {confirmingRecreate && (
                <section className="onboarding-provider-console" aria-label={t.recreateAria}>
                  <div className="onboarding-provider-console__heading"><div><strong>{t.recreateTitle}</strong><small>{t.recreateText}</small><small>{recreateConfirm.text}</small><small>{recreateConfirm.action}</small></div></div>
                </section>
              )}
              <div className="onboarding-runtime-actions">
                {!confirmingRecreate && (
                  <button className="onboarding-primary" type="button" onClick={() => setConfirmingRecreate(true)} disabled={pending}>
                    {t.recreate}<span aria-hidden="true">→</span>
                  </button>
                )}
                {confirmingRecreate && (
                  <>
                    <button className="onboarding-secondary" type="button" onClick={() => setConfirmingRecreate(false)} disabled={pending}>{t.cancel}</button>
                    <button className="onboarding-primary" type="button" onClick={() => invoke(recreatePodmanMachine, false)} disabled={pending}>
                      {pending ? t.recreating : t.recreateYes}<span aria-hidden="true">→</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          <SetupNotices notices={activity?.notices} t={t} locale={locale} onRecreate={host.kind === "local" ? onRecreatePodmanMachine : undefined} locked={runtime.status === "working"} />
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
            {runtime.status === "working" && currentActivity && (
              <RuntimePhaseDetail
                t={t}
                locale={locale}
                info={currentActivity}
                phaseKey={currentActivity.phase ?? currentActivity.description}
                now={now}
              />
            )}
            {runtime.status === "working" && !(currentActivity && pullBar(currentActivity)) && (
              <div
                className="onboarding-runtime-progress__indeterminate"
                role="progressbar"
                aria-label={t.progressOf(currentActivityName ?? activeLabel)}
                aria-valuetext={t.percentUnknown}
              ><i /></div>
            )}
          </section>
          {!failed && status}
          <ol className="onboarding-runtime-track">
            {visibleRuntimeStages.map((stage, index) => {
              const stopped = index < activeIndex && isStoppedStep(stage.value);
              return (
                <li key={stage.value} className={stopped ? "is-stopped" : index < activeIndex ? "is-complete" : index === activeIndex ? "is-active" : undefined}>
                  <span>{index < activeIndex && !stopped ? "✓" : index + 1}</span><div><strong>{stage.label}</strong><small>{stage.detail}</small></div>
                  <em>{stopped ? t.trackStopped : index < activeIndex ? t.trackReady : index === activeIndex ? failed ? t.trackRetry : actionRequired ? t.trackWaiting : t.trackRunning : t.trackQueued}</em>
                </li>
              );
            })}
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
          {failed && (runtime.code || runtime.cause) && (
            <details className="onboarding-activity-details onboarding-technical-details">
              <summary>{t.technicalDetails}</summary>
              <dl>
                {runtime.code && <div><dt>{t.code}</dt><dd><code>{runtime.code}</code></dd></div>}
                {runtime.cause && <div><dt>{t.technicalCause}</dt><dd><code>{runtime.cause}</code></dd></div>}
              </dl>
            </details>
          )}
          {failed && <SetupSupportReport stage={runtime.stage} code={runtime.code} locale={locale} />}
          {runtime.stage === "ssh-host-key" && sshHostKey && (
            <section className="onboarding-provider-console" aria-label={t.hostKeyAria}>
              <div className="onboarding-provider-console__heading"><div><strong>{t.hostKeyTitle}</strong><small>{t.hostKeyText}</small></div></div>
              <dl className="onboarding-review">
                <div><dt>{t.algorithm}</dt><dd>{sshHostKey.algorithm}</dd></div>
                <div><dt>{t.fingerprint}</dt><dd>{sshHostKey.fingerprint}</dd></div>
              </dl>
            </section>
          )}
          {confirmingData === "use" && adoptLocalData && (
            <section className="onboarding-provider-console" aria-label={t.dataUseAria}>
              <div className="onboarding-provider-console__heading"><div><strong>{t.dataUseTitle}</strong><small>{t.dataUseText}</small></div></div>
            </section>
          )}
          {confirmingData === "aside" && setAsideLocalData && (
            <section className="onboarding-provider-console" aria-label={t.dataAsideAria}>
              <div className="onboarding-provider-console__heading"><div><strong>{t.dataAsideTitle}</strong><small>{t.dataAsideText}</small></div></div>
            </section>
          )}
          {dataResult && <p className={dataResult.ok ? "onboarding-free-space" : "onboarding-error"} role={dataResult.ok ? "status" : "alert"} data-testid="local-data-result">{dataResult.text}</p>}
          {freeDiskSpace && confirmingFreeSpace && (
            <section className="onboarding-provider-console" aria-label={t.freeSpaceAria}>
              <div className="onboarding-provider-console__heading"><div><strong>{t.freeSpaceTitle}</strong><small>{freeSpaceConfirm.text}</small><small>{freeSpaceConfirm.action}</small></div></div>
            </section>
          )}
          {freeSpaceResult && <p className="onboarding-free-space" role="status">{freeSpaceResult.text} {freeSpaceResult.action}</p>}
          {actionFailed && <p className="onboarding-error" role="alert">{t.actionFailed}</p>}
          {failed && runtime.retryable === false && !runtime.action && runtime.code !== "container_version_incompatible" && <p className="onboarding-error">{t.fixData}</p>}
          {resumable && <p className="onboarding-hint" data-testid="onboarding-resume-note">{t.resumeNote}</p>}
          {planAsked && onLoadPlans && onDeclarePlan && <PlanChoice t={t} load={onLoadPlans} declare={onDeclarePlan} onBlock={setPlanBlocked} />}
          <div className="onboarding-runtime-actions" ref={actionsRef}>
            {!failed && <button className="onboarding-secondary" type="button" onClick={() => invoke(onRestart)} disabled={pending}>
              {t.restart}
            </button>}
            {failed && (
              <button className="onboarding-secondary" type="button" onClick={onExitFailure} disabled={pending}>
                {t.backToHost}
              </button>
            )}
            {/* The team cannot start (a provider limit) or waits to be started: the app can open without it, the setup stays unfinished */}
            {onOpenWithoutTeam && runtime.stage === "team-start" && (actionRequired || failed) && (
              <button className="onboarding-secondary" type="button" data-testid="open-without-team" onClick={onOpenWithoutTeam} disabled={pending}>
                {t.openWithoutTeam}
              </button>
            )}
            {(adoptLocalData || setAsideLocalData) && confirmingData === null && (
              <>
              {setAsideLocalData && <button className="onboarding-secondary" type="button" data-testid="local-data-aside" onClick={() => setConfirmingData("aside")} disabled={pending}>{t.dataAside}</button>}
              {adoptLocalData && <button className="onboarding-primary" type="button" data-testid="local-data-use" onClick={() => setConfirmingData("use")} disabled={pending}>{t.dataUse}<span aria-hidden="true">→</span></button>}
              </>
            )}
            {confirmingData !== null && (
              <>
              <button className="onboarding-secondary" type="button" data-testid="local-data-cancel" onClick={() => setConfirmingData(null)} disabled={pending}>{t.cancel}</button>
              <button className="onboarding-primary" type="button" data-testid="local-data-confirm" onClick={() => void chooseData(confirmingData)} disabled={pending}>
                {pending ? t.dataBusy : confirmingData === "use" ? t.dataUseYes : t.dataAsideYes}<span aria-hidden="true">→</span>
              </button>
              </>
            )}
            {freeDiskSpace && !confirmingFreeSpace && (
              <button className="onboarding-secondary" type="button" onClick={() => setConfirmingFreeSpace(true)} disabled={pending}>
                {pending ? t.freeSpacing : t.freeSpace}
              </button>
            )}
            {freeDiskSpace && confirmingFreeSpace && (
              <>
              <button className="onboarding-secondary" type="button" onClick={() => setConfirmingFreeSpace(false)} disabled={pending}>{t.cancel}</button>
              <button className="onboarding-primary" type="button" onClick={() => void freeSpace()} disabled={pending}>
                {t.freeSpaceYes}<span aria-hidden="true">→</span>
              </button>
              </>
            )}
            {((failed && runtime.retryable !== false) || actionRequired) && (
              <>
              {runtime.stage === "ssh-host-key" && !failed && <button className="onboarding-secondary" type="button" onClick={onCancelHostKey} disabled={pending}>{t.cancel}</button>}
              <button className="onboarding-primary" type="button" onClick={() => invoke(action, !failed)} disabled={pending || (planAsked && planBlocked)}>
                {pending ? failed ? t.verifying : t.wait : failed ? resumable ? t.resumeSetup : t.retryPrepare : actionLabel}<span aria-hidden="true">→</span>
              </button>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export function OnboardingFlow({ account, onRenameLocalProfile, platform, runtime, activity, onSubmit, onConnectExistingTeam, onSignInWithGoogle, onRetry, onRestart, onExitFailure, onRuntimeAction, providerLogin, sshHostKey, onConfirmHostKey, onCancelHostKey, onProviderInput, onProviderClose, onProviderRestart, onRecreatePodmanMachine, onUseLocalData, onSetAsideLocalData, onFreeDiskSpace, onLoadPlans, onDeclarePlan, runtimeLogPath, onOpenRuntimeLog, onOpenWithoutTeam, previousLocalData = false, interruption, onResumeInterrupted, onDiscardInterruption, providerOnly, locale: localeOverride }: OnboardingFlowProps) {
  const locale = localeOverride ?? appLocale();
  const t = ONBOARDING_TEXT[locale];
  const providerChoices = providers(t);
  const selectableProviders = providerChoices.map(({ value }) => value);
  const interruptionCause = interruption?.code ? describeError(interruption.code, { locale }) : null;
  const interruptionReason = interruptionCause?.known ? interruptionCause.text : t.interruptedUnknown;
  // Windows runs the team locally too, with Podman inside WSL.
  const localRuntimeSupported = platform === "macos" || platform === "linux" || platform === "windows";
  const [step, setStep] = useState(providerOnly ? 2 : 0);
  const [host, setHost] = useState<ExecutionHost>(() => localRuntimeSupported ? { kind: "local" } : emptyVpsHost());
  const [provider, setProvider] = useState<SubscriptionProvider | null>(providerOnly ? null : PROPOSED_PROVIDER);
  const [submitting, setSubmitting] = useState(false);
  const [assistanceOpen, setAssistanceOpen] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [profileName, setProfileName] = useState(account.displayName ?? "");
  const [savedVps, setSavedVps] = useState<SavedVps[]>([]);
  const [savingVps, setSavingVps] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shellRef = useRef<HTMLElement>(null);

  useEffect(() => { setProfileName(account.displayName ?? ""); }, [account.displayName]);
  useEffect(() => { void Promise.resolve().then(() => savedVpsBridge.list()).then((list) => setSavedVps(Array.isArray(list) ? list : [])).catch(() => setSavedVps([])); }, []);

  useEffect(() => {
    if (!localRuntimeSupported) {
      setHost((current) => current.kind === "vps" ? current : emptyVpsHost());
    }
  }, [localRuntimeSupported]);

  useLayoutEffect(() => {
    // Focus must not scroll the heading into the bottom of the old viewport.
    // Reset the real scroll owners, including the document on the short window.
    headingRef.current?.focus({ preventScroll: true });
    for (let node: HTMLElement | null = shellRef.current; node; node = node.parentElement) {
      node.scrollTop = 0;
      node.scrollLeft = 0;
    }
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [step, assistanceOpen]);

  if (runtime.status !== "collecting") return <RuntimeView host={host} platform={platform} t={t} locale={locale} runtime={runtime} activity={activity} onRetry={onRetry} onRestart={onRestart} onExitFailure={exitFailure} onRuntimeAction={onRuntimeAction} providerLogin={providerLogin} sshHostKey={sshHostKey} onConfirmHostKey={onConfirmHostKey} onCancelHostKey={onCancelHostKey} onProviderInput={onProviderInput} onProviderClose={onProviderClose} onProviderRestart={onProviderRestart} onRecreatePodmanMachine={onRecreatePodmanMachine} onUseLocalData={account.identity === "local" ? onUseLocalData : undefined} onSetAsideLocalData={onSetAsideLocalData} onFreeDiskSpace={onFreeDiskSpace} onLoadPlans={onLoadPlans} onDeclarePlan={onDeclarePlan} runtimeLogPath={runtimeLogPath} onOpenRuntimeLog={onOpenRuntimeLog} onOpenWithoutTeam={onOpenWithoutTeam} />;

  if (assistanceOpen) return <main className="onboarding-shell" ref={shellRef} lang={locale}>
    <h1 ref={headingRef} tabIndex={-1}>{t.firstSetupTitle}</h1>
    <button className="onboarding-secondary" type="button" onClick={() => setAssistanceOpen(false)}>{ASSISTANCE_TEXT[locale].back}</button>
    <CloserDesktopPanel onClose={() => setAssistanceOpen(false)} />
  </main>;

  // A team on a VPS pairs with the account: a local profile has none, so the step says so now
  // instead of starting a setup that fails at the runtime stage (pairing_token_missing).
  const vpsNeedsAccount = account.identity === "local" && host.kind === "vps";
  // What a VPS still lacks before Continue works, in the words of the form, so a disabled button says why.
  // Also with a local profile: the Google note below says why the account matters, not what the form lacks.
  const missingVps = host.kind === "vps"
    ? ([
        !host.address.trim() && t.vpsMissingItems.address,
        !host.user.trim() && t.vpsMissingItems.user,
        !(host.port > 0 && host.port <= 65535) && t.vpsMissingItems.port,
        !host.keyPath.trim() && t.vpsMissingItems.key,
      ].filter(Boolean) as string[])
    : [];
  const hostIsValid = (localRuntimeSupported && host.kind === "local") ||
    (host.kind === "vps" && !vpsNeedsAccount && Boolean(host.address.trim() && host.user.trim() && host.port > 0 && host.port <= 65535 && host.keyPath.trim()));

  function selectHost(kind: ExecutionHost["kind"]) {
    setHost((current) => current.kind === kind ? current : kind === "local" ? { kind } : emptyVpsHost());
  }
  async function saveVps() {
    if (host.kind !== "vps" || savingVps || !host.address.trim() || !host.user.trim() || !host.keyPath.trim()) return;
    setSavingVps(true);
    try {
      const saved = await savedVpsBridge.add({ name: host.address.trim(), address: host.address.trim(), user: host.user.trim(), port: host.port, keyPath: host.keyPath.trim() });
      setSavedVps((current) => [...current, saved]);
    } finally { setSavingVps(false); }
  }

  function next(event: FormEvent) {
    event.preventDefault();
    if (step === 0 && account.identity === "local" && onRenameLocalProfile && profileName.trim() && profileName.trim() !== account.displayName) onRenameLocalProfile(profileName);
    setSubmitError(false); setStep((current) => Math.min(current + 1, COLLECTION_STEP_COUNT - 1));
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
    setStep(providerOnly ? 2 : 1);
    setSubmitError(false);
    onExitFailure();
  }

  return (
    <main className="onboarding-shell" ref={shellRef} lang={locale}>
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
            {/* no Settings bar yet: backup and export work on the team's database, so say when they open */}
            <small className="onboarding-hint" data-testid="backup-export-note">{t.backupExportNote}</small>
            {account.identity === "local" && onRenameLocalProfile && <label className="onboarding-field onboarding-field--full"><span>{t.profileName}</span><input aria-label={t.profileName} value={profileName} maxLength={80} onChange={(event) => setProfileName(event.target.value)} onBlur={() => {
              if (profileName.trim() && profileName.trim() !== account.displayName) onRenameLocalProfile(profileName);
            }} required /><small className="onboarding-hint">{t.profileNameHint}</small></label>}
            {interruption && onResumeInterrupted && <div className="onboarding-aside" role="note" data-testid="onboarding-interrupted">
              <strong>{t.interruptedTitle}</strong>
              <p>{fill(t.interruptedText, {
                date: new Date(interruption.at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }),
                reason: interruptionReason,
              })}</p>
              <div className="onboarding-actions">
                <button className="onboarding-secondary" type="button" onClick={() => onDiscardInterruption?.()}>{t.startOver}</button>
                <button className="onboarding-primary" type="button" onClick={() => void onResumeInterrupted()}>{t.resumeSetup} <span aria-hidden="true">→</span></button>
              </div>
            </div>}
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
              {localRuntimeSupported && <button data-radio-value="local" tabIndex={host.kind === "local" ? 0 : -1} className={`onboarding-choice${host.kind === "local" ? " is-selected" : ""}`} type="button" role="radio" aria-checked={host.kind === "local"} onKeyDown={(event) => moveRadio(event, ["local", "vps"] as const, host.kind, selectHost)} onClick={() => selectHost("local")}><span className="onboarding-choice__icon">PC</span><strong>{t.thisComputer}</strong><small>{platform === "windows" ? t.thisComputerWindows : t.thisComputerOther}</small><span className="onboarding-choice__check">✓</span></button>}
              <button data-radio-value="vps" tabIndex={host.kind === "vps" || !localRuntimeSupported ? 0 : -1} className={`onboarding-choice${host.kind === "vps" ? " is-selected" : ""}`} type="button" role="radio" aria-checked={host.kind === "vps"} onKeyDown={(event) => moveRadio(event, localRuntimeSupported ? ["local", "vps"] as const : ["vps"] as const, host.kind, selectHost)} onClick={() => selectHost("vps")}><span className="onboarding-choice__icon">VPS</span><strong>{t.vpsServer}</strong><small>{t.vpsDetail}</small><span className="onboarding-choice__check">✓</span></button>
            </div>
            {host.kind === "vps" && <div className="onboarding-fields onboarding-vps-fields">
              {savedVps.length > 0 && <label className="onboarding-field onboarding-field--full"><span>{t.savedVps}</span><select aria-label={t.savedVps} defaultValue="" onChange={(event) => {
                const saved = savedVps.find((row) => row.id === event.target.value);
                if (saved) setHost({ kind: "vps", address: saved.address, user: saved.user, port: saved.port, keyPath: saved.keyPath });
              }}><option value="">{t.chooseSavedVps}</option>{savedVps.map((saved) => <option key={saved.id} value={saved.id}>{saved.name}</option>)}</select></label>}
              <label className="onboarding-field onboarding-field--full"><span>{t.vpsAddress}</span><input value={host.address} onChange={(event) => setHost({ ...host, address: event.target.value })} placeholder={t.vpsAddressPlaceholder} required /></label>
              <label className="onboarding-field"><span>{t.sshUser}</span><input placeholder={t.sshUserPlaceholder} autoCapitalize="off" autoCorrect="off" spellCheck={false} value={host.user} onChange={(event) => setHost({ ...host, user: event.target.value })} required /></label>
              <label className="onboarding-field"><span>{t.sshPort}</span><input type="number" min="1" max="65535" value={host.port} onChange={(event) => setHost({ ...host, port: Number(event.target.value) })} required /></label>
              <div className="onboarding-field onboarding-field--full"><span>{t.sshKey}</span><SshKeyPicker value={host.keyPath} onChange={(keyPath) => setHost({ ...host, keyPath })} disabled={submitting} /><small className="onboarding-hint">{t.sshKeyHint}</small></div>
              <button type="button" className="onboarding-secondary" onClick={() => void saveVps()} disabled={savingVps || !host.address.trim() || !host.user.trim() || !host.keyPath.trim()}>{t.saveVps}</button>
            </div>}
            {missingVps.length > 0 && <p className="onboarding-hint" id="onboarding-vps-missing" role="status">
              {fill(t.vpsMissing, { list: new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(missingVps) })}
            </p>}
            {vpsNeedsAccount && <div className="onboarding-aside" role="note" id="onboarding-vps-account">
              <p>{t.vpsNeedsGoogle}</p>
              {onSignInWithGoogle && <button className="onboarding-secondary" type="button" onClick={() => void onSignInWithGoogle()}>{LOGIN_TEXT[locale].google}</button>}
            </div>}
            <div className="onboarding-actions"><button className="onboarding-secondary" type="button" onClick={() => setStep(0)}>{t.back}</button><button className="onboarding-primary" type="submit" disabled={!hostIsValid} aria-describedby={[missingVps.length > 0 && "onboarding-vps-missing", vpsNeedsAccount && "onboarding-vps-account"].filter(Boolean).join(" ") || undefined}>{t.continue} <span aria-hidden="true">→</span></button></div>
          </form>
          {host.kind === "vps" && onConnectExistingTeam && <section className="onboarding-aside" aria-label={t.existingTeam.title}>
            <h3>{t.existingTeam.title}</h3>
            <p>{t.existingTeam.description}</p>
            <button type="button" className="onboarding-secondary" onClick={() => onConnectExistingTeam(host)}>{t.existingTeam.verifyVps}</button>
          </section>}
          {host.kind === "vps" && <FirstSetupAssistance host={host} locale={locale} onOpen={() => setAssistanceOpen(true)} />}
          {account.identity === "local" && host.kind === "local" && <VpsProfileImport />}
          </>}

          {step === 2 && <form onSubmit={next} className="onboarding-panel">
            <OnboardingArtwork name={collectionArtwork(step, host)} />
            <p className="onboarding-eyebrow">{t.providerEyebrow}</p><h2 ref={headingRef} tabIndex={-1}>{t.providerTitle}</h2><p className="onboarding-lede">{t.providerLede}</p>
            <div className="onboarding-choice-grid onboarding-choice-grid--providers" role="radiogroup" aria-label={t.providerGroupAria}>
              {providerChoices.map((item, index) => <button key={item.value} data-radio-value={item.value} tabIndex={provider === item.value || (provider === null && index === 0) ? 0 : -1} className={`onboarding-choice${provider === item.value ? " is-selected" : ""}`} type="button" role="radio" aria-checked={provider === item.value} onKeyDown={(event) => moveRadio(event, selectableProviders, provider, setProvider)} onClick={() => setProvider(item.value)}><span className="onboarding-choice__icon">{item.mark}</span><strong>{item.label}{item.recommended && <span className="onboarding-choice__badge">{item.recommended}</span>}</strong><small>{item.vendor}</small><span className="onboarding-choice__check">✓</span></button>)}
            </div>
            <p className="onboarding-subscription-note"><strong>{t.subscriptionStrong}</strong> {t.subscriptionText}</p>
            <div className="onboarding-actions"><button className="onboarding-secondary" type="button" onClick={() => providerOnly ? providerOnly.onCancel() : setStep(1)}>{providerOnly ? t.cancel : t.back}</button><button className="onboarding-primary" type="submit" disabled={!provider}>{t.reviewSetup} <span aria-hidden="true">→</span></button></div>
          </form>}

          {step === 3 && provider && <form onSubmit={finish} className="onboarding-panel">
            <OnboardingArtwork name={collectionArtwork(step, host)} />
            <p className="onboarding-eyebrow">{t.reviewEyebrow}</p><h2 ref={headingRef} tabIndex={-1}>{t.reviewTitle}</h2><p className="onboarding-lede">{t.reviewLede}</p>
            <dl className="onboarding-review">
              <div><dt>{t.environment}</dt><dd>{hostName(host, t)}</dd></div><div><dt>{t.provider}</dt><dd>{providerName(provider, t)}<small>{t.viaSubscription}</small></dd></div>
            </dl>
            {!providerOnly && host.kind === "local" && platform === "windows" && <div className="onboarding-review-note" role="note" aria-label={t.installsAria}>
              <p>{t.installsIntro}</p>
              <ul>{t.installs(WINDOWS_SETUP).map((item) => <li key={item}>{item}</li>)}</ul>
              <p>{t.installsRemoval}</p>
            </div>}
            {!providerOnly && host.kind === "local" && previousLocalData && <p className="onboarding-review-note" role="note" aria-label={t.previousAria}>{account.identity === "local"
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
