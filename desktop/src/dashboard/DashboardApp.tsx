import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import DashboardSkeleton from "@/app/(protected)/_components/DashboardSkeleton";
import { connectDirectChat } from "../lib/direct-chat";
import { readDesktopPlatform, type DesktopPlatform } from "../lib/desktop-platform";
import {
  loadOnboardingGate,
  markOnboardingReady,
  runtimeStateFromSnapshot,
  saveOnboardingProfile,
  type OnboardingGateState,
  type OnboardingProviderLoginState,
  type OnboardingRuntimeStage,
  type OnboardingRuntimeState,
  type OnboardingSubmission,
} from "../lib/onboarding";
import {
  closeOnboardingProviderLogin,
  openOnboardingAssistant,
  prepareOnboardingRuntime,
  readOnboardingSnapshot,
  sendOnboardingProviderInput,
  startOnboardingProviderLogin,
  startOnboardingTeam,
} from "../lib/onboarding-runtime";
import { goTo, LOGIN_PAGE } from "../lib/pages";
import { supabase, supabaseConfig, useSession } from "../lib/supabase";
import { OnboardingFlow } from "../onboarding";
import Shell from "../shell/Shell";

const GATE_ERROR = "Non riesco a verificare la configurazione dell’account. Riprova.";
const MAX_PROVIDER_OUTPUT = 32_768;

function failureMessage(stage: OnboardingRuntimeStage): string {
  if (stage === "provider-login") return "L’accesso al provider non è stato verificato. Riprova.";
  if (stage === "team-start") return "Il team non risulta ancora operativo. Riprova.";
  if (stage === "assistant") return "Assistente o chat diretta non risultano ancora pronti. Riprova.";
  if (stage === "profile") return "Il profilo non è stato verificato. Controlla i dati e riprova.";
  return "La preparazione del runtime non è stata verificata. Riprova.";
}

function pairingToken(session: Session, submission: OnboardingSubmission): string | null {
  if (submission.host.kind === "local") return null;
  if (!supabaseConfig.configured || !session.refresh_token) throw new Error("pairing-unavailable");
  return window.btoa(JSON.stringify({
    supabase_url: supabaseConfig.url,
    user_id: session.user.id,
    refresh_token: session.refresh_token,
    issued_at: Date.now(),
  }));
}

/**
 * The real first-login router. The dashboard mounts only after durable account
 * evidence or after every native runtime fact, Assistant onboarding and the
 * direct-chat connection have been independently verified.
 */
