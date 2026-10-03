import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import DashboardSkeleton from "@/app/(protected)/_components/DashboardSkeleton";
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
} from "../lib/desktop-account-scope";
import {
  clearLocalIdentitySelection,
  localIdentitySelected,
  readLocalProfile,
} from "../lib/local-profile";
import { googleIdentitySelected } from "../lib/identity-choice";
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
import { goTo, LOGIN_PAGE } from "../lib/pages";
import { supabase, supabaseConfig, useSession } from "../lib/supabase";
import { OnboardingFlow } from "../onboarding";
import ExistingTeamConnectModal from "../onboarding/ExistingTeamConnectModal";
import MessagesPage from "../pages/messages";
import Shell from "../shell/Shell";
import { navigate } from "../shell/router";

const GATE_ERROR = "Non riesco a verificare la configurazione dell’account. Riprova.";
const ACCOUNT_SCOPE_ERROR = "Non riesco a verificare l’isolamento dell’account. Nessun runtime è stato aperto.";
const MAX_PROVIDER_OUTPUT = 32_768;
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

function providerLoginInstruction(provider: OnboardingSubmission["provider"]): string {
  if (provider === "codex") return "Completa l’accesso nel browser quando il provider mostra la richiesta verificata.";
  return "Segui la richiesta verificata del provider per completare l’accesso al tuo abbonamento.";
}

function appendProviderOutput(current: string[], text: string): string[] {
  const bounded = `${current.join("")}${text}`.slice(-MAX_PROVIDER_OUTPUT);
  return bounded ? [bounded] : [];
}

function localRuntimeFailure(error: unknown): OnboardingRuntimeState {
  const value = typeof error === "object" && error !== null
    ? error as { code?: unknown; message?: unknown; retryable?: unknown }
    : {};
  if (typeof value.code !== "string" || !SAFE_RUNTIME_ERROR_CODE.test(value.code) ||
      typeof value.message !== "string" || !value.message.trim() ||
      typeof value.retryable !== "boolean") {
    return { status: "failed", stage: "runtime", message: failureMessage("runtime"), retryable: true };
  }
  const stage = CONTAINER_RUNTIME_ERRORS.has(value.code)
    ? "container"
    : PROVIDER_RUNTIME_ERRORS.has(value.code) ? "provider" : "runtime";
  if (value.code === "container_version_incompatible") {
    return {
      status: "failed",
      stage: "container",
      title: "Versione del container non compatibile",
      message: "La versione installata non coincide con quella richiesta da questa app. Il team non è stato avviato.",
      code: value.code,
      retryable: false,
    };
  }
  if (stage === "container") {
    return {
      status: "failed",
      stage,
      title: "Avvio del container non riuscito",
      message: "Il container del team non risulta pronto. Il team non è stato avviato.",
      code: value.code,
      retryable: value.retryable,
    };
  }
  return {
    status: "failed",
    stage,
    message: value.message,
    code: value.code,
    retryable: value.retryable,
  };
}

function sshHostKeyFailure(error: unknown): OnboardingRuntimeState {
  const code = typeof error === "object" && error !== null &&
    typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : null;
  if (code === "host_key_mismatch" || code === "host_key_changed") {
    return {
      status: "failed",
      stage: "ssh-host-key",
      code,
      retryable: false,
      message: "La chiave SSH osservata non coincide con quella verificata. Connessione bloccata.",
    };
  }
  return {
    status: "failed",
    stage: "ssh-host-key",
    retryable: true,
    message: failureMessage("ssh-host-key"),
  };
}

