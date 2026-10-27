import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import DashboardSkeleton from "@/app/(protected)/_components/DashboardSkeleton";
import { appLocale } from "../lib/app-locale";
import { cleanImages } from "../lib/clean-images";
import { LOCAL_RUNTIME_REMOVED_EVENT } from "../lib/local-uninstall";
import { failureText, stateText } from "../lib/onboarding-state.i18n";
import { readDesktopPlatform, type DesktopPlatform } from "../lib/desktop-platform";
import {
  connectDirectChat,
  directChatStatus,
  reconnectDirectChat,
} from "../lib/direct-chat";
import { waitForDirectChat } from "../lib/direct-chat-wait";
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
  renameLocalProfile,
} from "../lib/local-profile";
import { clearGoogleIdentitySelection, googleIdentitySelected } from "../lib/identity-choice";
import {
  directChatFailureCode,
  existingTeamBridge,
  type ExistingTeamConnectionResult,
  type ExistingTeamReadOnlyConnectionResult,
  type ExistingTeamVpsHost,
} from "../lib/existing-team";
import {
  enterExistingTeamReadOnly,
  leaveExistingTeamReadOnly,
  useExistingTeamView,
} from "../lib/existing-team-readonly";
import { announceRestoredWriteAccess, clearWriteAccessNotice } from "../lib/write-access-restored";
import {
  isOnboardingAssistantReachable,
  isOnboardingRuntimeReady,
  loadLocalOnboardingGate,
  loadOnboardingGate,
  markOnboardingReady,
  markOnboardingStarted,
  clearOnboardingInterruption,
  recordOnboardingInterruption,
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
  setAsideUnassignedLocalData,
  adoptUnassignedLocalData,
  resumeOnboardingSnapshot,
  resumeOnboardingTeamStart,
  wakeRuntime,
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
import { signOut, supabase, supabaseConfig, useSession } from "../lib/supabase";
import { OnboardingFlow } from "../onboarding";
import ExistingTeamConnectModal from "../onboarding/ExistingTeamConnectModal";
import { ReconfirmExistingTeamContext } from "../lib/reconfirm-existing-team";
import { ConnectTeamContext, type ConnectTeamEntry } from "../lib/connect-team";
import { ProviderSetupContext } from "../lib/provider-setup";
import { TeamOffContext, type TeamOff } from "../lib/team-off";
import MessagesPage from "../pages/messages";
import { NewPositionNotifier } from "../lib/notify/NewPositionNotifier";
import TeamLanguagePrompt from "../components/TeamLanguagePrompt";
import Shell from "../shell/Shell";
import { navigate } from "../shell/router";
import { describeError, errorCodeOf, errorMachineOf, errorResetsAt } from "../lib/error-catalog";
import { isReadableCause } from "../lib/failure-cause";
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

/** The team's container runs, and its captain or its assistant is off: a team to open, not a failure. */
function existingTeamAgentsOff(snapshot: OnboardingRuntimeSnapshot): boolean {
  return Boolean(snapshot.runtimeInstalled && snapshot.containerRunning &&
    (!snapshot.captainRunning || !snapshot.assistantRunning));
}

/** The action to tell, and the raw cause for the technical details when it is not a sentence. */
function causeParts(code: string, action: string, cause: string | null): { action: string; cause?: string } {
  if (!cause) return { action };
  if (isReadableCause(cause)) return { action: actionWithCause(code, action, cause) };
  return { action: CAUSE_REPLACES_ACTION.has(code) ? stateText().failureCauseRetry : action, cause };
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
      ...causeParts(value.code, describeError(value.code, { locale: appLocale() }).action, cause),
      code: value.code,
      retryable: value.retryable,
    };
  }
  // The sentence comes from the app's catalog, never from the native message;
  // the cause is the step's own line, redacted on the native side.
  const described = describeError(value.code, { locale: appLocale(), machine: errorMachineOf(error) });
  return {
    status: "failed",
    stage,
    message: described.text,
    ...causeParts(value.code, described.action, cause),
    code: value.code,
    retryable: value.retryable,
  };
}