export default function DashboardApp() {
  const { session, loading } = useSession();
  const [gate, setGate] = useState<OnboardingGateState>({ phase: "loading" });
  const [platform, setPlatform] = useState<DesktopPlatform | null>(null);
  const [providerLogin, setProviderLogin] = useState<OnboardingProviderLoginState | null>(null);
  const submissionRef = useRef<OnboardingSubmission | null>(null);
  const providerSessionRef = useRef<string | null>(null);
  const providerExitRejectRef = useRef<((error: Error) => void) | null>(null);
  const providerAttemptRef = useRef(0);
  const signedOut = !loading && !session;

  const reloadGate = useCallback(async () => {
    if (!session) return;
    setGate({ phase: "loading" });
    try {
      setGate(await loadOnboardingGate(supabase, session.user));
    } catch {
      setGate({ phase: "error", message: GATE_ERROR });
    }
  }, [session]);

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
    let active = true;
    if (!session) {
      setGate({ phase: "loading" });
      return () => { active = false; };
    }
    setGate({ phase: "loading" });
    void loadOnboardingGate(supabase, session.user)
      .then((next) => {
        if (active) setGate(next);
      })
      .catch(() => {
        if (active) setGate({ phase: "error", message: GATE_ERROR });
      });
    return () => { active = false; };
  }, [session]);

  const setRuntime = useCallback((runtime: OnboardingRuntimeState) => {
    setGate((current) => current.phase === "required" ? { ...current, runtime } : current);
  }, []);

  const fail = useCallback((stage: OnboardingRuntimeStage, error: unknown): never => {
    setRuntime({ status: "failed", stage, message: failureMessage(stage) });
    throw error;
  }, [setRuntime]);

  const startTeam = useCallback(async (submission: OnboardingSubmission) => {
    try {
      setRuntime({ status: "working", stage: "team-start", message: "Avvio container e agenti." });
      const snapshot = await startOnboardingTeam(submission.host, (progress) => {
        setRuntime({ status: "working", stage: "team-start", message: progress.message });
      });
      setRuntime(runtimeStateFromSnapshot(snapshot));
    } catch (error) {
      fail("team-start", error);
    }
  }, [fail, setRuntime]);

  const submit = useCallback(async (submission: OnboardingSubmission) => {
    if (!session) throw new Error("session-missing");
    submissionRef.current = submission;
    try {
      await saveOnboardingProfile(supabase, session.user, submission.profile);
    } catch (error) {
      fail("profile", error);
    }
    setRuntime({ status: "working", stage: "runtime", message: "Preparo il runtime production." });
    const snapshot = await prepareOnboardingRuntime(
      submission,
      pairingToken(session, submission),
      session.user.email ?? "",
      (progress) => setRuntime({ status: "working", stage: progress.stage, message: progress.message }),
    ).catch((error) => fail("runtime", error));
    if (!snapshot.providerAuthenticated) {
      setRuntime(runtimeStateFromSnapshot(snapshot));
      return;
    }
    await startTeam(submission);
  }, [fail, session, setRuntime, startTeam]);

  const loginProvider = useCallback(async () => {
    const submission = submissionRef.current;
    if (!submission) return fail("provider-login", new Error("submission-missing"));
    const attempt = ++providerAttemptRef.current;
    let sessionId: string | null = null;
    let exited = false;
    try {
      setProviderLogin({ provider: submission.provider, status: "starting", output: "" });
      setRuntime({ status: "working", stage: "provider-login", message: "Attendo il login ufficiale del provider." });
      let resolveExit!: () => void;
      let rejectExit!: (error: Error) => void;
      const exit = new Promise<void>((resolve, reject) => {
        resolveExit = resolve;
        rejectExit = reject;
      });
      providerExitRejectRef.current = rejectExit;
      sessionId = await startOnboardingProviderLogin(submission.host, (event) => {
        if (providerAttemptRef.current !== attempt) return;
        if (event.kind === "output") {
          setProviderLogin((current) => {
            if (!current || current.provider !== submission.provider) return current;
            const output = `${current.output}${event.text}`.slice(-MAX_PROVIDER_OUTPUT);
            return { ...current, output };
          });
          return;
        }
        exited = true;
        setProviderLogin((current) => current ? {
          ...current,
          status: "exited",
          exitCode: event.code,
        } : current);
        if (event.kind === "exit") {
          if (event.code === 0) resolveExit();
          else rejectExit(new Error("provider-login-failed"));
        }
      });
      providerSessionRef.current = sessionId;
      setProviderLogin((current) => current?.status === "starting" ? { ...current, status: "active" } : current);
      if (!exited && submission.provider !== "codex") {
        await sendOnboardingProviderInput(sessionId, "/login");
      }
      await exit;
      await closeOnboardingProviderLogin(sessionId);
      providerSessionRef.current = null;
      providerExitRejectRef.current = null;
      sessionId = null;
      const snapshot = await readOnboardingSnapshot(submission.host);
      if (!snapshot.providerAuthenticated) throw new Error("provider-login-unverified");
    } catch (error) {
      providerExitRejectRef.current = null;
      if (providerSessionRef.current === sessionId) providerSessionRef.current = null;
      if (sessionId) void closeOnboardingProviderLogin(sessionId).catch(() => undefined);
      if (providerAttemptRef.current === attempt) {
        setProviderLogin((current) => current ? { ...current, status: "exited", exitCode: null } : current);
      }
      fail("provider-login", error);
    }
    await startTeam(submission);
  }, [fail, setRuntime, startTeam]);

  const sendProviderInput = useCallback(async (input: string) => {
    const sessionId = providerSessionRef.current;
    if (!sessionId) throw new Error("provider-session-missing");
    await sendOnboardingProviderInput(sessionId, input);
  }, []);

  const closeProviderLogin = useCallback(async () => {
    const sessionId = providerSessionRef.current;
    if (!sessionId) return;
    await closeOnboardingProviderLogin(sessionId);
    if (providerSessionRef.current === sessionId) providerSessionRef.current = null;
    providerExitRejectRef.current?.(new Error("provider-login-closed"));
    providerExitRejectRef.current = null;
    setProviderLogin((current) => current ? { ...current, status: "exited", exitCode: null } : current);
  }, []);

  const finishAssistant = useCallback(async () => {
    const submission = submissionRef.current;
    if (!submission || !session) return fail("assistant", new Error("submission-missing"));
    try {
      setRuntime({ status: "working", stage: "assistant", message: "Apro l’Assistente e verifico il primo contatto." });
      const nativeSnapshot = await openOnboardingAssistant(submission.host);
      const chat = await connectDirectChat(submission.host);
      const snapshot = { ...nativeSnapshot, directChatReady: chat.state === "ready" };
      if (!snapshot.directChatReady) throw new Error("direct-chat-unverified");
      markOnboardingReady(session.user.id, snapshot);
      setRuntime({ status: "ready" });
      setGate({ phase: "ready" });
    } catch (error) {
      fail("assistant", error);
    }
  }, [fail, session, setRuntime]);

  const runtimeAction = useCallback(async (stage: "provider-login" | "assistant") => {
    if (stage === "provider-login") return loginProvider();
    return finishAssistant();
  }, [finishAssistant, loginProvider]);

  const retry = useCallback(async () => {
    if (gate.phase !== "required" || gate.runtime.status !== "failed") return;
    const { stage } = gate.runtime;
    const submission = submissionRef.current;
    if (stage === "profile") {
      setRuntime({ status: "collecting", stage: "profile" });
      return;
    }
    if (!submission) return fail(stage, new Error("submission-missing"));
    if (stage === "provider-login") return loginProvider();
    if (stage === "team-start") return startTeam(submission);
    if (stage === "assistant") return finishAssistant();
    return submit(submission);
  }, [fail, finishAssistant, gate, loginProvider, setRuntime, startTeam, submit]);

  if (!session || gate.phase === "loading" || (gate.phase === "required" && platform === null)) {
    return <DashboardSkeleton label="Caricamento dashboard" />;
  }
  if (gate.phase === "error") {
    return (
      <main role="alert">
        <p>{gate.message}</p>
        <button type="button" onClick={() => void reloadGate()}>Riprova</button>
      </main>
    );
  }
  if (gate.phase === "required") {
    return (
      <OnboardingFlow
        account={gate.account}
        platform={platform ?? "other"}
        initialDraft={gate.initialDraft}
        runtime={gate.runtime}
        onSubmit={submit}
        onRuntimeAction={runtimeAction}
        providerLogin={providerLogin}
        onProviderInput={sendProviderInput}
        onProviderClose={closeProviderLogin}
        onRetry={retry}
      />
    );
  }
  return <Shell key={session.user.id} />;
}