function failureMessage(stage: OnboardingRuntimeStage): string {
  if (stage === "provider-login") return "L’accesso al provider non è stato verificato. Riprova.";
  if (stage === "ssh-host-key") return "L’identità SSH del server non è stata verificata. Controlla il fingerprint e riprova.";
  if (stage === "team-start") return "Il team non risulta ancora operativo. Riprova.";
  if (stage === "assistant") return "Assistente o chat diretta non risultano ancora pronti. Riprova.";
  if (stage === "container") return "Il container non risulta attivo. Verifica il runtime e riprova.";
  if (stage === "provider") return "Il provider non è stato preparato. Riprova.";
  return "La preparazione del runtime non è stata verificata. Riprova.";
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
    message: "Il runtime salvato non risulta pronto. Riparti dal setup tecnico.",
  };
  if (!snapshot.containerRunning) return {
    status: "failed", stage: "container", retryable: false,
    message: "Il container salvato non risulta attivo. Riparti dal setup tecnico.",
  };
  if (!snapshot.providerConfigured) return {
    status: "failed", stage: "provider", retryable: false,
    message: "Il provider salvato non risulta configurato. Riparti dal setup tecnico.",
  };
  if (!snapshot.providerAuthenticated) return {
    status: "failed", stage: "provider-login", retryable: false,
    message: "L’accesso al provider non risulta più valido. Riparti dal setup tecnico.",
  };
  return null;
}

function resumedBackendFailure(error: unknown): OnboardingRuntimeState | "collecting-host" | null {
  const code = nativeErrorCode(error);
  if (code === "host_not_configured" || code === "host_config_invalid") return "collecting-host";
  if (code === "resume_runtime_not_ready") return {
    status: "failed", stage: "runtime", code, retryable: false,
    message: "Il runtime salvato non risulta pronto. Riparti dal setup tecnico.",
  };
  if (code === "resume_container_not_ready") return {
    status: "failed", stage: "container", code, retryable: false,
    message: "Il container salvato non risulta attivo. Riparti dal setup tecnico.",
  };
  if (code === "resume_provider_not_configured") return {
    status: "failed", stage: "provider", code, retryable: false,
    message: "Il provider salvato non risulta configurato. Riparti dal setup tecnico.",
  };
  if (code === "resume_provider_not_authenticated") return {
    status: "failed", stage: "provider-login", code, retryable: false,
    message: "L’accesso al provider non risulta più valido. Riparti dal setup tecnico.",
  };
  if (code === "team_start_failed" || code === "team_verify_failed") return {
    status: "failed", stage: "team-start", code, retryable: true,
    message: "Le sessioni del team non risultano ancora operative. Riprova.",
  };
  return null;
}

function nativeErrorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null &&
    typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : null;
}

/**
 * The real first-login router. The dashboard mounts only after durable account
 * evidence or after every native runtime fact, the conversational profile and
 * the direct-chat connection have been independently verified.
 */