/** A failure told by the catalog when the error carries a code it knows. */
function catalogFailure(stage: OnboardingRuntimeStage, error: unknown): OnboardingRuntimeState | null {
  const code = errorCodeOf(error);
  if (!code) return null;
  const described = describeError(code, { resetsAt: errorResetsAt(error), locale: appLocale(), machine: errorMachineOf(error) });
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

/**
 * The runtime of THIS computer is installed and nothing of the team runs (the Podman machine is off
 * after a restart): not a failure of the saved setup. The snapshot only reads, so the provider is
 * unknown too; the person starts the team and the app wakes the runtime first
 * (onboarding_resume_team_start). A VPS or a saved team is not woken from here: it keeps the refusal.
 */
function resumedRuntimeStopped(snapshot: OnboardingRuntimeSnapshot): OnboardingRuntimeState | null {
  if (!snapshot.runtimeInstalled || snapshot.containerRunning || snapshot.localHost !== true) return null;
  return { status: "action-required", stage: "team-start", message: stateText().runtimeStopped, runtimeStopped: true };
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
  const [, setLocalProfileRevision] = useState(0);
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
  // supabase-js publishes the same session again as a new object (on every return of the window to the
  // foreground, on every token refresh): what starts the account over is the account, never that object.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [gate, setGate] = useState<OnboardingGateState>({ phase: "loading" });
  const [platform, setPlatform] = useState<DesktopPlatform | null>(null);
  const [previousLocalData, setPreviousLocalData] = useState(false);
  const [runtimeLog, setRuntimeLog] = useState<string | null>(null);
  const [providerLogin, setProviderLogin] = useState<OnboardingProviderLoginState | null>(null);
  const [sshHostKey, setSshHostKey] = useState<OnboardingSshHostKeyConfirmation | null>(null);
  const [activity, setActivity] = useState<OnboardingActivityState | null>(null);
  const [assistantChatIdentityKey, setAssistantChatIdentityKey] = useState<string | null>(null);
  const [existingTeamDismissedIdentityKey, setExistingTeamDismissedIdentityKey] = useState<string | null>(null);
  // Why the saved existing team did not open at start-up, for the «existing team» window that the
  // account's registered team opens on top of everything: without it the person sees an empty form.
  // The setup's existing-team dialog, opened from inside the app: «Reconnect the team» on the saved-team failure
  // screen (a team whose runtime changed after an update), or «Connect a team» in a Shell with no team linked.
  // It starts from what this profile saved (team and host), if anything readable is saved.
  const [connectDialog, setConnectDialog] = useState<
    { identityKey: string; teamId?: string; host?: ExistingTeamVpsHost } | null
  >(null);
  const [savedTeamNotice, setSavedTeamNotice] = useState<
    { identityKey: string; title: string; message: string; action?: string } | null
  >(null);
  const [manualExistingTeam, setManualExistingTeam] = useState<{ identityKey: string; host: ExistingTeamVpsHost } | null>(null);
  // The account is reading an existing team's VPS and nothing else: the Shell
  // shows its positions (lib/existing-team-readonly.ts), the setup waits.
  const [readOnlyExistingTeamKey, setReadOnlyExistingTeamKey] = useState<string | null>(null);
  // An existing team connected in full whose onboarding is not finished (agents off, T124, or the
  // Assistant's chat still to ready): its view is open on the agents' panel while the profile check runs.
  const [connectedExistingTeamKey, setConnectedExistingTeamKey] = useState<string | null>(null);
  // A profile that is already set up opens on the team it saved, if it saved one, before any page
  // reads: the pages take their data from the team's VPS, never from the cloud, once it is open.
  const [savedTeamOpening, setSavedTeamOpening] = useState<
    { identityKey: string; phase: "pending" | "done" | "failed"; failure?: OnboardingRuntimeState } | null
  >(null);
  // The app is open WITHOUT the team (the person chose it, or the team could not start): the identity it is open for.
  // Never a finished setup: the marker stays «started» and the next launch offers the resume again.
  const [teamOffKey, setTeamOffKey] = useState<string | null>(null);
  const linkedView = useExistingTeamView();
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
  // Settings › Provider: the setup reopened at the «Provider» step on the team that already runs on this computer.
  const [providerSetupKey, setProviderSetupKey] = useState<string | null>(null);
  const providerSetupKeyRef = useRef<string | null>(null);
  // A first setup of this session that went to a VPS: the team is not the one of this computer, whatever the Shell shows.
  const [vpsSetupKey, setVpsSetupKey] = useState<string | null>(null);
  // The screen shows a saved existing team that could not be reopened: «Riprova» asks again to reopen it.
  const savedTeamFailureRef = useRef(false);
  // The account whose existing team was connected in full in this run, and the function that opens
  // its view (set below): the profile check that admits the Shell runs in an effect declared earlier.
  const connectedExistingTeamRef = useRef<string | null>(null);
  const openFullExistingTeamRef = useRef<((snapshot: OnboardingRuntimeSnapshot) => void) | null>(null);
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
        : sessionRef.current ? await loadOnboardingGate(supabase, sessionRef.current.user) : null;
      if (next && activeIdentityKeyRef.current === initializingKey) setGate(next);
    } catch {
      if (activeIdentityKeyRef.current !== initializingKey) return;
      setGate({ phase: "error", message: stateText().gateError });
    }
  }, [identityKey, localProfile?.displayName, localProfile?.profileId, markerId, migrationReady]);

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

  // Leaving the account, or the app, ends the read-only view with it.
  useEffect(() => {
    if (readOnlyExistingTeamKey && readOnlyExistingTeamKey !== identityKey) {
      leaveExistingTeamReadOnly();
      setReadOnlyExistingTeamKey(null);
    }
  }, [identityKey, readOnlyExistingTeamKey]);
  // The same for a team connected with its agents off: it is this account's.
  useEffect(() => {
    if (connectedExistingTeamKey && connectedExistingTeamKey !== identityKey) setConnectedExistingTeamKey(null);
  }, [connectedExistingTeamKey, identityKey]);
  useEffect(() => leaveExistingTeamReadOnly, []);

  useEffect(() => {
    const staleProviderSession = providerSessionRef.current;
    const providerTeardown = staleProviderSession
      ? closeOnboardingProviderLogin(staleProviderSession).catch(() => undefined)
      : Promise.resolve();
    setAssistantChatIdentityKey(null);
    setExistingTeamDismissedIdentityKey(null);
    setSavedTeamNotice(null);
    setAccountScope(null);
    setSshHostKey(null);
    setActivity(null);
    setOnboardingUiVersion(0);
    resumeAttemptedIdentityRef.current = null;
    setSavedTeamOpening(null);
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
    if (!identityKey || !markerId) return;
    if (assistantChatIdentityKey !== identityKey && connectedExistingTeamKey !== identityKey) return;
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
          // A team connected in full (its Assistant chat first) opens on its own VPS, not on the cloud.
          if (connectedExistingTeamRef.current === identityKey) openFullExistingTeamRef.current?.(snapshot);
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
  }, [assistantChatIdentityKey, connectedExistingTeamKey, identityKey, markerId]);

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

  // Back to the app from the reopened Provider step, cancelled or done: the team is as it was or as chosen.
  const closeProviderSetup = useCallback(() => {
    // A failed attempt left its interruption record: this step is not a setup left half-done.
    if (markerId) clearOnboardingInterruption(markerId);
    providerSetupKeyRef.current = null;
    setProviderSetupKey(null);
    submissionRef.current = null;
    setProviderLogin(null);
    setActivity(null);
    setSshHostKey(null);
    setGate({ phase: "ready" });
    navigate("/settings", { replace: true });
  }, [markerId]);

  const startTeam = useCallback(async (submission: OnboardingSubmission) => {
    try {
      setRuntime({ status: "working", stage: "team-start", message: stateText().startingContainerAndAgents });
      beginActivityInvocation();
      const snapshot = await startOnboardingTeam(submission.host, recordActivityProgress);
      // The team already ran: with its provider signed in and its agents up there is nothing left to
      // set up (no assistant to open, no profile to collect), and the person goes back to the app.
      if (providerSetupKeyRef.current === identityKey && snapshot.containerRunning && snapshot.providerConfigured &&
          snapshot.providerAuthenticated && snapshot.assistantRunning && snapshot.captainRunning) {
        closeProviderSetup();
        return;
      }
      setRuntime(withLimitsNotice(runtimeStateFromSnapshot(snapshot), snapshot));
    } catch (error) {
      fail("team-start", error);
    }
  }, [beginActivityInvocation, closeProviderSetup, fail, identityKey, recordActivityProgress, setRuntime]);

  const prepareTechnicalSetup = useCallback(async (submission: OnboardingSubmission) => {
    if (!identityKey) throw new Error("identity-missing");
    setRuntime({ status: "working", stage: "runtime", message: stateText().preparingProductionRuntime });
    beginActivityInvocation();
    const snapshot = await prepareOnboardingRuntime(
      submission,
      pairingToken(localProfile ? null : session, submission),
      recordActivityProgress,
    ).catch((error) => {
      const failed = localRuntimeFailure(error);
      if (markerId && submission.host.kind === "local" && failed.status === "failed") {
        recordOnboardingInterruption(markerId, {
          stage: failed.stage, code: failed.code ?? null, at: Date.now(), provider: submission.provider,
        });
      }
      return failLocalRuntime(error);
    });
    if (!snapshot.providerAuthenticated) {
      setRuntime(runtimeStateFromSnapshot(snapshot));
      return;
    }
    await startTeam(submission);
  }, [beginActivityInvocation, failLocalRuntime, identityKey, localProfile?.profileId, markerId, recordActivityProgress, session, setRuntime, startTeam]);

  const submit = useCallback(async (submission: OnboardingSubmission) => {
    if (!identityKey || !markerId) throw new Error("identity-missing");
    submissionRef.current = submission;
    if (submission.host.kind === "vps") setVpsSetupKey(identityKey);
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
    // The reopened Provider step is not a first setup: «Restart» there starts that step over and leaves the
    // marker alone, or the team that works would be set up again from scratch at the next start.
    if (providerSetupKeyRef.current !== identityKey) resetOnboardingMarker(markerId);
    submissionRef.current = null;
    savedTeamFailureRef.current = false;
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
    savedTeamFailureRef.current = false;
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
      // The chat answers once the Assistant's first turn is over: the setup waits for it, it does not fail on
      // the first look.
      const chat = await waitForDirectChat(await connectDirectChat(submission.host), reconnectDirectChat, {
        stillCurrent: () => activeIdentityKeyRef.current === identityKey,
        onWaiting: () => setRuntime({ status: "working", stage: "assistant", message: stateText().assistantFirstRound }),
      });
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

  // Backup and Export read the team's data through the direct chat's connection: without the team the chat is not
  // opened by the setup, so the mode connects it itself, as soon as the container is there (it needs the container,
  // not the agents). A container that is not up leaves it disconnected; the wake connects it afterwards.
  const connectChatWithoutTeam = useCallback(async () => {
    try {
      await reconnectDirectChat();
    } catch {
      // not connected: the pages that need it say so
    }
  }, []);
  const openWithoutTeam = useCallback(() => {
    if (!identityKey) return;
    setTeamOffKey(identityKey);
    setSavedTeamOpening({ identityKey, phase: "done" });
    setGate({ phase: "ready" });
    void connectChatWithoutTeam();
  }, [connectChatWithoutTeam, identityKey]);
  const wakeRuntimeAndConnect = useCallback(async () => {
    await wakeRuntime();
    await connectChatWithoutTeam();
  }, [connectChatWithoutTeam]);
  // Leaves the mode for today's flow: the account is initialised again and the resume offers «start the team».
  const startTeamFromTeamOff = useCallback(() => {
    setTeamOffKey(null);
    setSavedTeamOpening(null);
    resumeAttemptedIdentityRef.current = null;
    void initializeAccount();
  }, [initializeAccount]);
  const teamOff = useMemo<TeamOff | null>(
    () => (teamOffKey !== null && teamOffKey === identityKey ? { teamOff: true, wakeRuntime: wakeRuntimeAndConnect, startTeam: startTeamFromTeamOff } : null),
    [teamOffKey, identityKey, startTeamFromTeamOff, wakeRuntimeAndConnect],
  );

  const openReadOnlyExistingTeam = useCallback((result: ExistingTeamReadOnlyConnectionResult) => {
    if (!identityKey || activeIdentityKeyRef.current !== identityKey) return;
    clearWriteAccessNotice();
    // On before the Shell mounts: its pages read in effects that run first.
    enterExistingTeamReadOnly(result.readiness, {
      at: Date.now(),
      captainRunning: result.snapshot.captainRunning === true,
      assistantRunning: result.snapshot.assistantRunning === true,
    }, `account:${identityKey}|${result.connectionKey ?? "unnamed"}`);
    setReadOnlyExistingTeamKey(identityKey);
  }, [identityKey]);

  /**
   * The team connected in full («Conferma e collega» in this run): the same pages as the read-only
   * view, reading its VPS, with what writes turned on. The native side still refuses a write that
   * the connection did not grant (full_link_granted, the main window).
   */
  const openFullExistingTeam = useCallback((snapshot: OnboardingRuntimeSnapshot) => {
    if (!identityKey || activeIdentityKeyRef.current !== identityKey) return;
    // A confirmation made now is not the one kept from an earlier run: no row about that one.
    clearWriteAccessNotice();
    enterExistingTeamReadOnly(snapshot.assistantRunning === true, {
      at: Date.now(),
      captainRunning: snapshot.captainRunning === true,
      assistantRunning: snapshot.assistantRunning === true,
    }, `account:${identityKey}|full`, true);
    setReadOnlyExistingTeamKey(identityKey);
  }, [identityKey]);
  openFullExistingTeamRef.current = openFullExistingTeam;

  /**
   * After a restart, a profile that already saved an existing team (candidate and
   * selection) goes back to its read-only view: the native side takes the saved
   * host and team, checks the pin and the identity again and starts nothing.
   * Only "there is no saved existing team" (refused before any SSH call) lets the
   * usual resume go on. Any other refusal is a saved team that cannot be reached
   * or confirmed right now: it is shown as that, with its catalog sentence and a
   * retry that asks the same question again, never as the team-start action.
   */
  const reopenExistingTeam = useCallback(async (): Promise<"opened" | "none" | OnboardingRuntimeState> => {
    savedTeamFailureRef.current = false;
    try {
      const result = await existingTeamBridge.reopen();
      setSavedTeamNotice(null);
      // Closing the read-only view goes back to the setup's first step, not to a spinner.
      setRuntime({ status: "collecting", stage: "host" });
      if (result.fullLink === true) {
        // The permission the person gave in an earlier run came back (the native side checked it after
        // the whole reopening passed): the view opens in full, and the fixed row says so and offers the way out.
        openFullExistingTeam(result.snapshot);
        announceRestoredWriteAccess();
      } else {
        openReadOnlyExistingTeam(result);
      }
      return "opened";
    } catch (error) {
      const code = nativeErrorCode(error);
      // «None» means exactly this: neither a candidate nor a selection is saved. One without
      // the other is an incomplete saved connection, and any other refusal a saved team that
      // cannot be reached: both are shown as such and never lead to the team-start action.
      if (code === "existing_team_runtime_candidate_required") {
        setSavedTeamNotice(null);
        return "none";
      }
      savedTeamFailureRef.current = true;
      const described = describeError(code, { locale: appLocale() });
      // The pinned container is no longer the one on the VPS (the team was updated, or it is off): said as
      // that, with the way out in the person's hands («Reconnect the team»), never as «not reachable».
      const replaced = code === "existing_team_runtime_changed";
      const title = code === "existing_team_saved_incomplete"
        ? stateText().savedTeamIncompleteTitle
        : replaced ? stateText().savedTeamUpdatedTitle : stateText().savedTeamUnreachableTitle;
      const action = replaced ? stateText().savedTeamUpdatedHint : described.action;
      if (identityKey) {
        setSavedTeamNotice({ identityKey, title, message: described.text, ...(action ? { action } : {}) });
      }
      return {
        status: "failed",
        stage: "runtime",
        title,
        message: described.text,
        action,
        ...(code ? { code } : {}),
        retryable: true,
      };
    }
  }, [identityKey, openFullExistingTeam, openReadOnlyExistingTeam, setRuntime]);

  const resumeAssistant = useCallback(async (options?: { reopened?: boolean }) => {
    if (!identityKey) throw new Error("identity-missing");
    try {
      setActivity(createOnboardingActivity());
      setRuntime({ status: "working", stage: "runtime", message: stateText().checkingRealState });
      if (!options?.reopened) {
        const reopened = await reopenExistingTeam();
        if (reopened === "opened") return;
        if (reopened !== "none") {
          setRuntime(reopened);
          return;
        }
      }
      const nativeSnapshot = await resumeOnboardingSnapshot();
      if (activeIdentityKeyRef.current !== identityKey) throw new Error("account-changed");
      const stopped = resumedRuntimeStopped(nativeSnapshot);
      if (stopped) {
        setRuntime(stopped);
        return;
      }
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
  }, [collectHostAgain, fail, identityKey, reopenExistingTeam, setRuntime]);

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
      const stopped = resumedRuntimeStopped(nativeSnapshot);
      if (stopped) {
        setRuntime(stopped);
        return;
      }
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
      const chat = await waitForDirectChat(await reconnectDirectChat(), reconnectDirectChat, {
        stillCurrent: () => activeIdentityKeyRef.current === identityKey,
        onWaiting: () => setRuntime({ status: "working", stage: "assistant", message: stateText().assistantFirstRound }),
      });
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

  const connectExistingTeam = useCallback(async (nativeSnapshot: ExistingTeamConnectionResult, options?: { fromReadOnlyView?: boolean }) => {
    if (!identityKey || !markerId) throw new Error("identity-missing");
    if (activeIdentityKeyRef.current !== identityKey) throw new Error("account-changed");
    const chat = await reconnectDirectChat();
    if (activeIdentityKeyRef.current !== identityKey) throw new Error("account-changed");
    const snapshot = { ...nativeSnapshot, directChatReady: chat.state === "ready" };
    connectedExistingTeamRef.current = identityKey;
    if (!isOnboardingAssistantReachable(snapshot) && existingTeamAgentsOff(snapshot)) {
      // Connected, with the captain or the assistant off (T124): the team opens in full, on its
      // agents' panel, where they are started. The onboarding is done when the chat is ready.
      markOnboardingStarted(markerId);
      setConnectedExistingTeamKey(identityKey);
      openFullExistingTeam(snapshot);
      navigate("/agents", { replace: true });
      return;
    }
    // A code the dialog knows, so it says what failed; a bare Error was «unknown» to the dialog.
    if (!isOnboardingAssistantReachable(snapshot)) throw { code: directChatFailureCode(chat) };
    if (isOnboardingRuntimeReady(snapshot)) {
      markOnboardingReady(markerId, snapshot);
      openFullExistingTeam(snapshot);
      setGate({ phase: "ready" });
      return;
    }
    markOnboardingStarted(markerId);
    setConnectedExistingTeamKey(identityKey);
    // The person confirmed the write access from the read-only view of this very team and left it: the
    // pages go on reading its VPS, not the cloud, while the profile is still being completed in the chat.
    if (options?.fromReadOnlyView) openFullExistingTeam(snapshot);
    setAssistantChatIdentityKey(identityKey);
    navigate("/messages?agent=assistente", { replace: true });
  }, [identityKey, markerId, openFullExistingTeam]);

  const closeReadOnlyExistingTeam = useCallback(() => {
    leaveExistingTeamReadOnly();
    setReadOnlyExistingTeamKey(null);
    setExistingTeamDismissedIdentityKey(identityKey);
    setManualExistingTeam(null);
  }, [identityKey]);

  /**
   * The chat's «Collega il team»: the full connection was confirmed from the chat, for the saved
   * host and team. The read-only view ends and the team opens in full, as after the setup's modal.
   * When what was saved no longer matches, the read-only view ends WITHOUT dismissing the existing
   * team, so the setup's modal can ask again (the chat's button never leads to a dead end).
   */
  const reconfirmExistingTeam = useMemo(() => ({
    accountLabel: gate.phase === "required" ? gate.account.displayName : null,
    onConnected: async (result: ExistingTeamConnectionResult) => {
      // The view is left only by the team opening in full (openFullExistingTeam): a connection that
      // then fails (the Assistant cannot be reached) leaves the person on the view they were in.
      await connectExistingTeam(result, { fromReadOnlyView: true });
    },
    onSetup: () => {
      leaveExistingTeamReadOnly();
      setReadOnlyExistingTeamKey(null);
      setManualExistingTeam(null);
    },
  }), [connectExistingTeam, gate]);

  /**
   * The first thing a started identity does: reopen the saved existing team, whatever
   * the legacy onboarding marker says (a new connection in read-only mode does not
   * write it). With nothing saved, a profile whose own setup was started goes on to
   * the usual resume, and an empty profile stays on the normal gate with no resume at all.
   */
  const startupReopen = useCallback(async (thenUsualResume: boolean) => {
    if (!identityKey) return;
    let showed = false;
    // A «Retry» of a saved team that could not be reopened starts from its failed state.
    const retryingSavedFailure = savedTeamFailureRef.current;
    // A quick refusal (nothing saved) must not flash a spinner on a new profile's first screen.
    const timer = setTimeout(() => {
      showed = true;
      setRuntime({ status: "working", stage: "runtime", message: stateText().checkingRealState });
    }, 300);
    let outcome: Awaited<ReturnType<typeof reopenExistingTeam>>;
    try {
      outcome = await reopenExistingTeam();
    } finally {
      clearTimeout(timer);
    }
    if (activeIdentityKeyRef.current !== identityKey || outcome === "opened") return;
    if (outcome !== "none") {
      if (!submissionRef.current) setRuntime(outcome);
      return;
    }
    if (thenUsualResume) {
      await resumeAssistant({ reopened: true });
      return;
    }
    // Whatever answered in under 300 ms never set a spinner, but the old failure is still on screen.
    if (showed || retryingSavedFailure) setRuntime({ status: "collecting", stage: "host" });
  }, [identityKey, reopenExistingTeam, resumeAssistant, setRuntime]);

  // A set-up profile (the gate admits the Shell) that saved an existing team opens on that team's VPS
  // before the first page reads, like after the setup's own reopening. Without a saved team the
  // native side refuses before any SSH call and the Shell opens as it always did.
  useEffect(() => {
    if (!identityKey || gate.phase !== "ready" || readOnlyExistingTeamKey === identityKey) return;
    if (savedTeamOpening?.identityKey === identityKey) return;
    setSavedTeamOpening({ identityKey, phase: "pending" });
    void reopenExistingTeam().then((outcome) => {
      if (activeIdentityKeyRef.current !== identityKey) return;
      setSavedTeamOpening(
        outcome === "opened" || outcome === "none"
          ? { identityKey, phase: "done" }
          : { identityKey, phase: "failed", failure: outcome },
      );
    });
  }, [gate.phase, identityKey, readOnlyExistingTeamKey, reopenExistingTeam, savedTeamOpening]);

  useEffect(() => {
    if (!identityKey || gate.phase !== "required" ||
        assistantChatIdentityKey === identityKey || resumeAttemptedIdentityRef.current === identityKey) return;
    resumeAttemptedIdentityRef.current = identityKey;
    void startupReopen(!gate.existingTeam && gate.resumeAvailable).catch(() => undefined);
  }, [assistantChatIdentityKey, gate, identityKey, startupReopen]);

  // A local preparation that stopped and was never finished: «Resume» runs the same preparation again
  // with what was chosen (it checks what is already there), «Start over» forgets the interruption.
  const interruption = gate.phase === "required" ? gate.interruption : undefined;
  const resumeInterrupted = useCallback(async () => {
    if (!interruption) return;
    await submit({ host: { kind: "local" }, provider: interruption.provider });
  }, [interruption, submit]);
  const discardInterruption = useCallback(() => {
    if (markerId) clearOnboardingInterruption(markerId);
    setGate((current) => {
      if (current.phase !== "required") return current;
      const { interruption: _dropped, ...rest } = current;
      return rest;
    });
  }, [markerId]);

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
      // The notices of the machine that is gone (too little memory) do not follow the new one.
      setActivity(null);
    } catch (error) {
      failLocalRuntime(error);
    }
    const submission = submissionRef.current;
    if (submission) return prepareTechnicalSetup(submission);
    return resumeAssistant();
  }, [failLocalRuntime, prepareTechnicalSetup, resumeAssistant, setRuntime]);

  // Only from the confirmation on the disk_low error: old JHT images on the
  // host being set up, or on the saved one when the team is resumed.
  const freeDiskSpace = useCallback(() => cleanImages(submissionRef.current?.host ?? null), []);

  const retry = useCallback(async () => {
    if (gate.phase !== "required" || gate.runtime.status !== "failed") return;
    const { stage } = gate.runtime;
    const submission = submissionRef.current;
    // A saved existing team that could not be reopened: ask to reopen it again, whatever the marker says.
    if (savedTeamFailureRef.current && !submission) {
      return startupReopen(gate.phase === "required" && !gate.existingTeam && gate.resumeAvailable);
    }
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
  }, [connectResumedAssistant, fail, finishAssistant, gate, loginProvider, resumeAssistant, resumeTeam, setRuntime, startTeam, startupReopen, submit]);

  // Offered only to the team of this computer, on a platform that runs one, once the setup is done.
  const localTeamPlatform = platform === "macos" || platform === "linux" || platform === "windows";
  const openProviderSetup = useCallback(() => {
    if (!identityKey || gate.phase !== "ready") return;
    providerSetupKeyRef.current = identityKey;
    setProviderSetupKey(identityKey);
    // The reopening of a saved team and the usual resume belong to the first setup, not to this step.
    resumeAttemptedIdentityRef.current = identityKey;
    setAssistantChatIdentityKey(null);
    submissionRef.current = null;
    setProviderLogin(null);
    setActivity(null);
    setSshHostKey(null);
    setGate({
      phase: "required",
      account: localProfile ? { displayName: localProfile.displayName, identity: "local" } : { displayName: null, identity: "google" },
      resumeAvailable: false,
      runtime: { status: "collecting", stage: "host" },
    });
  }, [gate.phase, identityKey, localProfile?.displayName]);
  const providerSetup = useMemo(
    () => (localTeamPlatform && gate.phase === "ready" && vpsSetupKey !== identityKey ? { open: openProviderSetup } : null),
    [gate.phase, identityKey, localTeamPlatform, openProviderSetup, vpsSetupKey],
  );

  const logout = localProfile ? async () => {
    leaveExistingTeamReadOnly();
    await clearDesktopAccountScope();
    clearLocalIdentitySelection();
    goTo(LOGIN_PAGE);
  } : undefined;

  const openConnectDialog = useCallback(async () => {
    if (!identityKey) return;
    let seed: { teamId?: string; host?: ExistingTeamVpsHost } = {};
    try {
      const summary = await existingTeamBridge.reconfirmSummary();
      seed = { teamId: summary.teamId, host: summary.host };
    } catch {
      // Nothing readable is saved: the dialog asks for the host and the team, as in the setup.
    }
    if (activeIdentityKeyRef.current === identityKey) setConnectDialog({ identityKey, ...seed });
  }, [identityKey]);
  const connectTeamEntry = useMemo<ConnectTeamEntry>(() => ({
    open: () => void openConnectDialog(),
    reopen: async () => (await reopenExistingTeam()) === "opened",
    unlinked: () => {
      leaveExistingTeamReadOnly();
      setReadOnlyExistingTeamKey(null);
      setConnectDialog(null);
      if (identityKey) setSavedTeamOpening({ identityKey, phase: "done" });
    },
  }), [identityKey, openConnectDialog, reopenExistingTeam]);

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
  const connectDialogElement = connectDialog && connectDialog.identityKey === identityKey ? (
    <ExistingTeamConnectModal
      key={`${identityKey}:connect`}
      teamId={connectDialog.teamId}
      initialHost={connectDialog.host}
      savedTeamNotice={savedTeamNotice?.identityKey === identityKey ? savedTeamNotice : undefined}
      onCancel={() => setConnectDialog(null)}
      onConnected={async (snapshot) => {
        await connectExistingTeam(snapshot);
        setConnectDialog(null);
        setSavedTeamOpening({ identityKey, phase: "done" });
      }}
      onReadOnlyConnected={(result) => {
        openReadOnlyExistingTeam(result);
        setConnectDialog(null);
        setSavedTeamOpening({ identityKey, phase: "done" });
      }}
    />
  ) : null;
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
  // An existing team's VPS is what the pages read while its view is open, whatever the gate says:
  // read-only after a reopening, in full after «Conferma e collega» (the same pages, controls on).
  if (readOnlyExistingTeamKey === identityKey) {
    const shell = (
      <Shell
        key={identityKey}
        onLogout={logout}
        // A team connected in full has no way «back»; a read-only one of a set-up profile neither
        // (its setup is done: the chat's «Collega il team» opens the full connection).
        onCloseReadOnly={linkedView?.full || gate.phase === "ready" ? undefined : closeReadOnlyExistingTeam}
      />
    );
    return (
      <>
        {/* Nothing to confirm once the connection is full. */}
        <ConnectTeamContext.Provider value={connectTeamEntry}>
          {linkedView?.full ? shell : (
            <ReconfirmExistingTeamContext.Provider value={reconfirmExistingTeam}>{shell}</ReconfirmExistingTeamContext.Provider>
          )}
        </ConnectTeamContext.Provider>
        {connectDialogElement}
        <NewPositionNotifier key={`notify:${identityKey}`} />
        {/* The team of the person who linked it in full is the one whose language is asked; a read-only view never writes. */}
        {linkedView?.full && <TeamLanguagePrompt key={`language:${identityKey}`} identityKey={identityKey} />}
      </>
    );
  }
  if (gate.phase === "ready") {
    if (savedTeamOpening?.identityKey !== identityKey || savedTeamOpening.phase === "pending") {
      return <DashboardSkeleton label={stateText().loadingDashboard} />;
    }
    if (savedTeamOpening.phase === "failed" && savedTeamOpening.failure?.status === "failed" && connectDialogElement) {
      return connectDialogElement;
    }
    if (savedTeamOpening.phase === "failed" && savedTeamOpening.failure?.status === "failed") {
      const failure = savedTeamOpening.failure;
      // The saved connection is the one of the team before an update: the dialog can rebind it.
      const mayRebind = failure.code === "existing_team_runtime_changed" || failure.code === "existing_team_unavailable";
      return (
        <div className="existing-team-modal__backdrop">
          <main className="existing-team-modal" role="alert">
            <header className="existing-team-modal__header">
              <h2>{failure.title}</h2>
              <p>{failure.message}</p>
              {failure.action && <p>{failure.action}</p>}
            </header>
            <div className="existing-team-modal__actions">
              {mayRebind && <button type="button" className="existing-team-modal__primary" onClick={() => void openConnectDialog()}>{stateText().rebindTeam}</button>}
              <button type="button" className={mayRebind ? "existing-team-modal__secondary" : "existing-team-modal__primary"} onClick={() => setSavedTeamOpening(null)}>{stateText().retry}</button>
              {/* A team that stays down must not lock the person out: they can leave the account, or go on without it. */}
              <button type="button" className="existing-team-modal__secondary" onClick={() => setSavedTeamOpening({ identityKey, phase: "done" })}>
                {stateText().continueWithoutTeam}
              </button>
              <button type="button" className="existing-team-modal__secondary" onClick={() => void Promise.resolve((logout ?? signOut)()).catch(() => undefined)}>
                {stateText().signOut}
              </button>
            </div>
          </main>
        </div>
      );
    }
  }
  if (gate.phase === "required") {
    if (assistantChatIdentityKey === identityKey) {
      return (
        <main data-testid="onboarding-assistant-chat" aria-label={stateText().assistantOnboardingAria}>
          <MessagesPage params={{}} search={new URLSearchParams("agent=assistente")} />
        </main>
      );
    }
    const manualExistingHost = gate.account.identity === "local" && manualExistingTeam?.identityKey === identityKey
      ? manualExistingTeam.host : undefined;
    if ((gate.existingTeam && existingTeamDismissedIdentityKey !== identityKey) || manualExistingHost) {
      return (
        <ExistingTeamConnectModal
          key={identityKey}
          teamId={gate.existingTeam?.teamId}
          initialHost={manualExistingHost}
          savedTeamNotice={savedTeamNotice?.identityKey === identityKey ? savedTeamNotice : undefined}
          onCancel={() => {
            setExistingTeamDismissedIdentityKey(identityKey);
            setManualExistingTeam(null);
          }}
          onConnected={connectExistingTeam}
          onReadOnlyConnected={openReadOnlyExistingTeam}
        />
      );
    }
    return (
      <OnboardingFlow
        key={`${identityKey}:${onboardingUiVersion}`}
        account={gate.account}
        onRenameLocalProfile={gate.account.identity === "local" ? (displayName) => {
          renameLocalProfile(displayName);
          setLocalProfileRevision((revision) => revision + 1);
        } : undefined}
        onConnectExistingTeam={gate.account.identity === "local" ? (host) => {
          if (activeIdentityKeyRef.current === identityKey) setManualExistingTeam({ identityKey, host });
        } : undefined}
        platform={platform ?? "other"}
        runtime={gate.runtime}
        activity={activity}
        onSignInWithGoogle={gate.account.identity === "local" ? logout : undefined}
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
        onUseLocalData={adoptUnassignedLocalData}
        onSetAsideLocalData={setAsideUnassignedLocalData}
        onFreeDiskSpace={freeDiskSpace}
        runtimeLogPath={runtimeLog}
        onOpenRuntimeLog={openRuntimeLog}
        previousLocalData={previousLocalData}
        interruption={interruption}
        onResumeInterrupted={interruption ? resumeInterrupted : undefined}
        onDiscardInterruption={interruption ? discardInterruption : undefined}
        onRestart={restartOnboarding}
        onExitFailure={exitTechnicalFailure}
        onOpenWithoutTeam={openWithoutTeam}
        providerOnly={providerSetupKey === identityKey ? { onCancel: closeProviderSetup } : undefined}
      />
    );
  }
  return (
    <>
      <TeamOffContext.Provider value={teamOff}>
        <ProviderSetupContext.Provider value={providerSetup}>
          <ConnectTeamContext.Provider value={connectTeamEntry}>
            <Shell key={identityKey} onLogout={logout} />
          </ConnectTeamContext.Provider>
        </ProviderSetupContext.Provider>
      </TeamOffContext.Provider>
      {connectDialogElement}
      <NewPositionNotifier key={`notify:${identityKey}`} />
      <TeamLanguagePrompt key={`language:${identityKey}`} identityKey={identityKey} />
    </>
  );
}
