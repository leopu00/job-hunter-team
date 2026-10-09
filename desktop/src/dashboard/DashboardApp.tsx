import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import DashboardSkeleton from "@/app/(protected)/_components/DashboardSkeleton";
import { appLocale } from "../lib/app-locale";
import { LOCAL_RUNTIME_REMOVED_EVENT } from "../lib/local-uninstall";
import { failureText, stateText } from "../lib/onboarding-state.i18n";
import { readDesktopPlatform, type DesktopPlatform } from "../lib/desktop-platform";
import {
  connectDirectChat,
  directChatStatus,
  reconnectDirectChat,
} from "../lib/direct-chat";
import {
  activateDesktopAccountScope,
  activateDesktopLocalScope,
  clearDesktopAccountScope,
  migrateDesktopLocalProfileToAccount,
  probeDesktopLocalProfileMigration,
} from "../lib/desktop-account-scope";
import {
  activateSavedLocalProfile,
  clearLocalIdentitySelection,
  finalizeLocalProfileMigration,
  localIdentitySelected,
  readLocalProfile,
} from "../lib/local-profile";
import { clearGoogleIdentitySelection, googleIdentitySelected } from "../lib/identity-choice";
import type { ExistingTeamConnectionResult } from "../lib/existing-team";
import {
  isOnboardingAssistantReachable,
  isOnboardingRuntimeReady,
  loadLocalOnboardingGate,
  loadOnboardingGate,
  markOnboardingReady,
  markOnboardingStarted,
  resetOnboardingMarker,
  runtimeStateFromSnapshot,
  type OnboardingActivityState,
  type OnboardingGateState,
  type OnboardingProviderLoginAction,
  type OnboardingProviderLoginState,
  type OnboardingRuntimeStage,
  type OnboardingRuntimeState,
  type OnboardingRuntimeSnapshot,
  type OnboardingSshHostKeyConfirmation,
  type OnboardingSubmission,
} from "../lib/onboarding";
import {
  closeOnboardingProviderLogin,
  confirmOnboardingSshHostKey,
  openOnboardingAssistant,
  prepareOnboardingRuntime,
  probeOnboardingSshHostKey,
  readOnboardingSnapshot,
  readPreviousLocalData,
  recreateOnboardingPodmanMachine,
  resumeOnboardingSnapshot,
  resumeOnboardingTeamStart,
  sendOnboardingProviderInput,
  startOnboardingProviderLogin,
  startOnboardingTeam,
  type OnboardingNativeProgress,
} from "../lib/onboarding-runtime";
import {
  activityRuntimeStage,
  applyOnboardingProgress,
  beginOnboardingActivityInvocation,
  createOnboardingActivity,
} from "../lib/onboarding-activity";
import { DASHBOARD_PAGE, goTo, LOGIN_PAGE } from "../lib/pages";
import { supabase, supabaseConfig, useSession } from "../lib/supabase";
import { OnboardingFlow } from "../onboarding";
import ExistingTeamConnectModal from "../onboarding/ExistingTeamConnectModal";
import MessagesPage from "../pages/messages";
import Shell from "../shell/Shell";
import { navigate } from "../shell/router";
import { describeError, errorCodeOf, errorResetsAt } from "../lib/error-catalog";
import { openRuntimeLog, runtimeLogPath } from "../lib/runtime-log";


type LocalMigrationGate = {
  identityKey: string;
  profileId: string;
  phase: "checking" | "required" | "migrating" | "not-needed" | "completed" | "error";
  retryable?: boolean;
};

function migrationRetryable(error: unknown): boolean {
  return [
    "local_migration_storage_failed",
    "local_migration_owner_unavailable",
  ].includes(nativeErrorCode(error) ?? "");
}
const PROFILE_RECHECK_MS = 2_000;
const SAFE_RUNTIME_ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const CONTAINER_RUNTIME_ERRORS = new Set([
  "container_start_failed",
  "container_not_ready",
  "container_timeout",
  "container_version_incompatible",
]);

const PROVIDER_RUNTIME_ERRORS = new Set([
  "provider_config_failed",
  "provider_install_failed",
  "provider_timeout",
]);

/**
 * The cause a failed local step printed (the native error's `detail`, one
 * redacted line: src-tauri/src/runtime_log.rs failure_cause), when it has one.
 */
function failureDetail(detail: unknown): string | null {
  if (typeof detail !== "string") return null;
  const line = detail.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return line ? line.slice(0, 300) : null;
}

/** The codes whose catalog action is only a guess (the network, a retry): the cause replaces it. */
const CAUSE_REPLACES_ACTION = new Set([
  "runtime_install_failed",
  "container_start_failed",
  "container_not_ready",
  "runtime_wrapper_probe_failed",
  "timeout",
  "container_timeout",
]);

/** «Cause: …», then what to do: the catalog's own action, or retry and the log. */
function actionWithCause(code: string, action: string, cause: string | null): string {
  if (!cause) return action;
  const text = stateText();
  const said = text.failureCause.replace("{cause}", cause);
  const sentence = /[.!?…]$/.test(said) ? said : `${said}.`;
  return CAUSE_REPLACES_ACTION.has(code) ? `${sentence} ${text.failureCauseRetry}` : `${action} ${sentence}`;
}

