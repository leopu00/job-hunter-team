import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectDirectChat, directChatStatus, reconnectDirectChat } from "../lib/direct-chat";
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
import { readDesktopPlatform } from "../lib/desktop-platform";
import { ERROR_CATALOG } from "../lib/error-catalog";
import type { ExistingTeamConnectModalProps } from "../onboarding/ExistingTeamConnectModal";
import {
  loadOnboardingGate,
  markOnboardingReady,
  markOnboardingStarted,
  resetOnboardingMarker,
  type OnboardingFlowProps,
  type OnboardingRuntimeSnapshot,
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
} from "../lib/onboarding-runtime";
import { DASHBOARD_PAGE, goTo, LOGIN_PAGE } from "../lib/pages";
import { useSession } from "../lib/supabase";
import { navigate } from "../shell/router";
import DashboardApp from "./DashboardApp";

vi.mock("../lib/supabase", () => ({
  supabase: { from: vi.fn() },
  supabaseConfig: { configured: true, url: "https://example.invalid" },
  supabaseConfigured: true,
  useSession: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("../lib/pages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/pages")>()),
  goTo: vi.fn(),
}));
vi.mock("../lib/onboarding", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/onboarding")>()),
  loadOnboardingGate: vi.fn(),
  markOnboardingReady: vi.fn(),
  markOnboardingStarted: vi.fn(),
  resetOnboardingMarker: vi.fn(),
}));
vi.mock("../lib/onboarding-runtime", () => ({
  closeOnboardingProviderLogin: vi.fn(),
  confirmOnboardingSshHostKey: vi.fn(),
  openOnboardingAssistant: vi.fn(),
  prepareOnboardingRuntime: vi.fn(),
  probeOnboardingSshHostKey: vi.fn(),
  readOnboardingSnapshot: vi.fn(),
  resumeOnboardingSnapshot: vi.fn(),
  resumeOnboardingTeamStart: vi.fn(),
  sendOnboardingProviderInput: vi.fn(),
  startOnboardingProviderLogin: vi.fn(),
  startOnboardingTeam: vi.fn(),
}));
vi.mock("../lib/direct-chat", () => ({
  connectDirectChat: vi.fn(),
  directChatStatus: vi.fn(),
  reconnectDirectChat: vi.fn(),
}));
vi.mock("../lib/desktop-account-scope", () => ({
  activateDesktopAccountScope: vi.fn(),
  activateDesktopLocalScope: vi.fn(),
  clearDesktopAccountScope: vi.fn(),
  migrateDesktopLocalProfileToAccount: vi.fn(),
  probeDesktopLocalProfileMigration: vi.fn(),
}));
vi.mock("../lib/local-profile", () => ({
  activateSavedLocalProfile: vi.fn(),
  clearLocalIdentitySelection: vi.fn(),
  finalizeLocalProfileMigration: vi.fn(),
  localIdentitySelected: vi.fn(),
  readLocalProfile: vi.fn(),
}));
vi.mock("../lib/identity-choice", () => ({
  clearGoogleIdentitySelection: vi.fn(),
  googleIdentitySelected: vi.fn(),
}));
vi.mock("../shell/router", () => ({ navigate: vi.fn() }));
vi.mock("../lib/desktop-platform", () => ({ readDesktopPlatform: vi.fn() }));
vi.mock("../shell/Shell", () => ({
  default: ({ onLogout }: { onLogout?: () => Promise<void> }) => (
    <main data-testid="shell">
      Shell
      {onLogout && <button type="button" onClick={() => void onLogout()}>local-logout</button>}
    </main>
  ),
}));
vi.mock("../pages/messages", () => ({ default: () => <section data-testid="assistant-chat">Assistente</section> }));
vi.mock("../onboarding", () => ({
  OnboardingFlow: (props: OnboardingFlowProps) => {
    const stage = props.runtime.status === "ready" ? "" : `:${props.runtime.stage}`;
    const action = props.runtime.status === "action-required" ? props.runtime.stage : null;
    return (
      <section data-testid="onboarding">
        <p>platform:{props.platform}</p>
        <p>{props.runtime.status}{stage}</p>
        {"message" in props.runtime && <p>{props.runtime.message}</p>}
        {props.runtime.status === "failed" && props.runtime.action && <p>Cosa fare: {props.runtime.action}</p>}
        {props.activity?.current && <p data-testid="activity-current">{props.activity.current.name}:{props.activity.current.description}</p>}
        {props.activity && <p data-testid="activity-count">activity:{props.activity.events.length}</p>}
        {props.activity && (
          <ol data-testid="activity-events">
            {props.activity.events.map((event) => (
              <li key={event.id}>{event.invocation}:{event.nativeStage}:{event.status}:{event.stageElapsedMs}:{event.description}</li>
            ))}
          </ol>
        )}
        {props.runtime.status === "failed" && props.runtime.code && <p>code:{props.runtime.code}</p>}
        {props.runtime.status === "failed" && props.runtime.title && <p>title:{props.runtime.title}</p>}
        <button type="button" onClick={() => void props.onSubmit(SUBMISSION).catch(() => undefined)}>submit-onboarding</button>
        <button type="button" onClick={() => void props.onSubmit(SUBMISSION_VPS).catch(() => undefined)}>submit-vps</button>
        {(["claude", "codex", "kimi"] as const).map((provider) => (
          <button key={provider} type="button" onClick={() => void props.onSubmit({ ...SUBMISSION, provider }).catch(() => undefined)}>submit-{provider}</button>
        ))}
        {action && action !== "ssh-host-key" && <button type="button" onClick={() => void props.onRuntimeAction(action).catch(() => undefined)}>continue-runtime</button>}
        {action === "ssh-host-key" && props.sshHostKey && (
          <>
            <p>{props.sshHostKey.algorithm}</p><p>{props.sshHostKey.fingerprint}</p>
            <button type="button" onClick={() => void props.onConfirmHostKey().catch(() => undefined)}>confirm-host-key</button>
            <button type="button" onClick={props.onCancelHostKey}>cancel-host-key</button>
          </>
        )}
        {props.providerLogin && (
          <>
            <p>provider-state:{props.providerLogin.status}</p>
            <p>provider-connection:{props.providerLogin.connectionState}</p>
            {props.providerLogin.safeErrorMessage && <p>provider-error:{props.providerLogin.safeErrorMessage}</p>}
            {props.providerLogin.actions.map((action) => action.kind === "url" && <p key="url">provider-url:{action.safeUrl}</p>)}
            {props.providerLogin.actions.map((action) => action.kind === "code" && <p key="code">provider-code:{action.userCode}</p>)}
            {props.providerLogin.actions.some((action) => action.kind === "input") && (
              <button type="button" onClick={() => void props.onProviderInput("verification response").catch(() => undefined)}>send-provider-input</button>
            )}
            <button type="button" onClick={() => void props.onProviderClose().catch(() => undefined)}>cancel-provider-login</button>
            <button type="button" onClick={() => void props.onProviderRestart().catch(() => undefined)}>restart-provider-login</button>
          </>
        )}
        {props.runtime.status === "failed" && props.runtime.retryable !== false && (
          <button type="button" onClick={() => void props.onRetry().catch(() => undefined)}>retry-runtime</button>
        )}
        {props.runtime.status === "failed" && props.runtime.retryable === false && (
          <button type="button" onClick={props.onExitFailure}>exit-failure</button>
        )}
        {props.runtime.status !== "collecting" && (
          <button type="button" onClick={() => void props.onRestart().catch(() => undefined)}>restart-onboarding</button>
        )}
      </section>
    );
  },
}));
vi.mock("../onboarding/ExistingTeamConnectModal", () => ({
  default: (props: ExistingTeamConnectModalProps) => {
    const result = (profileReady: boolean): OnboardingRuntimeSnapshot => ({
      runtimeInstalled: true,
      containerRunning: true,
      providerConfigured: true,
      providerAuthenticated: true,
      assistantRunning: true,
      captainRunning: true,
      profileReady,
      assistantWelcomed: false,
      directChatReady: false,
    });
    return (
      <section data-testid="existing-team-modal">
        <p>team:{props.teamId}</p>
        <button type="button" onClick={props.onCancel}>cancel-existing-team</button>
        <button type="button" onClick={() => void props.onConnected(result(false))}>connect-existing-team-incomplete</button>
        <button type="button" onClick={() => void props.onConnected(result(true))}>connect-existing-team-ready</button>
      </section>
    );
  },
}));

const SUBMISSION: OnboardingSubmission = { host: { kind: "local" }, provider: "claude" };
const SUBMISSION_VPS: OnboardingSubmission = {
  host: { kind: "vps", address: "host.example.invalid", user: "root", port: 22, keyPath: "/synthetic/key" },
  provider: "claude",
};
const PREPARED: OnboardingRuntimeSnapshot = {
  runtimeInstalled: true,
  containerRunning: true,
  providerConfigured: true,
  providerAuthenticated: false,
  assistantRunning: false,
  captainRunning: false,
  profileReady: false,
  assistantWelcomed: false,
  directChatReady: false,
};
const TEAM_READY: OnboardingRuntimeSnapshot = {
  ...PREPARED,
  providerAuthenticated: true,
  assistantRunning: true,
  captainRunning: true,
};