export default function DashboardApp() {
  const localProfile = localIdentitySelected() ? readLocalProfile() : null;
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
  const submissionRef = useRef<OnboardingSubmission | null>(null);
  const providerSessionRef = useRef<string | null>(null);
  const providerInputRequestRef = useRef<string | null>(null);
  const providerExitRejectRef = useRef<{ attempt: number; reject: (error: Error) => void } | null>(null);
  const providerStoppingAttemptRef = useRef<number | null>(null);
  const providerAttemptRef = useRef(0);
  const resumeAttemptedIdentityRef = useRef<string | null>(null);
  const activeIdentityKeyRef = useRef<string | null>(identityKey);
  activeIdentityKeyRef.current = identityKey;
  const signedOut = !loading && !identityKey;

  const initializeAccount = useCallback(async () => {
    if (!identityKey || !markerId) return;
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
      setGate({ phase: "error", message: GATE_ERROR });
    }
  }, [identityKey, localProfile?.displayName, localProfile?.profileId, markerId, session]);

  useEffect(() => {
    if (signedOut) goTo(LOGIN_PAGE);
  }, [signedOut]);

  useEffect(() => {
    let active = true;
    void readDesktopPlatform().then((detected) => {
      if (active) setPlatform(detected);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
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
    providerInputRequestRef.current = null;
    providerStoppingAttemptRef.current = null;
    providerExitRejectRef.current?.reject(new Error("account-changed"));
    providerExitRejectRef.current = null;
    setProviderLogin(null);
    if (!identityKey) {
      setGate({ phase: "loading" });
      return;
    }
    void initializeAccount();
  }, [identityKey, initializeAccount]);

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
    setRuntime({ status: "failed", stage, message: failureMessage(stage), retryable: true });
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
      setRuntime({ status: "working", stage: "team-start", message: "Avvio container e agenti." });
      beginActivityInvocation();
      const snapshot = await startOnboardingTeam(submission.host, recordActivityProgress);
      setRuntime(runtimeStateFromSnapshot(snapshot));
    } catch (error) {
      fail("team-start", error);
    }
  }, [beginActivityInvocation, fail, recordActivityProgress, setRuntime]);

  const prepareTechnicalSetup = useCallback(async (submission: OnboardingSubmission) => {
    if (!identityKey) throw new Error("identity-missing");
    setRuntime({ status: "working", stage: "runtime", message: "Preparo il runtime production." });
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
      setRuntime({ status: "working", stage: "ssh-host-key", message: "Verifico l’identità SSH del server." });
      try {
        const probe = await probeOnboardingSshHostKey(submission.host);
        if (probe.status === "confirmation_required") {
          setSshHostKey({ algorithm: probe.algorithm, fingerprint: probe.fingerprint });
          setRuntime({ status: "action-required", stage: "ssh-host-key", message: "Confronta e conferma il fingerprint del server." });
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
      setRuntime({ status: "working", stage: "ssh-host-key", message: "Confermo il fingerprint SSH verificato." });
      await confirmOnboardingSshHostKey(
        submission.host,
        sshHostKey,
      );
      setSshHostKey(null);
      await prepareTechnicalSetup(submission);
    } catch (error) {
      failSshHostKey(error);
    }
  }, [fail, failSshHostKey, prepareTechnicalSetup, setRuntime, sshHostKey]);

  const cancelHostKey = useCallback(() => {
    setSshHostKey(null);
    submissionRef.current = null;
    setRuntime({ status: "collecting", stage: "host" });
  }, [setRuntime]);

  const loginProvider = useCallback(async () => {
    const submission = submissionRef.current;
    if (!submission) return fail("provider-login", new Error("submission-missing"));
    const attempt = ++providerAttemptRef.current;
    let sessionId: string | null = null;
    let exited = false;
    try {
      providerInputRequestRef.current = null;
      setProviderLogin({
        provider: submission.provider,
        status: "connecting",
        sanitizedOutput: [],
        action: { instruction: providerLoginInstruction(submission.provider) },
        connectionState: "connecting",
        startedAt: Date.now(),
      });
      setRuntime({ status: "working", stage: "provider-login", message: "Attendo il login ufficiale del provider." });
      beginActivityInvocation();
      let resolveExit!: () => void;
      let rejectExit!: (error: Error) => void;
      const exit = new Promise<void>((resolve, reject) => {
        resolveExit = resolve;
        rejectExit = reject;
      });
      providerExitRejectRef.current = { attempt, reject: rejectExit };
      sessionId = await startOnboardingProviderLogin(submission.host, (event) => {
        if (providerAttemptRef.current !== attempt) return;
        if (event.kind === "output") {
          setProviderLogin((current) => {
            if (!current || current.provider !== submission.provider) return current;
            return { ...current, sanitizedOutput: appendProviderOutput(current.sanitizedOutput, event.text) };
          });
          return;
        }
        if (event.kind === "state") {
          providerInputRequestRef.current = event.action.inputRequest?.id ?? null;
          setProviderLogin((current) => current ? {
            ...current,
            status: "needs_user_action",
            connectionState: "connected",
            action: event.action,
          } : current);
          return;
        }
        exited = true;
        providerInputRequestRef.current = null;
        setProviderLogin((current) => current ? {
          ...current,
          status: event.code === 0 ? "needs_user_action" : "error",
          connectionState: "disconnected",
          safeErrorMessage: event.code === 0 ? undefined : failureMessage("provider-login"),
          exitCode: event.code,
        } : current);
        if (event.code === 0) resolveExit();
        else rejectExit(new Error("provider-login-failed"));
      }, recordActivityProgress);
      providerSessionRef.current = sessionId;
      setProviderLogin((current) => current?.status === "connecting" ? {
        ...current,
        status: "needs_user_action",
        connectionState: "connected",
      } : current);
      if (!exited && (submission.provider === "claude" || submission.provider === "kimi")) {
        await sendOnboardingProviderInput(sessionId, "/login");
      }
      await exit;
      await closeOnboardingProviderLogin(sessionId);
      providerSessionRef.current = null;
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
      setProviderLogin((current) => current ? {
        ...current,
        status: "error",
        connectionState: "disconnected",
        safeErrorMessage: failureMessage("provider-login"),
        exitCode: null,
      } : current);
      return fail("provider-login", error);
    }
    providerInputRequestRef.current = null;
    setProviderLogin(null);
    await startTeam(submission);
  }, [beginActivityInvocation, fail, recordActivityProgress, setRuntime, startTeam]);

  const sendProviderInput = useCallback(async (input: string) => {
    const sessionId = providerSessionRef.current;
    if (!sessionId || !providerInputRequestRef.current) throw new Error("provider-input-not-requested");
    await sendOnboardingProviderInput(sessionId, input);
    providerInputRequestRef.current = null;
    setProviderLogin((current) => current ? {
      ...current,
      action: { instruction: "Risposta inviata. Attendo la verifica del provider." },
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
      message: "L’accesso è stato annullato. Riavvialo quando vuoi continuare.",
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
      setRuntime({ status: "working", stage: "assistant", message: "Apro la chat diretta con l’Assistente." });
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
      setRuntime({ status: "working", stage: "runtime", message: "Verifico lo stato reale della configurazione." });
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
          message: "Le sessioni del team sono ferme. Avviale quando vuoi continuare.",
        });
        return;
      }
      setRuntime({
        status: "action-required",
        stage: "assistant",
        message: "La squadra è attiva. Apri la chat con l’Assistente quando vuoi continuare.",
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
      setRuntime({ status: "working", stage: "team-start", message: "Ripristino le sessioni mancanti del team." });
      beginActivityInvocation();
      const snapshot = await resumeOnboardingTeamStart(recordActivityProgress);
      if (activeIdentityKeyRef.current !== identityKey) throw new Error("account-changed");
      if (!snapshot.assistantRunning || !snapshot.captainRunning) {
        throw new Error("team-start-unverified");
      }
      setRuntime({
        status: "action-required",
        stage: "assistant",
        message: "La squadra è attiva. Apri la chat con l’Assistente quando vuoi continuare.",
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
          message: "Le sessioni del team sono ferme. Avviale quando vuoi continuare.",
        });
        return;
      }
      setRuntime({ status: "working", stage: "assistant", message: "Ricollego la chat verificata con l’Assistente." });
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

  if (!identityKey || accountScope?.identityKey !== identityKey || accountScope.phase === "pending") {
    return <DashboardSkeleton label="Caricamento dashboard" />;
  }
  if (accountScope.phase === "error") {
    return (
      <main role="alert">
        <p>{ACCOUNT_SCOPE_ERROR}</p>
        <button type="button" onClick={() => void initializeAccount()}>Riprova</button>
      </main>
    );
  }
  if (gate.phase === "loading" || (gate.phase === "required" && platform === null)) {
    return <DashboardSkeleton label="Caricamento dashboard" />;
  }
  if (gate.phase === "error") {
    return (
      <main role="alert">
        <p>{gate.message}</p>
        <button type="button" onClick={() => void initializeAccount()}>Riprova</button>
      </main>
    );
  }
  if (gate.phase === "required") {
    if (assistantChatIdentityKey === identityKey) {
      return (
        <main data-testid="onboarding-assistant-chat" aria-label="Onboarding con l’Assistente">
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