function localRuntimeFailure(error: unknown): OnboardingRuntimeState {
  const value = typeof error === "object" && error !== null
    ? error as { code?: unknown; message?: unknown; retryable?: unknown; detail?: unknown }
    : {};
  if (typeof value.code !== "string" || !SAFE_RUNTIME_ERROR_CODE.test(value.code) ||
      typeof value.message !== "string" || !value.message.trim() ||
      typeof value.retryable !== "boolean") {
    return { status: "failed", stage: "runtime", message: failureMessage("runtime"), retryable: true };
  }
  const stage = CONTAINER_RUNTIME_ERRORS.has(value.code)
    ? "container"
    : PROVIDER_RUNTIME_ERRORS.has(value.code) ? "provider" : "runtime";
  if (value.code === "podman_machine_mounts_home") {
    const described = describeError(value.code, { locale: appLocale() });
    return {
      status: "failed",
      stage: "runtime",
      title: stateText().podmanRecreateTitle,
      message: described.text,
      action: described.action,
      code: value.code,
      retryable: false,
    };
  }
  if (value.code === "container_version_incompatible") {
    return {
      status: "failed",
      stage: "container",
      title: stateText().versionIncompatibleTitle,
      message: stateText().versionIncompatibleMessage,
      action: describeError(value.code, { locale: appLocale() }).action,
      code: value.code,
      retryable: false,
    };
  }
  const cause = failureDetail(value.detail);
  if (stage === "container") {
    return {
      status: "failed",
      stage,
      title: stateText().containerStartTitle,
      message: stateText().containerStartMessage,
      action: actionWithCause(value.code, describeError(value.code, { locale: appLocale() }).action, cause),
      code: value.code,
      retryable: value.retryable,
    };
  }
  // The sentence comes from the app's catalog, never from the native message;
  // the cause is the step's own line, redacted on the native side.
  const described = describeError(value.code, { locale: appLocale() });
  return {
    status: "failed",
    stage,
    message: described.text,
    action: actionWithCause(value.code, described.action, cause),
    code: value.code,
    retryable: value.retryable,
  };
}

/** A failure told by the catalog when the error carries a code it knows. */
function catalogFailure(stage: OnboardingRuntimeStage, error: unknown): OnboardingRuntimeState | null {
  const code = errorCodeOf(error);
  if (!code) return null;
  const described = describeError(code, { resetsAt: errorResetsAt(error), locale: appLocale() });
  if (!described.known) return null;
  const retryable = typeof error === "object" && error !== null &&
    typeof (error as { retryable?: unknown }).retryable === "boolean"
    ? (error as { retryable: boolean }).retryable
    : true;
  return { status: "failed", stage, message: described.text, action: described.action, code, retryable };
}

/** Adds the "limits not verified" notice to the state shown after a team start. */
function withLimitsNotice(
  state: OnboardingRuntimeState,
  snapshot: OnboardingRuntimeSnapshot,
): OnboardingRuntimeState {
  if (snapshot.limitsVerified !== false || !("message" in state)) return state;
  const notice = describeError("provider_limits_unverified", { locale: appLocale() });
  return { ...state, message: `${state.message} ${notice.text} ${notice.action}` };
}

function sshHostKeyFailure(error: unknown): OnboardingRuntimeState {
  const code = errorCodeOf(error);
  if (code === "host_key_mismatch" || code === "host_key_changed") {
    // The server key CHANGED from the confirmed one: possibly another server.
    // Not retryable, so no button lets the person go on anyway.
    const described = describeError(code, { locale: appLocale() });
    return {
      status: "failed",
      stage: "ssh-host-key",
      title: stateText().hostKeyChangedTitle,
      code,
      retryable: false,
      message: described.text,
      action: described.action,
    };
  }
  const known = catalogFailure("ssh-host-key", error);
  if (known) return known;
  return {
    status: "failed",
    stage: "ssh-host-key",
    retryable: true,
    message: failureMessage("ssh-host-key"),
  };
}

function failureMessage(stage: OnboardingRuntimeStage): string {
  return failureText(stage);
}

function pairingToken(session: Session | null, submission: OnboardingSubmission): string | null {
  if (submission.host.kind === "local" || !session) return null;
  if (!supabaseConfig.configured || !session.refresh_token) throw new Error("pairing-unavailable");
  return window.btoa(JSON.stringify({
    supabase_url: supabaseConfig.url,
    user_id: session.user.id,
    refresh_token: session.refresh_token,
    issued_at: Date.now(),
  }));
}

function resumedPrerequisiteFailure(
  snapshot: OnboardingRuntimeSnapshot,
): OnboardingRuntimeState | null {
  if (!snapshot.runtimeInstalled) return {
    status: "failed", stage: "runtime", retryable: false,
    message: stateText().resumedRuntimeNotReady,
  };
  if (!snapshot.containerRunning) return {
    status: "failed", stage: "container", retryable: false,
    message: stateText().resumedContainerNotActive,
  };
  if (!snapshot.providerConfigured) return {
    status: "failed", stage: "provider", retryable: false,
    message: stateText().resumedProviderNotConfigured,
  };
  if (!snapshot.providerAuthenticated) return {
    status: "failed", stage: "provider-login", retryable: false,
    message: stateText().resumedProviderLoginInvalid,
  };
  return null;
}

function resumedBackendFailure(error: unknown): OnboardingRuntimeState | "collecting-host" | null {
  const code = nativeErrorCode(error);
  if (code === "host_not_configured" || code === "host_config_invalid") return "collecting-host";
  if (code === "resume_runtime_not_ready") return {
    status: "failed", stage: "runtime", code, action: describeError(code, { locale: appLocale() }).action, retryable: false,
    message: stateText().resumedRuntimeNotReady,
  };
  if (code === "resume_container_not_ready") return {
    status: "failed", stage: "container", code, action: describeError(code, { locale: appLocale() }).action, retryable: false,
    message: stateText().resumedContainerNotActive,
  };
  if (code === "resume_provider_not_configured") return {
    status: "failed", stage: "provider", code, action: describeError(code, { locale: appLocale() }).action, retryable: false,
    message: stateText().resumedProviderNotConfigured,
  };
  if (code === "resume_provider_not_authenticated") return {
    status: "failed", stage: "provider-login", code, action: describeError(code, { locale: appLocale() }).action, retryable: false,
    message: stateText().resumedProviderLoginInvalid,
  };
  if (code === "team_start_failed" || code === "team_verify_failed") return {
    status: "failed", stage: "team-start", code, action: describeError(code, { locale: appLocale() }).action, retryable: true,
    message: stateText().resumedTeamNotReady,
  };
  return null;
}

function nativeErrorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null &&
    typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : null;
}