type SessionState = ReturnType<typeof useSession>;
function signedInAs(userId: string): SessionState {
  return {
    session: {
      user: { id: userId, email: `${userId}@example.invalid`, user_metadata: {} },
      refresh_token: `synthetic-${userId}`,
    },
    loading: false,
  } as unknown as SessionState;
}

function requireOnboarding() {
  vi.mocked(loadOnboardingGate).mockResolvedValue({
    phase: "required",
    account: { displayName: "Synthetic Person" },
    resumeAvailable: false,
    runtime: { status: "collecting", stage: "host" },
  });
}

async function reachAssistant(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "submit-onboarding" }));
  await user.click(await screen.findByRole("button", { name: "continue-runtime" }));
}

describe("DashboardApp onboarding router", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    vi.mocked(readDesktopPlatform).mockResolvedValue("macos");
    vi.mocked(closeOnboardingProviderLogin).mockResolvedValue();
    vi.mocked(confirmOnboardingSshHostKey).mockResolvedValue();
    vi.mocked(sendOnboardingProviderInput).mockResolvedValue();
    vi.mocked(connectDirectChat).mockResolvedValue({ state: "ready" });
    vi.mocked(directChatStatus).mockResolvedValue({ state: "ready" });
    vi.mocked(reconnectDirectChat).mockResolvedValue({ state: "ready" });
    vi.mocked(resumeOnboardingTeamStart).mockResolvedValue(TEAM_READY);
    vi.mocked(activateDesktopAccountScope).mockResolvedValue();
    vi.mocked(activateDesktopLocalScope).mockResolvedValue();
    vi.mocked(clearDesktopAccountScope).mockResolvedValue();
    vi.mocked(migrateDesktopLocalProfileToAccount).mockResolvedValue({ receiptHash: "a".repeat(64) });
    vi.mocked(probeDesktopLocalProfileMigration).mockResolvedValue(false);
    vi.mocked(activateSavedLocalProfile).mockResolvedValue({
      profileId: "opaque-local-profile",
      displayName: "Synthetic Local",
    });
    vi.mocked(finalizeLocalProfileMigration).mockReset();
    vi.mocked(clearGoogleIdentitySelection).mockReset();
    vi.mocked(localIdentitySelected).mockReturnValue(false);
    vi.mocked(readLocalProfile).mockReturnValue(null);
    vi.mocked(googleIdentitySelected).mockReturnValue(true);
    vi.mocked(probeOnboardingSshHostKey).mockResolvedValue({
      status: "pinned", algorithm: "ssh-ed25519", fingerprint: "SHA256:synthetic",
    });
  });

  afterEach(() => vi.useRealTimers());

  it("sends whoever has no session to Google sign-in", () => {
    vi.mocked(googleIdentitySelected).mockReturnValue(false);
    vi.mocked(useSession).mockReturnValue({ session: null, loading: false });
    render(<DashboardApp />);
    expect(useSession).toHaveBeenCalledWith(undefined, false);
    expect(goTo).toHaveBeenCalledWith(LOGIN_PAGE);
    expect(loadOnboardingGate).not.toHaveBeenCalled();
  });

  it("activates a saved local scope before mounting onboarding without a Supabase session", async () => {
    vi.mocked(useSession).mockReturnValue({ session: null, loading: false });
    vi.mocked(localIdentitySelected).mockReturnValue(true);
    vi.mocked(readLocalProfile).mockReturnValue({
      profileId: "opaque-local-profile",
      displayName: "Ada Locale",
    });

    render(<DashboardApp />);

    expect(await screen.findByTestId("onboarding")).toBeInTheDocument();
    expect(useSession).toHaveBeenCalledWith(undefined, false);
    expect(activateDesktopLocalScope).toHaveBeenCalledWith("opaque-local-profile");
    expect(activateDesktopAccountScope).not.toHaveBeenCalled();
    expect(loadOnboardingGate).not.toHaveBeenCalled();
  });

  it("fails closed when a saved local profile is not owned by the backend", async () => {
    vi.mocked(useSession).mockReturnValue({ session: null, loading: false });
    vi.mocked(localIdentitySelected).mockReturnValue(true);
    vi.mocked(readLocalProfile).mockReturnValue({
      profileId: "unowned-local-profile",
      displayName: "Profilo non valido",
    });
    vi.mocked(activateDesktopLocalScope).mockRejectedValue({ code: "account_scope_mismatch" });

    render(<DashboardApp />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/isolamento dell.account/i);
    expect(screen.queryByTestId("onboarding")).not.toBeInTheDocument();
    expect(screen.queryByTestId("shell")).not.toBeInTheDocument();
    expect(screen.queryByTestId("assistant-chat")).not.toBeInTheDocument();
    expect(reconnectDirectChat).not.toHaveBeenCalled();
  });

  it.each(["claude", "codex", "kimi"] as const)(
    "keeps local identity independent while choosing the %s provider",
    async (provider) => {
      vi.mocked(useSession).mockReturnValue({ session: null, loading: false });
      vi.mocked(localIdentitySelected).mockReturnValue(true);
      vi.mocked(readLocalProfile).mockReturnValue({
        profileId: "opaque-local-provider-profile",
        displayName: "Ada Locale",
      });
      vi.mocked(prepareOnboardingRuntime).mockResolvedValue(PREPARED);

      render(<DashboardApp />);
      await userEvent.click(await screen.findByRole("button", { name: `submit-${provider}` }));

      expect(prepareOnboardingRuntime).toHaveBeenCalledWith(
        expect.objectContaining({ provider }),
        null,
        expect.any(Function),
      );
    },
  );

  it("never pairs a local VPS to a dormant Google session", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("dormant-google-account"));
    vi.mocked(localIdentitySelected).mockReturnValue(true);
    vi.mocked(readLocalProfile).mockReturnValue({
      profileId: "opaque-local-vps-profile",
      displayName: "Ada Locale",
    });
    vi.mocked(prepareOnboardingRuntime).mockResolvedValue(PREPARED);

    render(<DashboardApp />);
    await userEvent.click(await screen.findByRole("button", { name: "submit-vps" }));

    expect(prepareOnboardingRuntime).toHaveBeenCalledWith(
      SUBMISSION_VPS,
      null,
      expect.any(Function),
    );
  });

  it("awaits local scope teardown before leaving Shell and preserves the saved profile", async () => {
    vi.mocked(useSession).mockReturnValue({ session: null, loading: false });
    vi.mocked(localIdentitySelected).mockReturnValue(true);
    vi.mocked(readLocalProfile).mockReturnValue({
      profileId: "opaque-ready-local-profile",
      displayName: "Ada Locale",
    });
    localStorage.setItem(
      "jht.desktop.onboarding.local:opaque-ready-local-profile",
      "subscription-v1",
    );

    render(<DashboardApp />);
    await userEvent.click(await screen.findByRole("button", { name: "local-logout" }));

    expect(clearDesktopAccountScope).toHaveBeenCalledOnce();
    expect(clearLocalIdentitySelection).toHaveBeenCalledOnce();
    expect(vi.mocked(clearDesktopAccountScope).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(clearLocalIdentitySelection).mock.invocationCallOrder[0]);
    expect(goTo).toHaveBeenCalledWith(LOGIN_PAGE);
  });

  it("requires an explicit gesture before migrating local ownership to Google", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("synthetic-google-account"));
    let saved: { profileId: string; displayName: string } | null = {
      profileId: "opaque-local-profile",
      displayName: "Synthetic Local",
    };
    vi.mocked(readLocalProfile).mockImplementation(() => saved);
    vi.mocked(probeDesktopLocalProfileMigration).mockResolvedValue(true);
    vi.mocked(finalizeLocalProfileMigration).mockImplementation(() => { saved = null; });
    requireOnboarding();

    render(<DashboardApp />);

    expect(await screen.findByRole("heading", {
      name: "Collega il profilo locale al tuo account Google?",
    })).toBeInTheDocument();
    expect(probeDesktopLocalProfileMigration).toHaveBeenCalledWith("opaque-local-profile");
    expect(migrateDesktopLocalProfileToAccount).not.toHaveBeenCalled();
    expect(activateDesktopAccountScope).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Collega e continua" }));

    await waitFor(() => expect(activateDesktopAccountScope).toHaveBeenCalledOnce());
    expect(migrateDesktopLocalProfileToAccount).toHaveBeenCalledWith("opaque-local-profile");
    expect(finalizeLocalProfileMigration).toHaveBeenCalledWith("opaque-local-profile");
    expect(vi.mocked(probeDesktopLocalProfileMigration).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(migrateDesktopLocalProfileToAccount).mock.invocationCallOrder[0]);
    expect(vi.mocked(migrateDesktopLocalProfileToAccount).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(finalizeLocalProfileMigration).mock.invocationCallOrder[0]);
    expect(vi.mocked(finalizeLocalProfileMigration).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(activateDesktopAccountScope).mock.invocationCallOrder[0]);
  });

  it("cancels migration back to local without changing runtime ownership", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("synthetic-google-account"));
    vi.mocked(readLocalProfile).mockReturnValue({
      profileId: "opaque-local-profile",
      displayName: "Synthetic Local",
    });
    vi.mocked(probeDesktopLocalProfileMigration).mockResolvedValue(true);

    render(<DashboardApp />);
    await userEvent.click(await screen.findByRole("button", { name: "Annulla e resta in locale" }));

    expect(migrateDesktopLocalProfileToAccount).not.toHaveBeenCalled();
    expect(activateDesktopAccountScope).not.toHaveBeenCalled();
    expect(activateSavedLocalProfile).toHaveBeenCalledOnce();
    expect(clearGoogleIdentitySelection).toHaveBeenCalledOnce();
    expect(goTo).toHaveBeenCalledWith(DASHBOARD_PAGE);
  });

  it("keeps terminal migration failures closed without automatic retry", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("synthetic-google-account"));
    vi.mocked(readLocalProfile).mockReturnValue({
      profileId: "opaque-local-profile",
      displayName: "Synthetic Local",
    });
    vi.mocked(probeDesktopLocalProfileMigration).mockResolvedValue(true);
    vi.mocked(migrateDesktopLocalProfileToAccount).mockRejectedValue({
      code: "local_migration_review_pending",
    });

    render(<DashboardApp />);
    await userEvent.click(await screen.findByRole("button", { name: "Collega e continua" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/runtime resta intestato/i);
    expect(screen.queryByRole("button", { name: "Riprova" })).not.toBeInTheDocument();
    expect(finalizeLocalProfileMigration).not.toHaveBeenCalled();
    expect(activateDesktopAccountScope).not.toHaveBeenCalled();
  });

  it("routes a new account to technical host setup and a complete account to Shell", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("new-account"));
    requireOnboarding();
    const view = render(<DashboardApp />);
    expect(await screen.findByTestId("onboarding")).toHaveTextContent("collecting:host");

    vi.mocked(loadOnboardingGate).mockResolvedValue({ phase: "ready" });
    vi.mocked(useSession).mockReturnValue(signedInAs("complete-account"));
    view.rerender(<DashboardApp />);
    expect(await screen.findByTestId("shell")).toBeInTheDocument();
  });

  it("mounts no onboarding, Shell or chat before backend account scope is confirmed", async () => {
    let confirmScope!: () => void;
    vi.mocked(activateDesktopAccountScope).mockReturnValue(new Promise<void>((resolve) => {
      confirmScope = resolve;
    }));
    vi.mocked(useSession).mockReturnValue(signedInAs("scope-pending"));
    requireOnboarding();

    render(<DashboardApp />);
    expect(await screen.findByLabelText("Caricamento dashboard")).toBeInTheDocument();
    expect(loadOnboardingGate).not.toHaveBeenCalled();
    expect(screen.queryByTestId("onboarding")).not.toBeInTheDocument();
    expect(screen.queryByTestId("shell")).not.toBeInTheDocument();
    expect(screen.queryByTestId("assistant-chat")).not.toBeInTheDocument();

    confirmScope();
    expect(await screen.findByTestId("onboarding")).toBeInTheDocument();
    expect(activateDesktopAccountScope).toHaveBeenCalledWith();
  });

  it("fails closed on account-scope mismatch without mounting runtime surfaces", async () => {
    vi.mocked(activateDesktopAccountScope).mockRejectedValue({ code: "account_scope_mismatch" });
    vi.mocked(useSession).mockReturnValue(signedInAs("scope-mismatch"));
    vi.mocked(loadOnboardingGate).mockResolvedValue({ phase: "ready" });

    render(<DashboardApp />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/isolamento dell.account/i);
    expect(loadOnboardingGate).not.toHaveBeenCalled();
    expect(screen.queryByTestId("onboarding")).not.toBeInTheDocument();
    expect(screen.queryByTestId("shell")).not.toBeInTheDocument();
    expect(screen.queryByTestId("assistant-chat")).not.toBeInTheDocument();
    expect(reconnectDirectChat).not.toHaveBeenCalled();
  });

  it("removes account A surfaces synchronously while account B scope is pending", async () => {
    let current = signedInAs("account-a");
    let confirmB!: () => void;
    vi.mocked(useSession).mockImplementation(() => current);
    vi.mocked(loadOnboardingGate).mockResolvedValue({ phase: "ready" });
    let activation = 0;
    vi.mocked(activateDesktopAccountScope).mockImplementation(() => {
      activation += 1;
      if (activation === 2) {
        return new Promise<void>((resolve) => { confirmB = resolve; });
      }
      return Promise.resolve();
    });

    const view = render(<DashboardApp />);
    expect(await screen.findByTestId("shell")).toBeInTheDocument();

    current = signedInAs("account-b");
    view.rerender(<DashboardApp />);
    expect(screen.queryByTestId("shell")).not.toBeInTheDocument();
    expect(screen.queryByTestId("assistant-chat")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Caricamento dashboard")).toBeInTheDocument();

    await waitFor(() => expect(activateDesktopAccountScope).toHaveBeenCalledTimes(2));
    await act(async () => confirmB());
    expect(await screen.findByTestId("shell")).toBeInTheDocument();
    expect(activateDesktopAccountScope).toHaveBeenCalledTimes(2);
  });

  it("offers the account-scoped existing team before new setup and cancel returns to setup", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("existing-account"));
    vi.mocked(loadOnboardingGate).mockResolvedValue({
      phase: "required",
      account: { displayName: "Existing Person" },
      resumeAvailable: false,
      existingTeam: { teamId: "team-opaque-0001", status: "available" },
      runtime: { status: "collecting", stage: "host" },
    });

    const user = userEvent.setup();
    render(<DashboardApp />);
    expect(await screen.findByTestId("existing-team-modal")).toHaveTextContent("team:team-opaque-0001");
    expect(screen.queryByTestId("onboarding")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "cancel-existing-team" }));
    expect(await screen.findByTestId("onboarding")).toBeInTheDocument();
    expect(reconnectDirectChat).not.toHaveBeenCalled();
    expect(markOnboardingStarted).not.toHaveBeenCalled();
  });

  it("keeps an attached existing team in confined Assistant chat until its profile is ready", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("existing-incomplete"));
    vi.mocked(loadOnboardingGate).mockResolvedValue({
      phase: "required",
      account: { displayName: "Existing Person" },
      resumeAvailable: false,
      existingTeam: { teamId: "team-opaque-0002", status: "available" },
      runtime: { status: "collecting", stage: "host" },
    });
    vi.mocked(resumeOnboardingSnapshot).mockResolvedValue({ ...TEAM_READY, profileReady: false });

    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(await screen.findByRole("button", { name: "connect-existing-team-incomplete" }));

    expect(await screen.findByTestId("assistant-chat")).toBeInTheDocument();
    expect(screen.queryByTestId("shell")).not.toBeInTheDocument();
    expect(markOnboardingStarted).toHaveBeenCalledWith("existing-incomplete");
    expect(markOnboardingReady).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/messages?agent=assistente", { replace: true });
  });

  it("admits an attached existing team directly to Shell only when readiness is verified", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("existing-ready"));
    vi.mocked(loadOnboardingGate).mockResolvedValue({
      phase: "required",
      account: { displayName: "Ready Person" },
      resumeAvailable: false,
      existingTeam: { teamId: "team-opaque-0003", status: "available" },
      runtime: { status: "collecting", stage: "host" },
    });

    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(await screen.findByRole("button", { name: "connect-existing-team-ready" }));

    expect(await screen.findByTestId("shell")).toBeInTheDocument();
    expect(markOnboardingReady).toHaveBeenCalledWith(
      "existing-ready",
      expect.objectContaining({ profileReady: true, directChatReady: true }),
    );
    expect(markOnboardingStarted).not.toHaveBeenCalled();
    expect(screen.queryByTestId("assistant-chat")).not.toBeInTheDocument();
  });

  it("maps preparing, Podman, container and provider progress without optimistic completion", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("progress-account"));
    requireOnboarding();
    let emit!: Parameters<Parameters<typeof prepareOnboardingRuntime>[2]>[0] extends never ? never : Parameters<typeof prepareOnboardingRuntime>[2];
    let resolve!: (snapshot: OnboardingRuntimeSnapshot) => void;
    vi.mocked(prepareOnboardingRuntime).mockImplementation((_submission, _token, onProgress) => {
      emit = onProgress;
      return new Promise((done) => { resolve = done; });
    });

    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(await screen.findByRole("button", { name: "submit-onboarding" }));
    act(() => emit({
      stage: "engine", status: "start", message: "Preparo il runtime locale.",
      sequence: 1, elapsedMs: 0, code: null, retryable: null,
    }));
    expect(screen.getByTestId("onboarding")).toHaveTextContent("working:runtime");
    act(() => emit({
      stage: "container", status: "progress", message: "Verifico il container.",
      sequence: 2, elapsedMs: 2_000, code: null, retryable: null,
    }));
    expect(screen.getByTestId("onboarding")).toHaveTextContent("working:container");
    act(() => emit({
      stage: "provider", status: "progress", message: "Preparo il provider.",
      sequence: 3, elapsedMs: 1_000, code: null, retryable: null,
    }));
    expect(screen.getByTestId("onboarding")).toHaveTextContent("working:provider");
    expect(screen.queryByRole("button", { name: "continue-runtime" })).not.toBeInTheDocument();

    await act(async () => resolve(PREPARED));
    expect(await screen.findByText("action-required:provider-login")).toBeInTheDocument();
    expect(markOnboardingReady).not.toHaveBeenCalled();
  });

  it("replays a container failure and invokes exactly one retry only after the explicit click", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("container-replay-account"));
    requireOnboarding();
    let invocation = 0;
    vi.mocked(prepareOnboardingRuntime).mockImplementation(async (_submission, _token, onProgress) => {
      invocation += 1;
      if (invocation === 1) {
        onProgress({
          stage: "engine", status: "done", message: "Ambiente verificato.",
          sequence: 1, elapsedMs: 300, code: null, retryable: null,
        });
        onProgress({
          stage: "runtime", status: "start", message: "Verifico il runtime.",
          sequence: 2, elapsedMs: 0, code: null, retryable: null,
        });
        onProgress({
          stage: "runtime", status: "done", message: "Runtime verificato.",
          sequence: 3, elapsedMs: 700, code: null, retryable: null,
        });
        onProgress({
          stage: "container", status: "start", message: "Avvio il container del team.",
          sequence: 4, elapsedMs: 0, code: null, retryable: null,
        });
        onProgress({
          stage: "container", status: "error", message: "Il container non si è avviato.",
          sequence: 5, elapsedMs: 2_400, code: "container_start_failed", retryable: true,
        });
        throw {
          code: "container_start_failed",
          message: "Il container non si è avviato.",
          retryable: true,
        };
      }
      onProgress({
        stage: "container", status: "start", message: "Riprovo l’avvio del container.",
        sequence: 1, elapsedMs: 0, code: null, retryable: null,
      });
      onProgress({
        stage: "container", status: "progress", message: "Verifico il container avviato.",
        sequence: 2, elapsedMs: 2_000, code: null, retryable: null,
      });
      onProgress({
        stage: "container", status: "done", message: "Container verificato.",
        sequence: 3, elapsedMs: 2_600, code: null, retryable: null,
      });
      return PREPARED;
    });

    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(await screen.findByRole("button", { name: "submit-onboarding" }));

    expect(await screen.findByText("failed:container")).toBeInTheDocument();
    expect(screen.getByText("code:container_start_failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "retry-runtime" })).toBeInTheDocument();
    expect(prepareOnboardingRuntime).toHaveBeenCalledOnce();
    expect(startOnboardingTeam).not.toHaveBeenCalled();
    expect(startOnboardingProviderLogin).not.toHaveBeenCalled();
    expect(screen.getByTestId("activity-events")).toHaveTextContent(
      `1:container:failed:2400:${ERROR_CATALOG.container_start_failed.text.it}`,
    );
    expect(screen.getByTestId("activity-events")).not.toHaveTextContent(/token|password|secret|https?:\/\//i);

    await act(async () => { await Promise.resolve(); });
    expect(prepareOnboardingRuntime).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "retry-runtime" }));

    await waitFor(() => expect(prepareOnboardingRuntime).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("action-required:provider-login")).toBeInTheDocument();
    expect(screen.getByTestId("activity-events")).toHaveTextContent(
      "2:container:completed:2600:Container verificato.",
    );
    expect(startOnboardingTeam).not.toHaveBeenCalled();
    expect(startOnboardingProviderLogin).not.toHaveBeenCalled();
  });

  it("preserves a structured local error and retries only when the backend permits it", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("retry-account"));
    requireOnboarding();
    vi.mocked(prepareOnboardingRuntime)
      .mockRejectedValueOnce({
        code: "podman_not_ready",
        message: "Podman è installato ma non risponde ancora.",
        retryable: true,
      })
      .mockResolvedValueOnce(PREPARED);

    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(await screen.findByRole("button", { name: "submit-onboarding" }));
    expect(await screen.findByText("failed:runtime")).toBeInTheDocument();
    expect(screen.getByText("code:podman_not_ready")).toBeInTheDocument();
    // The sentence is the app's, from the catalog; the native one never shows.
    expect(screen.getByText(ERROR_CATALOG.podman_not_ready.text.it)).toBeInTheDocument();
    expect(screen.getByText(`Cosa fare: ${ERROR_CATALOG.podman_not_ready.action.it}`)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("Podman è installato ma non risponde ancora.");
    await user.click(screen.getByRole("button", { name: "retry-runtime" }));
    await waitFor(() => expect(prepareOnboardingRuntime).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("action-required:provider-login")).toBeInTheDocument();
  });

  it("uses a generic retryable failure only for a malformed backend payload", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("malformed-error-account"));
    requireOnboarding();
    vi.mocked(prepareOnboardingRuntime).mockRejectedValue({
      code: "podman_not_ready",
      message: "",
      retryable: "yes",
    });

    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(await screen.findByRole("button", { name: "submit-onboarding" }));

    expect(await screen.findByText("failed:runtime")).toBeInTheDocument();
    expect(screen.queryByText("code:podman_not_ready")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "retry-runtime" })).toBeInTheDocument();
  });

  it("does not offer retry when the structured local failure is non-retryable", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("attestation-error-account"));
    requireOnboarding();
    vi.mocked(prepareOnboardingRuntime).mockRejectedValue({
      code: "installer_digest_mismatch",
      message: "Il pacchetto runtime non supera la verifica di integrità.",
      retryable: false,
    });

    render(<DashboardApp />);
    await userEvent.click(await screen.findByRole("button", { name: "submit-onboarding" }));

    expect(await screen.findByText(ERROR_CATALOG.installer_digest_mismatch.text.it)).toBeInTheDocument();
    expect(screen.getByText("code:installer_digest_mismatch")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "retry-runtime" })).not.toBeInTheDocument();
  });

  it("keeps container failures at the container stage and never marks ready", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("container-account"));
    requireOnboarding();
    vi.mocked(prepareOnboardingRuntime).mockRejectedValue({
      code: "container_not_ready",
      message: "ignored raw output",
      retryable: true,
    });
    render(<DashboardApp />);
    await userEvent.click(await screen.findByRole("button", { name: "submit-onboarding" }));
    expect(await screen.findByText("failed:container")).toBeInTheDocument();
    expect(screen.getByText("title:Avvio del container non riuscito")).toBeInTheDocument();
    expect(screen.getByText("Il container del team non risulta pronto. Il team non è stato avviato.")).toBeInTheDocument();
    expect(screen.queryByText("ignored raw output")).not.toBeInTheDocument();
    expect(markOnboardingReady).not.toHaveBeenCalled();
    expect(startOnboardingTeam).not.toHaveBeenCalled();
  });

  it("maps an explicit version mismatch to fixed copy without exposing backend text", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("container-version-account"));
    requireOnboarding();
    vi.mocked(prepareOnboardingRuntime).mockRejectedValue({
      code: "container_version_incompatible",
      message: "raw version probe output",
      retryable: true,
    });

    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(await screen.findByRole("button", { name: "submit-onboarding" }));

    expect(await screen.findByText("failed:container")).toBeInTheDocument();
    expect(screen.getByText("title:Versione del container non compatibile")).toBeInTheDocument();
    expect(screen.getByText("La versione installata non coincide con quella richiesta da questa app. Il team non è stato avviato.")).toBeInTheDocument();
    expect(screen.queryByText("raw version probe output")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "retry-runtime" })).not.toBeInTheDocument();
    expect(prepareOnboardingRuntime).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "exit-failure" }));
    expect(await screen.findByText("collecting:host")).toBeInTheDocument();
    expect(resetOnboardingMarker).not.toHaveBeenCalled();
    expect(closeOnboardingProviderLogin).not.toHaveBeenCalled();
    expect(clearDesktopAccountScope).not.toHaveBeenCalled();
    expect(prepareOnboardingRuntime).toHaveBeenCalledOnce();
  });

  it("requires explicit fingerprint consent before VPS pairing and cancel performs no prepare", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("fingerprint-account"));
    requireOnboarding();
    vi.mocked(probeOnboardingSshHostKey).mockResolvedValue({
      status: "confirmation_required",
      algorithm: "ssh-ed25519",
      fingerprint: "SHA256:synthetic-fingerprint",
    });
    vi.mocked(prepareOnboardingRuntime).mockResolvedValue(PREPARED);

    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(await screen.findByRole("button", { name: "submit-vps" }));
    expect(await screen.findByText("SHA256:synthetic-fingerprint")).toBeInTheDocument();
    expect(prepareOnboardingRuntime).not.toHaveBeenCalled();
    expect(confirmOnboardingSshHostKey).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "cancel-host-key" }));
    expect(screen.getByTestId("onboarding")).toHaveTextContent("collecting:host");
    expect(prepareOnboardingRuntime).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "submit-vps" }));
    await user.click(await screen.findByRole("button", { name: "confirm-host-key" }));
    await waitFor(() => expect(prepareOnboardingRuntime).toHaveBeenCalledOnce());
    expect(confirmOnboardingSshHostKey).toHaveBeenCalledWith(
      SUBMISSION_VPS.host,
      { algorithm: "ssh-ed25519", fingerprint: "SHA256:synthetic-fingerprint" },
    );
    expect(vi.mocked(confirmOnboardingSshHostKey).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(prepareOnboardingRuntime).mock.invocationCallOrder[0]);
    expect(connectDirectChat).not.toHaveBeenCalled();
    expect(screen.queryByTestId("shell")).not.toBeInTheDocument();
  });

  it("stops on fingerprint mismatch without prepare or Shell", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("mismatch-account"));
    requireOnboarding();
    vi.mocked(probeOnboardingSshHostKey).mockRejectedValue({ code: "host_key_mismatch" });

    render(<DashboardApp />);
    await userEvent.click(await screen.findByRole("button", { name: "submit-vps" }));

    expect(await screen.findByText("failed:ssh-host-key")).toBeInTheDocument();
    expect(prepareOnboardingRuntime).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "retry-runtime" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("shell")).not.toBeInTheDocument();
  });

  it("starts the team quietly when the provider limits were verified", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("limits-ok-account"));
    requireOnboarding();
    vi.mocked(prepareOnboardingRuntime).mockResolvedValue({ ...PREPARED, providerAuthenticated: true });
    vi.mocked(startOnboardingTeam).mockResolvedValue({ ...TEAM_READY, limitsVerified: true });

    render(<DashboardApp />);
    await userEvent.click(await screen.findByRole("button", { name: "submit-onboarding" }));

    expect(await screen.findByText("action-required:assistant")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(ERROR_CATALOG.provider_limits_unverified.text.it);
  });

  it("says when exhausted provider limits free again instead of starting", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("limits-exhausted-account"));
    requireOnboarding();
    vi.mocked(prepareOnboardingRuntime).mockResolvedValue({ ...PREPARED, providerAuthenticated: true });
    const resetsAt = Math.floor(Date.now() / 1000) + 2 * 3600;
    vi.mocked(startOnboardingTeam).mockRejectedValue({
      code: "provider_limits_exhausted",
      message: "native text that must not show",
      retryable: true,
      resetsAt,
    });
    const time = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" })
      .format(new Date(resetsAt * 1000));

    render(<DashboardApp />);
    await userEvent.click(await screen.findByRole("button", { name: "submit-onboarding" }));

    expect(await screen.findByText("failed:team-start")).toBeInTheDocument();
    expect(screen.getByText("code:provider_limits_exhausted")).toBeInTheDocument();
    expect(document.body).toHaveTextContent(`esauriti fino alle ${time}`);
    expect(document.body).toHaveTextContent(`Cosa fare: Riprova dopo le ${time}.`);
    expect(document.body).not.toHaveTextContent("native text that must not show");
    expect(document.body).not.toHaveTextContent("{time}");
    expect(screen.getByRole("button", { name: "retry-runtime" })).toBeInTheDocument();
  });

  it("starts anyway and warns when the provider limits could not be verified", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("limits-unverified-account"));
    requireOnboarding();
    vi.mocked(prepareOnboardingRuntime).mockResolvedValue({ ...PREPARED, providerAuthenticated: true });
    vi.mocked(startOnboardingTeam).mockResolvedValue({ ...TEAM_READY, limitsVerified: false });

    render(<DashboardApp />);
    await userEvent.click(await screen.findByRole("button", { name: "submit-onboarding" }));

    expect(await screen.findByText("action-required:assistant")).toBeInTheDocument();
    expect(document.body).toHaveTextContent(ERROR_CATALOG.provider_limits_unverified.text.it);
    expect(document.body).toHaveTextContent(ERROR_CATALOG.provider_limits_unverified.action.it);
  });

  it("opens confined Assistant chat from a clean state, then marks ready only after profile reread", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("conversation-account"));
    requireOnboarding();
    vi.mocked(prepareOnboardingRuntime).mockResolvedValue({ ...PREPARED, providerAuthenticated: true });
    vi.mocked(startOnboardingTeam).mockResolvedValue(TEAM_READY);
    vi.mocked(openOnboardingAssistant).mockResolvedValue({ ...TEAM_READY, assistantWelcomed: false });
    vi.mocked(readOnboardingSnapshot)
      .mockResolvedValueOnce({ ...TEAM_READY, assistantWelcomed: false, profileReady: false })
      .mockResolvedValueOnce({ ...TEAM_READY, assistantWelcomed: true, profileReady: true });

    const user = userEvent.setup();
    render(<DashboardApp />);
    await reachAssistant(user);

    expect(await screen.findByTestId("assistant-chat")).toBeInTheDocument();
    expect(screen.queryByTestId("shell")).not.toBeInTheDocument();
    expect(navigate).toHaveBeenCalledWith("/messages?agent=assistente", { replace: true });
    await act(async () => { await Promise.resolve(); });
    expect(markOnboardingReady).not.toHaveBeenCalled();

    await waitFor(() => expect(markOnboardingReady).toHaveBeenCalledWith(
      "conversation-account",
      expect.objectContaining({ profileReady: true, directChatReady: true }),
    ), { timeout: 3_500 });
    expect(screen.getByTestId("shell")).toBeInTheDocument();
    expect(markOnboardingStarted).toHaveBeenCalledWith("conversation-account");
    expect(openOnboardingAssistant).toHaveBeenCalledWith(SUBMISSION.host, expect.any(Function));
  });

  it("projects native progress into the current operation and activity timeline", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("progress-account"));
    requireOnboarding();
    vi.mocked(prepareOnboardingRuntime).mockImplementation(async (_submission, _pairingToken, onProgress) => {
      onProgress({
        stage: "engine", status: "start", message: "Verifico il motore.",
        sequence: 1, elapsedMs: 0, code: null, retryable: null,
      });
      onProgress({
        stage: "engine", status: "done", message: "Motore verificato.",
        sequence: 2, elapsedMs: 200, code: null, retryable: null,
      });
      onProgress({
        stage: "container", status: "progress", message: "Verifico il container.",
        sequence: 3, elapsedMs: 2_000, code: null, retryable: null,
      });
      return PREPARED;
    });

    render(<DashboardApp />);
    await userEvent.click(await screen.findByRole("button", { name: "submit-onboarding" }));

    expect(await screen.findByTestId("activity-current")).toHaveTextContent(
      "Preparazione container:Verifico il container.",
    );
    expect(screen.getByTestId("activity-count")).toHaveTextContent("activity:2");
    expect(prepareOnboardingRuntime).toHaveBeenCalledWith(
      SUBMISSION,
      null,
      expect.any(Function),
    );
  });

  it("keeps account-scoped chat state out of a switched account", async () => {
    let current = signedInAs("account-a");
    vi.mocked(useSession).mockImplementation(() => current);
    requireOnboarding();
    vi.mocked(prepareOnboardingRuntime).mockResolvedValue({ ...PREPARED, providerAuthenticated: true });
    vi.mocked(startOnboardingTeam).mockResolvedValue(TEAM_READY);
    vi.mocked(openOnboardingAssistant).mockResolvedValue(TEAM_READY);
    vi.mocked(readOnboardingSnapshot).mockResolvedValue({ ...TEAM_READY, profileReady: false });

    const user = userEvent.setup();
    const view = render(<DashboardApp />);
    await reachAssistant(user);
    expect(await screen.findByTestId("assistant-chat")).toBeInTheDocument();
    expect(screen.queryByTestId("shell")).not.toBeInTheDocument();

    current = signedInAs("account-b");
    view.rerender(<DashboardApp />);
    expect(await screen.findByTestId("onboarding")).toBeInTheDocument();
    expect(screen.queryByTestId("shell")).not.toBeInTheDocument();
    expect(markOnboardingReady).not.toHaveBeenCalled();
  });

  it("keeps a ready resumed host probe-only until the Assistant click", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("resume-account"));
    vi.mocked(loadOnboardingGate).mockResolvedValue({
      phase: "required",
      account: { displayName: "Resume Person" },
      resumeAvailable: true,
      runtime: { status: "collecting", stage: "host" },
    });
    vi.mocked(resumeOnboardingSnapshot).mockResolvedValue({ ...TEAM_READY, assistantWelcomed: false });

    const user = userEvent.setup();
    render(<DashboardApp />);

    expect(await screen.findByText("action-required:assistant")).toBeInTheDocument();
    expect(resumeOnboardingSnapshot).toHaveBeenCalledOnce();
    expect(resumeOnboardingTeamStart).not.toHaveBeenCalled();
    expect(reconnectDirectChat).not.toHaveBeenCalled();
    expect(startOnboardingProviderLogin).not.toHaveBeenCalled();
    expect(startOnboardingTeam).not.toHaveBeenCalled();
    expect(openOnboardingAssistant).not.toHaveBeenCalled();
    expect(prepareOnboardingRuntime).not.toHaveBeenCalled();
    expect(screen.queryByTestId("assistant-chat")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "continue-runtime" }));

    expect(await screen.findByTestId("assistant-chat")).toBeInTheDocument();
    expect(vi.mocked(resumeOnboardingSnapshot).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(reconnectDirectChat).toHaveBeenCalledOnce();
    expect(vi.mocked(resumeOnboardingSnapshot).mock.invocationCallOrder[1])
      .toBeLessThan(vi.mocked(reconnectDirectChat).mock.invocationCallOrder[0]);
    expect(markOnboardingReady).not.toHaveBeenCalled();
    expect(screen.queryByTestId("shell")).not.toBeInTheDocument();
  });

  it("reconciles a stale resume marker to the first missing real prerequisite", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("stale-resume-account"));
    vi.mocked(loadOnboardingGate).mockResolvedValue({
      phase: "required",
      account: { displayName: "Stale Resume" },
      resumeAvailable: true,
      runtime: { status: "collecting", stage: "host" },
    });
    vi.mocked(resumeOnboardingSnapshot).mockResolvedValue({
      ...TEAM_READY,
      runtimeInstalled: false,
    });

    render(<DashboardApp />);

    expect(await screen.findByText("failed:runtime")).toBeInTheDocument();
    expect(screen.getByText(/runtime salvato non risulta pronto/i)).toBeInTheDocument();
    expect(resumeOnboardingTeamStart).not.toHaveBeenCalled();
    expect(reconnectDirectChat).not.toHaveBeenCalled();
    expect(screen.queryByTestId("assistant-chat")).not.toBeInTheDocument();
  });

  it("keeps a local-profile resume probe-only until an explicit team action", async () => {
    vi.mocked(useSession).mockReturnValue({ session: null, loading: false });
    vi.mocked(localIdentitySelected).mockReturnValue(true);
    vi.mocked(readLocalProfile).mockReturnValue({
      profileId: "opaque-local-resume",
      displayName: "Ada Locale",
    });
    localStorage.setItem(
      "jht.desktop.onboarding.local:opaque-local-resume",
      "subscription-v1-started",
    );
    vi.mocked(resumeOnboardingSnapshot).mockResolvedValue({
      ...TEAM_READY,
      captainRunning: false,
    });

    render(<DashboardApp />);

    expect(await screen.findByText("action-required:team-start")).toBeInTheDocument();
    expect(activateDesktopLocalScope).toHaveBeenCalledWith("opaque-local-resume");
    expect(resumeOnboardingSnapshot).toHaveBeenCalledOnce();
    expect(resumeOnboardingTeamStart).not.toHaveBeenCalled();
    expect(reconnectDirectChat).not.toHaveBeenCalled();
    expect(prepareOnboardingRuntime).not.toHaveBeenCalled();
    expect(startOnboardingProviderLogin).not.toHaveBeenCalled();
    expect(startOnboardingTeam).not.toHaveBeenCalled();
    expect(openOnboardingAssistant).not.toHaveBeenCalled();
  });

  it("fails closed on a Podman snapshot error without exposing backend text or auto-starting", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("podman-snapshot-error"));
    vi.mocked(loadOnboardingGate).mockResolvedValue({
      phase: "required",
      account: { displayName: "Snapshot Error" },
      resumeAvailable: true,
      runtime: { status: "collecting", stage: "host" },
    });
    vi.mocked(resumeOnboardingSnapshot).mockRejectedValue({
      code: "snapshot_failed",
      message: "raw host path and runtime output",
      retryable: true,
    });

    render(<DashboardApp />);

    expect(await screen.findByText("failed:runtime")).toBeInTheDocument();
    expect(screen.getByText(ERROR_CATALOG.snapshot_failed.text.it)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("raw host path and runtime output");
    expect(resumeOnboardingSnapshot).toHaveBeenCalledOnce();
    expect(resumeOnboardingTeamStart).not.toHaveBeenCalled();
    expect(prepareOnboardingRuntime).not.toHaveBeenCalled();
    expect(startOnboardingTeam).not.toHaveBeenCalled();
    expect(reconnectDirectChat).not.toHaveBeenCalled();
  });

  it("starts missing team sessions before reconnecting the resumed Assistant chat", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("assistant-missing-account"));
    vi.mocked(loadOnboardingGate).mockResolvedValue({
      phase: "required",
      account: { displayName: "Assistant Missing" },
      resumeAvailable: true,
      runtime: { status: "collecting", stage: "host" },
    });
    vi.mocked(resumeOnboardingSnapshot)
      .mockResolvedValueOnce({ ...TEAM_READY, assistantRunning: false })
      .mockResolvedValue(TEAM_READY);
    vi.mocked(resumeOnboardingTeamStart).mockResolvedValue(TEAM_READY);

    const user = userEvent.setup();
    render(<DashboardApp />);

    expect(await screen.findByText("action-required:team-start")).toBeInTheDocument();
    expect(resumeOnboardingSnapshot).toHaveBeenCalled();
    expect(resumeOnboardingTeamStart).not.toHaveBeenCalled();
    expect(reconnectDirectChat).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "continue-runtime" }));

    expect(await screen.findByText("action-required:assistant")).toBeInTheDocument();
    expect(resumeOnboardingTeamStart).toHaveBeenCalledOnce();
    expect(reconnectDirectChat).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "continue-runtime" }));

    expect(await screen.findByTestId("assistant-chat")).toBeInTheDocument();
    expect(reconnectDirectChat).toHaveBeenCalledOnce();
    expect(vi.mocked(resumeOnboardingSnapshot).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(resumeOnboardingTeamStart).mock.invocationCallOrder[0]);
    expect(vi.mocked(resumeOnboardingTeamStart).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(reconnectDirectChat).mock.invocationCallOrder[0]);
  });

  it("keeps a failed resumed team start retryable at the real team stage", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("team-resume-failed"));
    vi.mocked(loadOnboardingGate).mockResolvedValue({
      phase: "required",
      account: { displayName: "Team Retry" },
      resumeAvailable: true,
      runtime: { status: "collecting", stage: "host" },
    });
    vi.mocked(resumeOnboardingSnapshot).mockResolvedValue({
      ...TEAM_READY,
      captainRunning: false,
    });
    vi.mocked(resumeOnboardingTeamStart).mockRejectedValue({ code: "team_start_failed" });

    const user = userEvent.setup();
    render(<DashboardApp />);

    expect(await screen.findByText("action-required:team-start")).toBeInTheDocument();
    expect(resumeOnboardingTeamStart).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "continue-runtime" }));

    expect(await screen.findByText("failed:team-start")).toBeInTheDocument();
    expect(screen.getByText("code:team_start_failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "retry-runtime" })).toBeInTheDocument();
    expect(reconnectDirectChat).not.toHaveBeenCalled();
  });

  it("returns an unconfigured resumed host to step 1 without reconnecting chat", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("host-missing-account"));
    vi.mocked(loadOnboardingGate).mockResolvedValue({
      phase: "required",
      account: { displayName: "Host Missing" },
      resumeAvailable: true,
      runtime: { status: "collecting", stage: "host" },
    });
    vi.mocked(resumeOnboardingSnapshot).mockRejectedValue({ code: "host_not_configured" });

    render(<DashboardApp />);

    expect(await screen.findByTestId("onboarding")).toHaveTextContent("collecting:host");
    expect(resetOnboardingMarker).not.toHaveBeenCalled();
    expect(reconnectDirectChat).not.toHaveBeenCalled();
  });

  it.each(["google", "local"] as const)(
    "restarts only %s onboarding UI without clearing credentials, scope, runtime or team",
    async (identity) => {
      const markerId = identity === "google" ? "restart-google" : "local:restart-local";
      if (identity === "google") {
        vi.mocked(useSession).mockReturnValue(signedInAs("restart-google"));
        vi.mocked(loadOnboardingGate).mockResolvedValue({
          phase: "required",
          account: { displayName: "Google Restart" },
          resumeAvailable: true,
          runtime: { status: "collecting", stage: "host" },
        });
      } else {
        vi.mocked(useSession).mockReturnValue({ session: null, loading: false });
        vi.mocked(localIdentitySelected).mockReturnValue(true);
        vi.mocked(readLocalProfile).mockReturnValue({
          profileId: "restart-local",
          displayName: "Local Restart",
        });
        localStorage.setItem(
          "jht.desktop.onboarding.local:restart-local",
          "subscription-v1-started",
        );
      }
      vi.mocked(resumeOnboardingSnapshot).mockResolvedValue({
        ...TEAM_READY,
        runtimeInstalled: false,
      });

      render(<DashboardApp />);
      await screen.findByText("failed:runtime");
      await userEvent.click(screen.getByRole("button", { name: "restart-onboarding" }));

      expect(await screen.findByTestId("onboarding")).toHaveTextContent("collecting:host");
      expect(resetOnboardingMarker).toHaveBeenCalledWith(markerId);
      expect(clearDesktopAccountScope).not.toHaveBeenCalled();
      expect(clearLocalIdentitySelection).not.toHaveBeenCalled();
      expect(prepareOnboardingRuntime).not.toHaveBeenCalled();
      expect(startOnboardingTeam).not.toHaveBeenCalled();
      expect(reconnectDirectChat).not.toHaveBeenCalled();
    },
  );

  it("keeps restart at host selection when it cancels an active provider login", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("restart-provider-account"));
    requireOnboarding();
    vi.mocked(prepareOnboardingRuntime).mockResolvedValue(PREPARED);
    vi.mocked(startOnboardingProviderLogin).mockResolvedValue("provider-session-restart");

    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(await screen.findByRole("button", { name: "submit-claude" }));
    await user.click(await screen.findByRole("button", { name: "continue-runtime" }));
    await waitFor(() => expect(startOnboardingProviderLogin).toHaveBeenCalledOnce());
    expect(startOnboardingProviderLogin).toHaveBeenCalledWith(
      SUBMISSION.host,
      expect.any(Function),
      expect.any(Function),
    );

    await user.click(screen.getByRole("button", { name: "restart-onboarding" }));

    expect(await screen.findByTestId("onboarding")).toHaveTextContent("collecting:host");
    expect(closeOnboardingProviderLogin).toHaveBeenCalledWith("provider-session-restart");
    expect(resetOnboardingMarker).toHaveBeenCalledWith("restart-provider-account");
    expect(startOnboardingTeam).not.toHaveBeenCalled();
  });

  it.each([
    { provider: "claude" as const, showsCode: true, requestsInput: true },
    { provider: "codex" as const, showsCode: true, requestsInput: false },
    { provider: "kimi" as const, showsCode: false, requestsInput: true },
  ])("keeps a single-push $provider action sequence visible and gates input", async ({ provider, showsCode, requestsInput }) => {
    vi.mocked(useSession).mockReturnValue(signedInAs("provider-account"));
    requireOnboarding();
    vi.mocked(prepareOnboardingRuntime).mockResolvedValue(PREPARED);
    let emit!: Parameters<Parameters<typeof startOnboardingProviderLogin>[1]>[0] extends never
      ? never
      : Parameters<typeof startOnboardingProviderLogin>[1];
    vi.mocked(startOnboardingProviderLogin).mockImplementation(async (_host, onEvent) => {
      emit = onEvent;
      return `provider-session-${provider}`;
    });
    vi.mocked(readOnboardingSnapshot).mockResolvedValue(PREPARED);

    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(await screen.findByRole("button", { name: `submit-${provider}` }));
    await user.click(await screen.findByRole("button", { name: "continue-runtime" }));

    await waitFor(() => expect(startOnboardingProviderLogin).toHaveBeenCalledOnce());
    expect(sendOnboardingProviderInput).not.toHaveBeenCalled();
    expect(await screen.findByText("provider-state:connecting")).toBeInTheDocument();
    const safeUrl = provider === "codex"
      ? "https://auth.openai.com/codex/device"
      : "https://example.invalid/device";

    act(() => {
      if (provider === "codex") emit({
        kind: "state",
        status: "needs_user_action",
        action: {
          kind: "device",
          requestId: "codex-device-1",
          actions: [
            {
              kind: "url",
              instruction: "Apri l’indirizzo e inserisci il codice temporaneo.",
              safeUrl,
            },
            {
              kind: "code",
              instruction: "Apri l’indirizzo e inserisci il codice temporaneo.",
              userCode: "ABCD-EFGH",
            },
          ],
        },
      });
      else {
        emit({
          kind: "state",
          status: "needs_user_action",
          action: {
            kind: "url",
            instruction: "Completa l’accesso nel browser.",
            safeUrl,
          },
        });
        if (showsCode) emit({
          kind: "state",
          status: "needs_user_action",
          action: {
            kind: "code",
            instruction: "Inserisci il codice mostrato.",
            userCode: "ABCD-EFGH",
          },
        });
      }
      if (requestsInput) emit({
        kind: "state",
        status: "needs_user_action",
        action: {
          kind: "input",
          instruction: "Invia la risposta richiesta.",
          inputRequest: { id: `request-${provider}`, label: "Risposta" },
        },
      });
    });

    expect(await screen.findByText("provider-state:needs_user_action")).toBeInTheDocument();
    expect(screen.getByText(`provider-url:${safeUrl}`)).toBeInTheDocument();
    if (showsCode) expect(screen.getByText("provider-code:ABCD-EFGH")).toBeInTheDocument();
    else expect(screen.queryByText("provider-code:ABCD-EFGH")).not.toBeInTheDocument();
    if (requestsInput) {
      await user.click(screen.getByRole("button", { name: "send-provider-input" }));
      expect(sendOnboardingProviderInput).toHaveBeenLastCalledWith(
        `provider-session-${provider}`,
        `request-${provider}`,
        "verification response",
      );
      expect(screen.queryByRole("button", { name: "send-provider-input" })).not.toBeInTheDocument();
      expect(screen.getByText("provider-state:verifying")).toBeInTheDocument();
      expect(screen.getByText(`provider-url:${safeUrl}`)).toBeInTheDocument();
      if (showsCode) expect(screen.getByText("provider-code:ABCD-EFGH")).toBeInTheDocument();
    } else {
      expect(screen.queryByRole("button", { name: "send-provider-input" })).not.toBeInTheDocument();
      expect(sendOnboardingProviderInput).not.toHaveBeenCalled();
    }
    await user.click(screen.getByRole("button", { name: "cancel-provider-login" }));
    expect(closeOnboardingProviderLogin).toHaveBeenCalledWith(`provider-session-${provider}`);
    expect(await screen.findByText("action-required:provider-login")).toBeInTheDocument();
    expect(startOnboardingTeam).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "continue-runtime" }));
    await waitFor(() => expect(startOnboardingProviderLogin).toHaveBeenCalledTimes(2));
    expect(startOnboardingTeam).not.toHaveBeenCalled();
  });

  it("restarts provider access only from the takeover action", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("provider-restart-account"));
    requireOnboarding();
    vi.mocked(prepareOnboardingRuntime).mockResolvedValue(PREPARED);
    vi.mocked(startOnboardingProviderLogin)
      .mockResolvedValueOnce("provider-session-first")
      .mockResolvedValueOnce("provider-session-second");

    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(await screen.findByRole("button", { name: "submit-codex" }));
    await user.click(await screen.findByRole("button", { name: "continue-runtime" }));
    await waitFor(() => expect(startOnboardingProviderLogin).toHaveBeenCalledOnce());
    expect(closeOnboardingProviderLogin).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "restart-provider-login" }));

    expect(closeOnboardingProviderLogin).toHaveBeenCalledWith("provider-session-first");
    await waitFor(() => expect(startOnboardingProviderLogin).toHaveBeenCalledTimes(2));
    expect(startOnboardingTeam).not.toHaveBeenCalled();
  });

  it("terminates an invalid device action in a safe restartable state", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("provider-invalid-device-account"));
    requireOnboarding();
    vi.mocked(prepareOnboardingRuntime).mockResolvedValue(PREPARED);
    let emit!: Parameters<typeof startOnboardingProviderLogin>[1];
    vi.mocked(startOnboardingProviderLogin)
      .mockImplementationOnce(async (_host, onEvent) => {
        emit = onEvent;
        return "provider-session-invalid-device";
      })
      .mockResolvedValueOnce("provider-session-restarted");

    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(await screen.findByRole("button", { name: "submit-codex" }));
    await user.click(await screen.findByRole("button", { name: "continue-runtime" }));
    await waitFor(() => expect(startOnboardingProviderLogin).toHaveBeenCalledOnce());

    act(() => emit({ kind: "invalid_action", code: "provider_action_invalid" }));

    expect(await screen.findByText("provider-state:error")).toBeInTheDocument();
    expect(screen.getByText("provider-connection:disconnected")).toBeInTheDocument();
    expect(screen.getByText("provider-error:La richiesta del provider non è valida. Riavvia l’accesso.")).toBeInTheDocument();
    expect(screen.queryByText(/provider-url:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/provider-code:/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "send-provider-input" })).not.toBeInTheDocument();
    await waitFor(() => expect(closeOnboardingProviderLogin).toHaveBeenCalledWith("provider-session-invalid-device"));

    await user.click(screen.getByRole("button", { name: "restart-provider-login" }));
    await waitFor(() => expect(startOnboardingProviderLogin).toHaveBeenCalledTimes(2));
  });

  it("ignores stale State and a late session while the next account scope is pending", async () => {
    let current = signedInAs("provider-account-a");
    let emit!: Parameters<typeof startOnboardingProviderLogin>[1];
    let resolveStart!: (sessionId: string) => void;
    let resolveScopeB!: () => void;
    let scopeAttempt = 0;
    vi.mocked(useSession).mockImplementation(() => current);
    requireOnboarding();
    vi.mocked(prepareOnboardingRuntime).mockResolvedValue(PREPARED);
    vi.mocked(activateDesktopAccountScope).mockImplementation(() => {
      scopeAttempt += 1;
      return scopeAttempt === 1
        ? Promise.resolve()
        : new Promise<void>((resolve) => { resolveScopeB = resolve; });
    });
    vi.mocked(startOnboardingProviderLogin).mockImplementation((_host, onEvent) => {
      emit = onEvent;
      return new Promise<string>((resolve) => { resolveStart = resolve; });
    });

    const user = userEvent.setup();
    const view = render(<DashboardApp />);
    await user.click(await screen.findByRole("button", { name: "submit-codex" }));
    await user.click(await screen.findByRole("button", { name: "continue-runtime" }));
    await waitFor(() => expect(startOnboardingProviderLogin).toHaveBeenCalledOnce());

    current = signedInAs("provider-account-b");
    view.rerender(<DashboardApp />);
    expect(await screen.findByLabelText("Caricamento dashboard")).toBeInTheDocument();
    act(() => emit({
      kind: "state",
      status: "needs_user_action",
      action: {
        kind: "input",
        instruction: "Risposta per la sessione precedente.",
        inputRequest: { id: "stale-request", label: "Risposta" },
      },
    }));
    await act(async () => resolveStart("stale-provider-session"));

    expect(closeOnboardingProviderLogin).toHaveBeenCalledWith("stale-provider-session");
    expect(screen.queryByRole("button", { name: "send-provider-input" })).not.toBeInTheDocument();
    expect(sendOnboardingProviderInput).not.toHaveBeenCalled();
    expect(startOnboardingTeam).not.toHaveBeenCalled();

    await act(async () => resolveScopeB());
    expect(await screen.findByTestId("onboarding")).toHaveTextContent("collecting:host");
  });

  it("closes an already published provider session when the account identity changes", async () => {
    let current = signedInAs("published-provider-account-a");
    let resolveScopeB!: () => void;
    let scopeAttempt = 0;
    vi.mocked(useSession).mockImplementation(() => current);
    requireOnboarding();
    vi.mocked(prepareOnboardingRuntime).mockResolvedValue(PREPARED);
    vi.mocked(activateDesktopAccountScope).mockImplementation(() => {
      scopeAttempt += 1;
      return scopeAttempt === 1
        ? Promise.resolve()
        : new Promise<void>((resolve) => { resolveScopeB = resolve; });
    });
    vi.mocked(startOnboardingProviderLogin).mockResolvedValue("published-provider-session");

    const user = userEvent.setup();
    const view = render(<DashboardApp />);
    await user.click(await screen.findByRole("button", { name: "submit-codex" }));
    await user.click(await screen.findByRole("button", { name: "continue-runtime" }));
    await waitFor(() => expect(startOnboardingProviderLogin).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByText("provider-state:connecting")).toBeInTheDocument());

    current = signedInAs("published-provider-account-b");
    view.rerender(<DashboardApp />);

    await waitFor(() => expect(closeOnboardingProviderLogin)
      .toHaveBeenCalledWith("published-provider-session"));
    await waitFor(() => expect(activateDesktopAccountScope).toHaveBeenCalledTimes(2));
    expect(vi.mocked(closeOnboardingProviderLogin).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(activateDesktopAccountScope).mock.invocationCallOrder[1]);
    expect(screen.getByLabelText("Caricamento dashboard")).toBeInTheDocument();

    await act(async () => resolveScopeB());
    expect(await screen.findByTestId("onboarding")).toHaveTextContent("collecting:host");
  });

  it.each([7, null] as const)("keeps Exit %s terminal, safe and explicitly restartable", async (exitCode) => {
    vi.mocked(useSession).mockReturnValue(signedInAs("provider-exit-account"));
    requireOnboarding();
    vi.mocked(prepareOnboardingRuntime).mockResolvedValue(PREPARED);
    let emit!: Parameters<typeof startOnboardingProviderLogin>[1];
    vi.mocked(startOnboardingProviderLogin).mockImplementation(async (_host, onEvent) => {
      emit = onEvent;
      return "provider-session-exit";
    });

    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(await screen.findByRole("button", { name: "submit-codex" }));
    await user.click(await screen.findByRole("button", { name: "continue-runtime" }));
    await waitFor(() => expect(startOnboardingProviderLogin).toHaveBeenCalledOnce());
    act(() => emit({
      kind: "state",
      status: "needs_user_action",
      action: {
        kind: "input",
        instruction: "Invia una risposta.",
        inputRequest: { id: "exit-request", label: "Risposta" },
      },
    }));
    expect(screen.getByRole("button", { name: "send-provider-input" })).toBeInTheDocument();

    act(() => emit({ kind: "exit", code: exitCode }));

    expect(await screen.findByText("provider-state:error")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "send-provider-input" })).not.toBeInTheDocument();
    expect(sendOnboardingProviderInput).not.toHaveBeenCalled();
    expect(readOnboardingSnapshot).not.toHaveBeenCalled();
    expect(startOnboardingTeam).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "restart-provider-login" })).toBeInTheDocument();
  });

  it("unmounts the takeover and advances once only after the verified snapshot", async () => {
    vi.mocked(useSession).mockReturnValue(signedInAs("provider-success-account"));
    requireOnboarding();
    vi.mocked(prepareOnboardingRuntime).mockResolvedValue(PREPARED);
    let resolveSnapshot!: (snapshot: OnboardingRuntimeSnapshot) => void;
    vi.mocked(readOnboardingSnapshot).mockReturnValue(new Promise((resolve) => {
      resolveSnapshot = resolve;
    }));
    vi.mocked(startOnboardingTeam).mockResolvedValue(TEAM_READY);
    let emit!: Parameters<typeof startOnboardingProviderLogin>[1];
    vi.mocked(startOnboardingProviderLogin).mockImplementation(async (_host, onEvent) => {
      emit = onEvent;
      return "provider-session-success";
    });

    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(await screen.findByRole("button", { name: "submit-codex" }));
    await user.click(await screen.findByRole("button", { name: "continue-runtime" }));
    await waitFor(() => expect(startOnboardingProviderLogin).toHaveBeenCalledOnce());
    expect(screen.getByText("provider-state:connecting")).toBeInTheDocument();

    act(() => emit({
      kind: "state",
      status: "needs_user_action",
      action: { kind: "code", instruction: "Inserisci il codice.", userCode: "ABCD-EFGH" },
    }));
    expect(screen.getByText("provider-state:needs_user_action")).toBeInTheDocument();

    act(() => emit({ kind: "exit", code: 0 }));

    expect(await screen.findByText("provider-state:verifying")).toBeInTheDocument();
    expect(screen.getByText("provider-connection:connected")).toBeInTheDocument();
    expect(screen.queryByText("provider-state:error")).not.toBeInTheDocument();
    await act(async () => resolveSnapshot({ ...PREPARED, providerAuthenticated: true }));
    await waitFor(() => expect(startOnboardingTeam).toHaveBeenCalledOnce());
    expect(closeOnboardingProviderLogin).toHaveBeenCalledWith("provider-session-success");
    expect(readOnboardingSnapshot).toHaveBeenCalledWith(SUBMISSION.host);
    expect(screen.queryByText("provider-state:needs_user_action")).not.toBeInTheDocument();
    expect(vi.mocked(closeOnboardingProviderLogin).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(readOnboardingSnapshot).mock.invocationCallOrder[0]);
    expect(vi.mocked(readOnboardingSnapshot).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(startOnboardingTeam).mock.invocationCallOrder[0]);
  });
});