function mergeProviderLoginAction(
  actions: OnboardingProviderLoginAction[],
  action: OnboardingProviderLoginAction,
): OnboardingProviderLoginAction[] {
  return [...actions.filter((current) => current.kind !== action.kind), action];
}

/**
 * The real first-login router. The dashboard mounts only after durable account
 * evidence or after every native runtime fact, the conversational profile and
 * the direct-chat connection have been independently verified.
 */
export default function DashboardApp() {
  const localProfile = localIdentitySelected() ? readLocalProfile() : null;
  const savedLocalProfile = localProfile ? null : readLocalProfile();
  const { session, loading } = useSession(
    undefined,
    googleIdentitySelected() && !localProfile,
  );
  const identityKey = localProfile
    ? `local:${localProfile.profileId}`
    : session ? `google:${session.user.id}` : null;
  const markerId = localProfile ? `local:${localProfile.profileId}` : session?.user.id ?? null;
  const [gate, setGate] = useState<OnboardingGateState>({ phase: "loading" });
  const [platform, setPlatform] = useState<DesktopPlatform | null>(null);
  const [previousLocalData, setPreviousLocalData] = useState(false);
  const [runtimeLog, setRuntimeLog] = useState<string | null>(null);
  const [providerLogin, setProviderLogin] = useState<OnboardingProviderLoginState | null>(null);
  const [sshHostKey, setSshHostKey] = useState<OnboardingSshHostKeyConfirmation | null>(null);
  const [activity, setActivity] = useState<OnboardingActivityState | null>(null);
  const [assistantChatIdentityKey, setAssistantChatIdentityKey] = useState<string | null>(null);
  const [existingTeamDismissedIdentityKey, setExistingTeamDismissedIdentityKey] = useState<string | null>(null);
  const [onboardingUiVersion, setOnboardingUiVersion] = useState(0);
  const [accountScope, setAccountScope] = useState<{
    identityKey: string;
    phase: "pending" | "ready" | "error";
  } | null>(null);
  const accountScopeRef = useRef(accountScope);
  accountScopeRef.current = accountScope;
  const [localMigration, setLocalMigration] = useState<LocalMigrationGate | null>(null);
  const submissionRef = useRef<OnboardingSubmission | null>(null);
  const providerSessionRef = useRef<string | null>(null);
  const providerSessionIdentityRef = useRef<string | null>(null);
  const providerInputRequestRef = useRef<string | null>(null);
  const providerExitRejectRef = useRef<{ attempt: number; reject: (error: Error) => void } | null>(null);
  const providerStoppingAttemptRef = useRef<number | null>(null);
  const providerAttemptRef = useRef(0);
  const resumeAttemptedIdentityRef = useRef<string | null>(null);
  const activeIdentityKeyRef = useRef<string | null>(identityKey);
  activeIdentityKeyRef.current = identityKey;
  const signedOut = !loading && !identityKey;
  const migrationProfile = session && savedLocalProfile && identityKey
    ? savedLocalProfile
    : null;
  const migrationReady = !migrationProfile ||
    (localMigration?.identityKey === identityKey &&
      (localMigration.phase === "not-needed" || localMigration.phase === "completed"));

  const initializeAccount = useCallback(async () => {
    if (!identityKey || !markerId || !migrationReady) return;
    const initializingKey = identityKey;
    setGate({ phase: "loading" });
    setAccountScope({ identityKey: initializingKey, phase: "pending" });
    try {
      if (localProfile) await activateDesktopLocalScope(localProfile.profileId);
      else await activateDesktopAccountScope();
    } catch {
      if (activeIdentityKeyRef.current === initializingKey) {
        setAccountScope({ identityKey: initializingKey, phase: "error" });
      }
      return;
    }
    if (activeIdentityKeyRef.current !== initializingKey) return;
    setAccountScope({ identityKey: initializingKey, phase: "ready" });
    try {
      const next = localProfile
        ? loadLocalOnboardingGate(localProfile.profileId, localProfile.displayName)
        : session ? await loadOnboardingGate(supabase, session.user) : null;
      if (next && activeIdentityKeyRef.current === initializingKey) setGate(next);
    } catch {
      if (activeIdentityKeyRef.current !== initializingKey) return;
      setGate({ phase: "error", message: stateText().gateError });
    }
  }, [identityKey, localProfile?.displayName, localProfile?.profileId, markerId, migrationReady, session]);

  useEffect(() => {
    if (!identityKey || !migrationProfile) {
      setLocalMigration(null);
      return;
    }
    const profileId = migrationProfile.profileId;
    let active = true;
    setLocalMigration({ identityKey, profileId, phase: "checking" });
    void probeDesktopLocalProfileMigration(profileId).then((required) => {
      if (!active || activeIdentityKeyRef.current !== identityKey) return;
      setLocalMigration({
        identityKey,
        profileId,
        phase: required ? "required" : "not-needed",
      });
    }).catch((error: unknown) => {
      if (!active || activeIdentityKeyRef.current !== identityKey) return;
      setLocalMigration({
        identityKey,
        profileId,
        phase: "error",
        retryable: migrationRetryable(error),
      });
    });
    return () => { active = false; };
  }, [identityKey, migrationProfile?.profileId]);

  const confirmLocalMigration = useCallback(async () => {
    if (!identityKey || !localMigration || localMigration.identityKey !== identityKey ||
        localMigration.phase !== "required") return;
    const profileId = localMigration.profileId;
    setLocalMigration({ identityKey, profileId, phase: "migrating" });
    try {
      await migrateDesktopLocalProfileToAccount(profileId);
      finalizeLocalProfileMigration(profileId);
      setLocalMigration({ identityKey, profileId, phase: "completed" });
    } catch (error) {
      if (activeIdentityKeyRef.current !== identityKey) return;
      setLocalMigration({
        identityKey,
        profileId,
        phase: "error",
        retryable: migrationRetryable(error),
      });
    }
  }, [identityKey, localMigration]);

  const cancelLocalMigration = useCallback(async () => {
    if (!localMigration || localMigration.phase === "migrating") return;
    try {
      await activateSavedLocalProfile();
      clearGoogleIdentitySelection();
      goTo(DASHBOARD_PAGE);
    } catch {
      if (!identityKey) return;
      setLocalMigration({
        identityKey,
        profileId: localMigration.profileId,
        phase: "error",
        retryable: true,
      });
    }
  }, [identityKey, localMigration]);

  useEffect(() => {
    if (signedOut) goTo(LOGIN_PAGE);
  }, [signedOut]);

  useEffect(() => {
    let active = true;
    void readDesktopPlatform().then((detected) => {
      if (active) setPlatform(detected);
    });
    void readPreviousLocalData().then((found) => {
      if (active) setPreviousLocalData(found);
    });
    return () => { active = false; };
  }, []);

  // «Remove JHT from this computer» done: back to the first start. The gate
  // only admits Shell again after a new setup (the marker says "restarted").
  useEffect(() => {
    if (!markerId) return;
    const onRemoved = () => {
      try { resetOnboardingMarker(markerId); } catch { /* the reload still asks the gate */ }
      window.location.hash = "#/dashboard";
      window.location.reload();
    };
    window.addEventListener(LOCAL_RUNTIME_REMOVED_EVENT, onRemoved);
    return () => window.removeEventListener(LOCAL_RUNTIME_REMOVED_EVENT, onRemoved);
  }, [markerId]);

  useEffect(() => {
    const staleProviderSession = providerSessionRef.current;
    const providerTeardown = staleProviderSession
      ? closeOnboardingProviderLogin(staleProviderSession).catch(() => undefined)
      : Promise.resolve();
    setAssistantChatIdentityKey(null);
    setExistingTeamDismissedIdentityKey(null);
    setAccountScope(null);
    setSshHostKey(null);
    setActivity(null);
    setOnboardingUiVersion(0);
    resumeAttemptedIdentityRef.current = null;
    submissionRef.current = null;
    providerAttemptRef.current += 1;
    providerSessionRef.current = null;
    providerSessionIdentityRef.current = null;
    providerInputRequestRef.current = null;
    providerStoppingAttemptRef.current = null;
    providerExitRejectRef.current?.reject(new Error("account-changed"));
    providerExitRejectRef.current = null;
    setProviderLogin(null);
    if (!identityKey) {
      setGate({ phase: "loading" });
      void providerTeardown;
      return;
    }
    void providerTeardown.then(() => {
      if (activeIdentityKeyRef.current === identityKey && migrationReady) {
        void initializeAccount();
      }
    });
  }, [identityKey, initializeAccount, migrationReady]);

  useEffect(() => {
    if (!identityKey || !markerId || assistantChatIdentityKey !== identityKey) return;
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const verifyConversationalProfile = async () => {
      const submission = submissionRef.current;
      if (!active || activeIdentityKeyRef.current !== identityKey) return;
      try {
        const [nativeSnapshot, chat] = await Promise.all([
          submission ? readOnboardingSnapshot(submission.host) : resumeOnboardingSnapshot(),
          directChatStatus(),
        ]);
        if (!active || activeIdentityKeyRef.current !== identityKey) return;
        const snapshot = { ...nativeSnapshot, directChatReady: chat.state === "ready" };
        if (isOnboardingRuntimeReady(snapshot)) {
          markOnboardingReady(markerId, snapshot);
          setGate({ phase: "ready" });
          return;
        }
      } catch {
        // The Assistant chat remains usable. A later independent read retries the gate.
      }
      if (active) timeout = setTimeout(() => void verifyConversationalProfile(), PROFILE_RECHECK_MS);
    };

    void verifyConversationalProfile();
    return () => {
      active = false;
      if (timeout) clearTimeout(timeout);
    };
  }, [assistantChatIdentityKey, identityKey, markerId]);

  const setRuntime = useCallback((runtime: OnboardingRuntimeState) => {
    setGate((current) => current.phase === "required" ? { ...current, runtime } : current);
  }, []);

  const collectHostAgain = useCallback(() => {
    setGate((current) => current.phase === "required" ? {
      ...current,
      resumeAvailable: false,
      runtime: { status: "collecting", stage: "host" },
    } : current);
  }, []);

  const beginActivityInvocation = useCallback(() => {
    setActivity((current) => beginOnboardingActivityInvocation(current));
  }, []);

  const recordActivityProgress = useCallback((progress: OnboardingNativeProgress) => {
    if (activeIdentityKeyRef.current !== identityKey) return;
    setActivity((current) => applyOnboardingProgress(current, progress));
    if (progress.status === "start" || progress.status === "progress") {
      setRuntime({
        status: "working",
        stage: activityRuntimeStage(progress.stage),
        message: progress.message,
      });
    }
  }, [identityKey, setRuntime]);

  const fail = useCallback((stage: OnboardingRuntimeStage, error: unknown): never => {
    setRuntime(catalogFailure(stage, error) ??
      { status: "failed", stage, message: failureMessage(stage), retryable: true });
    throw error;
  }, [setRuntime]);

  const failLocalRuntime = useCallback((error: unknown): never => {
    setRuntime(localRuntimeFailure(error));
    throw error;
  }, [setRuntime]);

  const failSshHostKey = useCallback((error: unknown): never => {
    setRuntime(sshHostKeyFailure(error));
    throw error;
  }, [setRuntime]);

  const startTeam = useCallback(async (submission: OnboardingSubmission) => {
    try {
      setRuntime({ status: "working", stage: "team-start", message: stateText().startingContainerAndAgents });
      beginActivityInvocation();
      const snapshot = await startOnboardingTeam(submission.host, recordActivityProgress);
      setRuntime(withLimitsNotice(runtimeStateFromSnapshot(snapshot), snapshot));
    } catch (error) {
      fail("team-start", error);
    }
  }, [beginActivityInvocation, fail, recordActivityProgress, setRuntime]);

  const prepareTechnicalSetup = useCallback(async (submission: OnboardingSubmission) => {
    if (!identityKey) throw new Error("identity-missing");
    setRuntime({ status: "working", stage: "runtime", message: stateText().preparingProductionRuntime });
    beginActivityInvocation();
    const snapshot = await prepareOnboardingRuntime(
      submission,
      pairingToken(localProfile ? null : session, submission),
      recordActivityProgress,
    ).catch(failLocalRuntime);
    if (!snapshot.providerAuthenticated) {
      setRuntime(runtimeStateFromSnapshot(snapshot));
      return;
    }
    await startTeam(submission);
  }, [beginActivityInvocation, failLocalRuntime, identityKey, localProfile?.profileId, recordActivityProgress, session, setRuntime, startTeam]);

  const submit = useCallback(async (submission: OnboardingSubmission) => {
    if (!identityKey || !markerId) throw new Error("identity-missing");
    submissionRef.current = submission;
    setActivity((current) => current ?? createOnboardingActivity());
    try {
      markOnboardingStarted(markerId);
    } catch (error) {
      fail("runtime", error);
    }
    if (submission.host.kind === "vps") {
      setRuntime({ status: "working", stage: "ssh-host-key", message: stateText().verifyingSshIdentity });
      try {
        const probe = await probeOnboardingSshHostKey(submission.host);
        if (probe.status === "confirmation_required") {
          setSshHostKey({ algorithm: probe.algorithm, fingerprint: probe.fingerprint });
          setRuntime({ status: "action-required", stage: "ssh-host-key", message: stateText().compareFingerprint });
          return;
        }
      } catch (error) {
        failSshHostKey(error);
      }
    }
    setSshHostKey(null);
    await prepareTechnicalSetup(submission);
  }, [fail, failSshHostKey, identityKey, markerId, prepareTechnicalSetup, setRuntime]);

  const confirmHostKey = useCallback(async () => {
    const submission = submissionRef.current;
    if (!submission || submission.host.kind !== "vps" || !sshHostKey) {
      return fail("ssh-host-key", new Error("host-key-confirmation-missing"));
    }
    try {
      setRuntime({ status: "working", stage: "ssh-host-key", message: stateText().confirmingFingerprint });
      await confirmOnboardingSshHostKey(
        submission.host,
        sshHostKey,
      );
    } catch (error) {
      failSshHostKey(error);
    }
    // Outside the SSH try: a runtime, provider or team failure after the
    // confirmation shows its own message, never the SSH one.
    setSshHostKey(null);
    await prepareTechnicalSetup(submission);
  }, [fail, failSshHostKey, prepareTechnicalSetup, setRuntime, sshHostKey]);

  const cancelHostKey = useCallback(() => {
    setSshHostKey(null);
    submissionRef.current = null;
    setRuntime({ status: "collecting", stage: "host" });
  }, [setRuntime]);

  const loginProvider = useCallback(async () => {
    const submission = submissionRef.current;
    if (!submission) return fail("provider-login", new Error("submission-missing"));
    const loginIdentityKey = identityKey;
    const scope = accountScopeRef.current;
    if (!loginIdentityKey || scope?.phase !== "ready" || scope.identityKey !== loginIdentityKey) {
      return fail("provider-login", new Error("account-scope-not-ready"));
    }
    const attempt = ++providerAttemptRef.current;
    const attemptIsCurrent = () => {
      const currentScope = accountScopeRef.current;
      return providerAttemptRef.current === attempt &&
        activeIdentityKeyRef.current === loginIdentityKey &&
        currentScope?.phase === "ready" && currentScope.identityKey === loginIdentityKey;
    };
    providerSessionIdentityRef.current = loginIdentityKey;
    let sessionId: string | null = null;
    let invalidAction = false;
    try {
      providerInputRequestRef.current = null;
      setProviderLogin({
        provider: submission.provider,
        status: "connecting",
        actions: [],
        connectionState: "connecting",
        startedAt: Date.now(),
      });
      setRuntime({ status: "working", stage: "provider-login", message: stateText().waitingProviderLogin });
      beginActivityInvocation();
      let resolveExit!: () => void;
      let rejectExit!: (error: Error) => void;
      const exit = new Promise<void>((resolve, reject) => {
        resolveExit = resolve;
        rejectExit = reject;
      });
      void exit.catch(() => undefined);
      providerExitRejectRef.current = { attempt, reject: rejectExit };
      sessionId = await startOnboardingProviderLogin(submission.host, (event) => {
        if (!attemptIsCurrent()) return;
        if (event.kind === "invalid_action") {
          invalidAction = true;
          providerInputRequestRef.current = null;
          setProviderLogin((current) => current ? {
            ...current,
            status: "error",
            connectionState: "disconnected",
            actions: [],
            safeErrorMessage: stateText().providerActionInvalid,
            exitCode: null,
          } : current);
          rejectExit(new Error(event.code));
          return;
        }
        if (event.kind === "state") {
          const actions: OnboardingProviderLoginAction[] = event.action.kind === "device"
            ? event.action.actions
            : [event.action];
          const inputAction = actions.find((action) => action.kind === "input");
          providerInputRequestRef.current = inputAction?.kind === "input"
            ? inputAction.inputRequest.id
            : null;
          setProviderLogin((current) => current ? {
            ...current,
            status: "needs_user_action",
            connectionState: "connected",
            actions: actions.reduce(mergeProviderLoginAction, current.actions),
          } : current);
          return;
        }
        providerInputRequestRef.current = null;
        setProviderLogin((current) => current ? {
          ...current,
          status: event.code === 0 ? "verifying" : "error",
          connectionState: event.code === 0 ? "connected" : "disconnected",
          actions: event.code === 0
            ? current.actions.filter((action) => action.kind !== "input")
            : [],
          safeErrorMessage: event.code === 0 ? undefined : failureMessage("provider-login"),
          exitCode: event.code,
        } : current);
        if (event.code === 0) resolveExit();
        else rejectExit(new Error("provider-login-failed"));
      }, recordActivityProgress);
      if (!attemptIsCurrent()) {
        await closeOnboardingProviderLogin(sessionId).catch(() => undefined);
        sessionId = null;
        return;
      }
      providerSessionRef.current = sessionId;
      setProviderLogin((current) => current?.status === "connecting" ? {
        ...current,
        connectionState: "connected",
      } : current);
      await exit;
      await closeOnboardingProviderLogin(sessionId);
      providerSessionRef.current = null;
      providerSessionIdentityRef.current = null;
      if (providerExitRejectRef.current?.attempt === attempt) providerExitRejectRef.current = null;
      sessionId = null;
      const snapshot = await readOnboardingSnapshot(submission.host);
      if (providerAttemptRef.current !== attempt) return;
      if (!snapshot.providerAuthenticated) throw new Error("provider-login-unverified");
    } catch (error) {
      if (providerExitRejectRef.current?.attempt === attempt) providerExitRejectRef.current = null;
      if (sessionId && providerSessionRef.current === sessionId) {
        await closeOnboardingProviderLogin(sessionId).catch(() => undefined);
        providerSessionRef.current = null;
      }
      if (providerStoppingAttemptRef.current === attempt) {
        providerStoppingAttemptRef.current = null;
        return;
      }
      if (providerAttemptRef.current !== attempt) return;
      providerInputRequestRef.current = null;
      if (invalidAction) {
        providerSessionIdentityRef.current = null;
        return;
      }
      setProviderLogin((current) => current ? {
        ...current,
        status: "error",
        connectionState: "disconnected",
        actions: [],
        safeErrorMessage: failureMessage("provider-login"),
        exitCode: null,
      } : current);
      return fail("provider-login", error);
    }
    providerInputRequestRef.current = null;
    setProviderLogin(null);
    await startTeam(submission);
  }, [beginActivityInvocation, fail, identityKey, recordActivityProgress, setRuntime, startTeam]);

  const sendProviderInput = useCallback(async (input: string) => {
    const sessionId = providerSessionRef.current;
    const requestId = providerInputRequestRef.current;
    const owner = providerSessionIdentityRef.current;
    const attempt = providerAttemptRef.current;
    const scope = accountScopeRef.current;
    if (!sessionId || !requestId || !owner || activeIdentityKeyRef.current !== owner ||
        scope?.phase !== "ready" || scope.identityKey !== owner) {
      throw new Error("provider-input-not-requested");
    }
    await sendOnboardingProviderInput(sessionId, requestId, input);
    if (providerAttemptRef.current !== attempt || providerSessionRef.current !== sessionId ||
        providerInputRequestRef.current !== requestId ||
        providerSessionIdentityRef.current !== owner || activeIdentityKeyRef.current !== owner) return;
    providerInputRequestRef.current = null;
    setProviderLogin((current) => current ? {
      ...current,
      status: current.actions.some((action) => action.kind === "input" && action.inputRequest.id === requestId)
        ? "verifying"
        : current.status,
      actions: current.actions.filter((action) => action.kind !== "input" || action.inputRequest.id !== requestId),
    } : current);
  }, []);

  const closeProviderLogin = useCallback(async () => {
    const sessionId = providerSessionRef.current;
    const attempt = providerAttemptRef.current;
    providerStoppingAttemptRef.current = attempt;
    try {
      if (sessionId) await closeOnboardingProviderLogin(sessionId);
    } catch (error) {
      providerStoppingAttemptRef.current = null;
      throw error;
    }
    providerAttemptRef.current = attempt + 1;
    if (sessionId && providerSessionRef.current === sessionId) providerSessionRef.current = null;
    providerSessionIdentityRef.current = null;
    providerInputRequestRef.current = null;
    const pendingExit = providerExitRejectRef.current;
    if (pendingExit?.attempt === attempt) {
      providerExitRejectRef.current = null;
      pendingExit.reject(new Error("provider-login-closed"));
    }
    providerStoppingAttemptRef.current = null;
    setProviderLogin(null);
    setRuntime({
      status: "action-required",
      stage: "provider-login",
      message: stateText().loginCancelled,
    });
  }, [setRuntime]);

  const restartProviderLogin = useCallback(async () => {
    await closeProviderLogin();
    await loginProvider();
  }, [closeProviderLogin, loginProvider]);

  const restartOnboarding = useCallback(async () => {
    if (!identityKey || !markerId) throw new Error("identity-missing");
    const providerSession = providerSessionRef.current;
    providerAttemptRef.current += 1;
    providerSessionRef.current = null;
    providerSessionIdentityRef.current = null;
    providerInputRequestRef.current = null;
    providerStoppingAttemptRef.current = null;
    providerExitRejectRef.current?.reject(new Error("onboarding-restarted"));
    providerExitRejectRef.current = null;
    if (providerSession) await closeOnboardingProviderLogin(providerSession).catch(() => undefined);
    resetOnboardingMarker(markerId);
    submissionRef.current = null;
    resumeAttemptedIdentityRef.current = identityKey;
    setProviderLogin(null);
    setSshHostKey(null);
    setActivity(null);
    setAssistantChatIdentityKey(null);
    setExistingTeamDismissedIdentityKey(identityKey);
    setOnboardingUiVersion((current) => current + 1);
    setGate((current) => current.phase === "required" ? {
      phase: "required",
      account: current.account,
      resumeAvailable: false,
      runtime: { status: "collecting", stage: "host" },
    } : current);
  }, [identityKey, markerId]);

  const exitTechnicalFailure = useCallback(() => {
    submissionRef.current = null;
    setProviderLogin(null);
    setSshHostKey(null);
    setActivity(null);
    setGate((current) => current.phase === "required" ? {
      ...current,
      runtime: { status: "collecting", stage: "host" },
    } : current);
  }, []);

  const finishAssistant = useCallback(async () => {
    const submission = submissionRef.current;
    if (!submission || !identityKey) return fail("assistant", new Error("submission-missing"));
    try {
      setRuntime({ status: "working", stage: "assistant", message: stateText().openingAssistantChat });
      beginActivityInvocation();
      const nativeSnapshot = await openOnboardingAssistant(submission.host, recordActivityProgress);
      const chat = await connectDirectChat(submission.host);
      if (activeIdentityKeyRef.current !== identityKey) throw new Error("account-changed");
      const snapshot = { ...nativeSnapshot, directChatReady: chat.state === "ready" };
      if (!isOnboardingAssistantReachable(snapshot)) throw new Error("assistant-unverified");
      setAssistantChatIdentityKey(identityKey);
      navigate("/messages?agent=assistente", { replace: true });
    } catch (error) {
      if (activeIdentityKeyRef.current !== identityKey) throw error;
      fail("assistant", error);
    }
  }, [beginActivityInvocation, fail, identityKey, recordActivityProgress, setRuntime]);

  const resumeAssistant = useCallback(async () => {
    if (!identityKey) throw new Error("identity-missing");
    try {
      setActivity(createOnboardingActivity());
      setRuntime({ status: "working", stage: "runtime", message: stateText().checkingRealState });
      const nativeSnapshot = await resumeOnboardingSnapshot();
      if (activeIdentityKeyRef.current !== identityKey) throw new Error("account-changed");
      const prerequisiteFailure = resumedPrerequisiteFailure(nativeSnapshot);
      if (prerequisiteFailure) {
        setRuntime(prerequisiteFailure);
        return;
      }
      if (!nativeSnapshot.assistantRunning || !nativeSnapshot.captainRunning) {
        setRuntime({
          status: "action-required",
          stage: "team-start",
          message: stateText().teamStopped,
        });
        return;
      }
      setRuntime({
        status: "action-required",
        stage: "assistant",
        message: stateText().teamActive,
      });
    } catch (error) {
      if (activeIdentityKeyRef.current !== identityKey) throw error;
      const backendFailure = resumedBackendFailure(error);
      if (backendFailure === "collecting-host") {
        collectHostAgain();
        return;
      }
      if (backendFailure) {
        setRuntime(backendFailure);
        throw error;
      }
      fail("runtime", error);
    }
  }, [collectHostAgain, fail, identityKey, setRuntime]);

  const resumeTeam = useCallback(async () => {
    if (!identityKey) throw new Error("identity-missing");
    try {
      setRuntime({ status: "working", stage: "team-start", message: stateText().restoringSessions });
      beginActivityInvocation();
      const snapshot = await resumeOnboardingTeamStart(recordActivityProgress);
      if (activeIdentityKeyRef.current !== identityKey) throw new Error("account-changed");
      if (!snapshot.assistantRunning || !snapshot.captainRunning) {
        throw new Error("team-start-unverified");
      }
      setRuntime(withLimitsNotice({
        status: "action-required",
        stage: "assistant",
        message: stateText().teamActive,
      }, snapshot));
    } catch (error) {
      if (activeIdentityKeyRef.current !== identityKey) throw error;
      const backendFailure = resumedBackendFailure(error);
      if (backendFailure === "collecting-host") {
        collectHostAgain();
        return;
      }
      if (backendFailure) {
        setRuntime(backendFailure);
        throw error;
      }
      fail("team-start", error);
    }
  }, [beginActivityInvocation, collectHostAgain, fail, identityKey, recordActivityProgress, setRuntime]);

  const connectResumedAssistant = useCallback(async () => {
    if (!identityKey) throw new Error("identity-missing");
    try {
      const nativeSnapshot = await resumeOnboardingSnapshot();
      if (activeIdentityKeyRef.current !== identityKey) throw new Error("account-changed");
      const prerequisiteFailure = resumedPrerequisiteFailure(nativeSnapshot);
      if (prerequisiteFailure) {
        setRuntime(prerequisiteFailure);
        return;
      }
      if (!nativeSnapshot.assistantRunning || !nativeSnapshot.captainRunning) {
        setRuntime({
          status: "action-required",
          stage: "team-start",
          message: stateText().teamStopped,
        });
        return;
      }
      setRuntime({ status: "working", stage: "assistant", message: stateText().reconnectingChat });
      const chat = await reconnectDirectChat();
      if (activeIdentityKeyRef.current !== identityKey) throw new Error("account-changed");
      const snapshot = { ...nativeSnapshot, directChatReady: chat.state === "ready" };
      if (!isOnboardingAssistantReachable(snapshot)) throw new Error("assistant-unverified");
      setAssistantChatIdentityKey(identityKey);
      navigate("/messages?agent=assistente", { replace: true });
    } catch (error) {
      if (activeIdentityKeyRef.current !== identityKey) throw error;
      fail("assistant", error);
    }
  }, [fail, identityKey, setRuntime]);

  const connectExistingTeam = useCallback(async (nativeSnapshot: ExistingTeamConnectionResult) => {
    if (!identityKey || !markerId) throw new Error("identity-missing");
    const chat = await reconnectDirectChat();
    if (activeIdentityKeyRef.current !== identityKey) throw new Error("account-changed");
    const snapshot = { ...nativeSnapshot, directChatReady: chat.state === "ready" };
    if (!isOnboardingAssistantReachable(snapshot)) throw new Error("assistant-unverified");
    if (isOnboardingRuntimeReady(snapshot)) {
      markOnboardingReady(markerId, snapshot);
      setGate({ phase: "ready" });
      return;
    }
    markOnboardingStarted(markerId);
    setAssistantChatIdentityKey(identityKey);
    navigate("/messages?agent=assistente", { replace: true });
  }, [identityKey, markerId]);

  useEffect(() => {
    if (!identityKey || gate.phase !== "required" || gate.existingTeam || !gate.resumeAvailable ||
        assistantChatIdentityKey === identityKey || resumeAttemptedIdentityRef.current === identityKey) return;
    resumeAttemptedIdentityRef.current = identityKey;
    void resumeAssistant().catch(() => undefined);
  }, [assistantChatIdentityKey, gate, identityKey, resumeAssistant]);

  const runtimeAction = useCallback(async (stage: "provider-login" | "team-start" | "assistant") => {
    if (stage === "provider-login") return loginProvider();
    if (stage === "team-start") return resumeTeam();
    if (gate.phase === "required" && gate.resumeAvailable && !submissionRef.current) {
      return connectResumedAssistant();
    }
    return finishAssistant();
  }, [connectResumedAssistant, finishAssistant, gate, loginProvider, resumeTeam]);

  // A failed setup step shows where the runtime log is, written by then.
  const setupFailed = gate.phase === "required" && gate.runtime.status === "failed";
  useEffect(() => {
    if (!setupFailed) return;
    let active = true;
    void runtimeLogPath().then((path) => { if (active) setRuntimeLog(path); });
    return () => { active = false; };
  }, [setupFailed]);

  // Only from the confirmation on the podman_machine_mounts_home error: the
  // machine is deleted and created again, then the setup starts over.
  const recreatePodmanMachine = useCallback(async () => {
    setRuntime({ status: "working", stage: "runtime", message: stateText().recreatingMachine });
    try {
      await recreateOnboardingPodmanMachine();
    } catch (error) {
      failLocalRuntime(error);
    }
    const submission = submissionRef.current;
    if (submission) return prepareTechnicalSetup(submission);
    return resumeAssistant();
  }, [failLocalRuntime, prepareTechnicalSetup, resumeAssistant, setRuntime]);

  const retry = useCallback(async () => {
    if (gate.phase !== "required" || gate.runtime.status !== "failed") return;
    const { stage } = gate.runtime;
    const submission = submissionRef.current;
    if (gate.resumeAvailable && !submission) {
      if (stage === "team-start") return resumeTeam();
      if (stage === "assistant") return connectResumedAssistant();
      return resumeAssistant();
    }
    if (!submission) return fail(stage, new Error("submission-missing"));
    if (stage === "provider-login") return loginProvider();
    if (stage === "team-start") return startTeam(submission);
    if (stage === "assistant") return finishAssistant();
    return submit(submission);
  }, [connectResumedAssistant, fail, finishAssistant, gate, loginProvider, resumeAssistant, resumeTeam, setRuntime, startTeam, submit]);

  if (migrationProfile && localMigration?.identityKey === identityKey) {
    if (localMigration.phase === "checking") {
      return <DashboardSkeleton label={stateText().verifyingLocalProfile} />;
    }
    if (localMigration.phase === "required" || localMigration.phase === "migrating") {
      return (
        <main aria-labelledby="local-migration-title">
          <h1 id="local-migration-title">{stateText().migrationTitle}</h1>
          <p>{stateText().migrationText}</p>
          <button
            type="button"
            onClick={() => void confirmLocalMigration()}
            disabled={localMigration.phase === "migrating"}
          >
            {localMigration.phase === "migrating" ? stateText().linking : stateText().linkAndContinue}
          </button>
          <button
            type="button"
            onClick={() => void cancelLocalMigration()}
            disabled={localMigration.phase === "migrating"}
          >
            {stateText().cancelStayLocal}
          </button>
        </main>
      );
    }
    if (localMigration.phase === "error") {
      return (
        <main role="alert">
          <p>{stateText().migrationError}</p>
          {localMigration.retryable && (
            <button
              type="button"
              onClick={() => setLocalMigration({
                identityKey,
                profileId: localMigration.profileId,
                phase: "required",
              })}
            >
              {stateText().retry}
            </button>
          )}
          <button type="button" onClick={() => void cancelLocalMigration()}>
            {stateText().cancelStayLocal}
          </button>
        </main>
      );
    }
  }
  if (!identityKey || accountScope?.identityKey !== identityKey || accountScope.phase === "pending") {
    return <DashboardSkeleton label={stateText().loadingDashboard} />;
  }
  if (accountScope.phase === "error") {
    return (
      <main role="alert">
        <p>{stateText().accountScopeError}</p>
        <button type="button" onClick={() => void initializeAccount()}>{stateText().retry}</button>
      </main>
    );
  }
  if (gate.phase === "loading" || (gate.phase === "required" && platform === null)) {
    return <DashboardSkeleton label={stateText().loadingDashboard} />;
  }
  if (gate.phase === "error") {
    return (
      <main role="alert">
        <p>{gate.message}</p>
        <button type="button" onClick={() => void initializeAccount()}>{stateText().retry}</button>
      </main>
    );
  }
  if (gate.phase === "required") {
    if (assistantChatIdentityKey === identityKey) {
      return (
        <main data-testid="onboarding-assistant-chat" aria-label={stateText().assistantOnboardingAria}>
          <MessagesPage params={{}} search={new URLSearchParams("agent=assistente")} />
        </main>
      );
    }
    if (gate.existingTeam && existingTeamDismissedIdentityKey !== identityKey) {
      return (
        <ExistingTeamConnectModal
          teamId={gate.existingTeam.teamId}
          onCancel={() => setExistingTeamDismissedIdentityKey(identityKey)}
          onConnected={connectExistingTeam}
        />
      );
    }
    return (
      <OnboardingFlow
        key={`${identityKey}:${onboardingUiVersion}`}
        account={gate.account}
        platform={platform ?? "other"}
        runtime={gate.runtime}
        activity={activity}
        onSubmit={submit}
        onRuntimeAction={runtimeAction}
        providerLogin={providerLogin}
        sshHostKey={sshHostKey}
        onConfirmHostKey={confirmHostKey}
        onCancelHostKey={cancelHostKey}
        onProviderInput={sendProviderInput}
        onProviderClose={closeProviderLogin}
        onProviderRestart={restartProviderLogin}
        onRetry={retry}
        onRecreatePodmanMachine={recreatePodmanMachine}
        runtimeLogPath={runtimeLog}
        onOpenRuntimeLog={openRuntimeLog}
        previousLocalData={previousLocalData}
        onRestart={restartOnboarding}
        onExitFailure={exitTechnicalFailure}
      />
    );
  }
  const logout = localProfile ? async () => {
    await clearDesktopAccountScope();
    clearLocalIdentitySelection();
    goTo(LOGIN_PAGE);
  } : undefined;
  return <Shell key={identityKey} onLogout={logout} />;
}
