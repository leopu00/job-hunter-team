import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectDirectChat, directChatStatus, sendDirectChat } from "../lib/direct-chat";
import {
  loadOnboardingGate,
  markOnboardingReady,
  markOnboardingStarted,
  saveOnboardingProfile,
  type OnboardingFlowProps,
  type OnboardingRuntimeSnapshot,
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
  type OnboardingInteractiveEvent,
} from "../lib/onboarding-runtime";
import { goTo, LOGIN_PAGE } from "../lib/pages";
import type { AssistantOnboardingProps } from "../pages/assistant-onboarding";
import { fixtureData } from "../pages/dashboard/dashboard-fixture";
import { loadDashboard } from "../pages/dashboard/load-dashboard";
import { useSession } from "../lib/supabase";
import { navigate } from "../shell/router";
import DashboardApp from "./DashboardApp";

vi.mock("../lib/supabase", () => ({
  supabase: { from: vi.fn() },
  supabaseConfig: { configured: false, reason: "missing-url" },
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
  saveOnboardingProfile: vi.fn(),
  markOnboardingReady: vi.fn(),
  markOnboardingStarted: vi.fn(),
}));
vi.mock("../lib/onboarding-runtime", () => ({
  closeOnboardingProviderLogin: vi.fn(),
  openOnboardingAssistant: vi.fn(),
  prepareOnboardingRuntime: vi.fn(),
  readOnboardingSnapshot: vi.fn(),
  sendOnboardingProviderInput: vi.fn(),
  startOnboardingProviderLogin: vi.fn(),
  startOnboardingTeam: vi.fn(),
}));
vi.mock("../lib/direct-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/direct-chat")>()),
  connectDirectChat: vi.fn(),
  directChatStatus: vi.fn(),
  sendDirectChat: vi.fn(),
}));
vi.mock("../shell/router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shell/router")>()),
  navigate: vi.fn(),
}));
vi.mock("../onboarding", () => ({
  OnboardingFlow: (props: OnboardingFlowProps) => {
    const stage = props.runtime.status === "ready" ? "" : `:${props.runtime.stage}`;
    const actionStage = props.runtime.status === "action-required" ? props.runtime.stage : null;
    return (
      <section data-testid="onboarding">
        <p>{props.runtime.status}{stage}</p>
        <button type="button" onClick={() => void props.onSubmit(SUBMISSION)}>submit-onboarding</button>
        {(["claude", "codex", "kimi"] as const).map((provider) => (
          <button key={provider} type="button" onClick={() => void props.onSubmit({ ...SUBMISSION, provider })}>submit-{provider}</button>
        ))}
        {actionStage && (
          <button type="button" onClick={() => void props.onRuntimeAction(actionStage).catch(() => undefined)}>continue-runtime</button>
        )}
        {props.providerLogin && <pre aria-label="provider-output">{props.providerLogin.output}</pre>}
        {props.providerLogin?.status === "active" && (
          <>
            <button type="button" onClick={() => void props.onProviderInput("verification response")}>send-provider-input</button>
            <button type="button" onClick={() => void props.onProviderClose().catch(() => undefined)}>close-provider-login</button>
          </>
        )}
      </section>
    );
  },
}));
vi.mock("../pages/dashboard/load-dashboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../pages/dashboard/load-dashboard")>()),
  loadDashboard: vi.fn(),
}));
vi.mock("../pages/assistant-onboarding", () => ({
  AssistantOnboarding: (props: AssistantOnboardingProps) => (
    <section data-testid="assistant-guide" data-initial={JSON.stringify(props.initialState)}>
      <button type="button" onClick={() => props.onStateChange?.({ path: "tour", step: 2 })}>
        save-assistant-progress
      </button>
      <button
        type="button"
        onClick={() => void props.onComplete(
          { path: "tour", step: 4 },
          "Prima domanda confermata",
        ).catch(() => undefined)}
      >
        complete-assistant-guide
      </button>
    </section>
  ),
}));

const SUBMISSION: OnboardingSubmission = {
  profile: {
    fullName: "Synthetic Person",
    targetRole: "Engineer",
    location: "Example City",
    experienceYears: 3,
    skills: ["Rust", "Testing"],
    languages: ["Italian"],
    workMode: "hybrid",
    notes: "",
  },
  host: { kind: "local" },
  provider: "claude",
};

const SNAPSHOT: OnboardingRuntimeSnapshot = {
  runtimeInstalled: true,
  containerRunning: true,
  providerConfigured: true,
  providerAuthenticated: false,
  assistantRunning: false,
  captainRunning: false,
  profileReady: true,
  assistantWelcomed: false,
  directChatReady: false,
};

const TEAM_READY: OnboardingRuntimeSnapshot = {
  ...SNAPSHOT,
  providerAuthenticated: true,
  assistantRunning: true,
  captainRunning: true,
};

const ASSISTANT_READY: OnboardingRuntimeSnapshot = {
  ...TEAM_READY,
  assistantWelcomed: true,
};

type SessionState = ReturnType<typeof useSession>;
const signedIn = {
  session: {
    user: { id: "synthetic-user", email: "person@example.invalid" },
    refresh_token: "synthetic-refresh-token",
  },
  loading: false,
} as unknown as SessionState;

function signedInAs(userId: string): SessionState {
  return {
    session: {
      user: { id: userId, email: `${userId}@example.invalid` },
      refresh_token: `synthetic-${userId}`,
    },
    loading: false,
  } as unknown as SessionState;
}

function arrangeAssistantGuide() {
  vi.mocked(loadOnboardingGate).mockResolvedValue({
    phase: "required",
    account: { displayName: "Synthetic Person" },
    runtime: { status: "collecting", stage: "profile" },
  });
  vi.mocked(prepareOnboardingRuntime).mockResolvedValue({ ...SNAPSHOT, providerAuthenticated: true });
  vi.mocked(startOnboardingTeam).mockResolvedValue(TEAM_READY);
  vi.mocked(openOnboardingAssistant).mockResolvedValue(ASSISTANT_READY);
  vi.mocked(readOnboardingSnapshot).mockResolvedValue(ASSISTANT_READY);
  vi.mocked(connectDirectChat).mockResolvedValue({ state: "ready" });
}

async function reachAssistantGuide(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "submit-onboarding" }));
  expect(await screen.findByText("action-required:assistant")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "continue-runtime" }));
  expect(await screen.findByTestId("assistant-guide")).toBeInTheDocument();
}

describe("DashboardApp onboarding router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.location.hash = "#/dashboard";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    vi.mocked(loadDashboard).mockResolvedValue(fixtureData());
    vi.mocked(saveOnboardingProfile).mockResolvedValue(SUBMISSION.profile);
    vi.mocked(closeOnboardingProviderLogin).mockResolvedValue();
    vi.mocked(sendOnboardingProviderInput).mockResolvedValue();
    vi.mocked(directChatStatus).mockResolvedValue({ state: "ready" });
    vi.mocked(sendDirectChat).mockImplementation(async (_agent, _text, clientMessageId) => ({
      clientMessageId,
      accepted: true,
      messageId: "synthetic-message",
      at: 1,
    }));
  });

  it("sends whoever has no session to Google sign-in", () => {
    vi.mocked(useSession).mockReturnValue({ session: null, loading: false });
    render(<DashboardApp />);
    expect(goTo).toHaveBeenCalledWith(LOGIN_PAGE);
    expect(loadOnboardingGate).not.toHaveBeenCalled();
    expect(loadDashboard).not.toHaveBeenCalled();
  });

  it("shows onboarding for a brand-new Google account", async () => {
    vi.mocked(useSession).mockReturnValue(signedIn);
    vi.mocked(loadOnboardingGate).mockResolvedValue({
      phase: "required",
      account: { displayName: "Synthetic Person" },
      runtime: { status: "collecting", stage: "profile" },
    });
    render(<DashboardApp />);
    expect(await screen.findByTestId("onboarding")).toHaveTextContent("collecting:profile");
    expect(loadDashboard).not.toHaveBeenCalled();
  });

  it("opens the dashboard for an account with complete durable evidence", async () => {
    vi.mocked(useSession).mockReturnValue(signedIn);
    vi.mocked(loadOnboardingGate).mockResolvedValue({ phase: "ready" });
    render(<DashboardApp />);
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Team locale" })).not.toBeInTheDocument();
  });

  it("opens messages only after provider, team, guided Assistant, receipt and re-read facts are verified", async () => {
    vi.mocked(useSession).mockReturnValue(signedIn);
    vi.mocked(loadOnboardingGate).mockResolvedValue({
      phase: "required",
      account: { displayName: "Synthetic Person" },
      runtime: { status: "collecting", stage: "profile" },
    });
    vi.mocked(prepareOnboardingRuntime).mockResolvedValue(SNAPSHOT);
    vi.mocked(startOnboardingProviderLogin).mockImplementation(async (_host, onEvent) => {
      queueMicrotask(() => onEvent({ kind: "exit", code: 0 }));
      return "synthetic-session";
    });
    vi.mocked(readOnboardingSnapshot).mockResolvedValue({
      ...SNAPSHOT,
      providerAuthenticated: true,
      assistantRunning: true,
      captainRunning: true,
      assistantWelcomed: true,
    });
    vi.mocked(startOnboardingTeam).mockResolvedValue({
      ...SNAPSHOT,
      providerAuthenticated: true,
      assistantRunning: true,
      captainRunning: true,
    });
    vi.mocked(openOnboardingAssistant).mockResolvedValue({
      ...SNAPSHOT,
      providerAuthenticated: true,
      assistantRunning: true,
      captainRunning: true,
      assistantWelcomed: true,
    });
    vi.mocked(connectDirectChat).mockResolvedValue({ state: "ready" });

    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(await screen.findByRole("button", { name: "submit-onboarding" }));
    expect(await screen.findByText("action-required:provider-login")).toBeInTheDocument();
    expect(loadDashboard).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "continue-runtime" }));
    expect(await screen.findByText("action-required:assistant")).toBeInTheDocument();
    expect(loadDashboard).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "continue-runtime" }));
    expect(await screen.findByTestId("assistant-guide")).toBeInTheDocument();
    expect(markOnboardingReady).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "complete-assistant-guide" }));
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(connectDirectChat).toHaveBeenCalledWith({ kind: "local" });
    expect(sendDirectChat).toHaveBeenCalledWith(
      "assistente",
      "Prima domanda confermata",
      expect.stringMatching(/^assistant-onboarding-[a-f0-9]{64}$/),
    );
    expect(directChatStatus).toHaveBeenCalled();
    expect(markOnboardingReady).toHaveBeenCalledWith(
      "synthetic-user",
      expect.objectContaining({ directChatReady: true }),
    );
    expect(navigate).toHaveBeenCalledWith("/messages", { replace: true });
    expect(markOnboardingStarted).toHaveBeenCalledWith("synthetic-user");
    await waitFor(() => expect(loadDashboard).toHaveBeenCalled());
  });

  it.each(["claude", "codex", "kimi"] as const)("streams and controls the %s login session", async (provider) => {
    vi.mocked(useSession).mockReturnValue(signedIn);
    vi.mocked(loadOnboardingGate).mockResolvedValue({
      phase: "required",
      account: { displayName: "Synthetic Person" },
      runtime: { status: "collecting", stage: "profile" },
    });
    vi.mocked(prepareOnboardingRuntime).mockResolvedValue(SNAPSHOT);
    let emit!: (event: OnboardingInteractiveEvent) => void;
    vi.mocked(startOnboardingProviderLogin).mockImplementation(async (_host, onEvent) => {
      emit = onEvent;
      return `session-${provider}`;
    });

    const user = userEvent.setup();
    render(<DashboardApp />);
    await user.click(await screen.findByRole("button", { name: `submit-${provider}` }));
    await user.click(await screen.findByRole("button", { name: "continue-runtime" }));

    await waitFor(() => expect(startOnboardingProviderLogin).toHaveBeenCalled());
    if (provider === "codex") {
      expect(sendOnboardingProviderInput).not.toHaveBeenCalled();
    } else {
      expect(sendOnboardingProviderInput).toHaveBeenCalledWith(`session-${provider}`, "/login");
    }

    emit({ kind: "output", text: `Use https://login.example.invalid/${provider} with CODE-${provider}` });
    expect(await screen.findByLabelText("provider-output")).toHaveTextContent(`CODE-${provider}`);

    await user.click(screen.getByRole("button", { name: "send-provider-input" }));
    expect(sendOnboardingProviderInput).toHaveBeenLastCalledWith(`session-${provider}`, "verification response");

    await user.click(screen.getByRole("button", { name: "close-provider-login" }));
    expect(closeOnboardingProviderLogin).toHaveBeenCalledWith(`session-${provider}`);
    expect(await screen.findByText("failed:provider-login")).toBeInTheDocument();
  });

  it("keeps the final marker closed when the native snapshot cannot prove readiness", async () => {
    vi.mocked(useSession).mockReturnValue(signedIn);
    arrangeAssistantGuide();
    vi.mocked(readOnboardingSnapshot).mockResolvedValue({ ...ASSISTANT_READY, captainRunning: false });

    const user = userEvent.setup();
    render(<DashboardApp />);
    await reachAssistantGuide(user);
    await user.click(screen.getByRole("button", { name: "complete-assistant-guide" }));

    await waitFor(() => expect(readOnboardingSnapshot).toHaveBeenCalled());
    expect(sendDirectChat).not.toHaveBeenCalled();
    expect(markOnboardingReady).not.toHaveBeenCalled();
    expect(screen.getByTestId("assistant-guide")).toBeInTheDocument();
  });

  it("retries a post-send chat verification with the same de-duplication id", async () => {
    vi.mocked(useSession).mockReturnValue(signedIn);
    arrangeAssistantGuide();
    vi.mocked(directChatStatus)
      .mockResolvedValueOnce({ state: "error", code: "synthetic-disconnect" })
      .mockResolvedValueOnce({ state: "ready" });

    const user = userEvent.setup();
    render(<DashboardApp />);
    await reachAssistantGuide(user);
    await user.click(screen.getByRole("button", { name: "complete-assistant-guide" }));
    await waitFor(() => expect(directChatStatus).toHaveBeenCalledTimes(1));
    expect(markOnboardingReady).not.toHaveBeenCalled();
    expect(screen.getByTestId("assistant-guide")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "complete-assistant-guide" }));
    await waitFor(() => expect(markOnboardingReady).toHaveBeenCalledTimes(1));
    expect(sendDirectChat).toHaveBeenCalledTimes(2);
    const firstId = vi.mocked(sendDirectChat).mock.calls[0][2];
    const retryId = vi.mocked(sendDirectChat).mock.calls[1][2];
    expect(retryId).toBe(firstId);
  });

  it("does not reuse guided state across logout or an account switch", async () => {
    arrangeAssistantGuide();
    localStorage.setItem("jht.desktop.assistant-onboarding.account-a", JSON.stringify({ path: "tour", step: 3 }));
    localStorage.setItem("jht.desktop.assistant-onboarding.account-b", JSON.stringify({ path: "explore", step: 1 }));
    let currentSession = signedInAs("account-a");
    vi.mocked(useSession).mockImplementation(() => currentSession);

    const user = userEvent.setup();
    const view = render(<DashboardApp />);
    await reachAssistantGuide(user);
    expect(screen.getByTestId("assistant-guide")).toHaveAttribute(
      "data-initial",
      JSON.stringify({ path: "tour", step: 3 }),
    );
    await user.click(screen.getByRole("button", { name: "save-assistant-progress" }));
    expect(JSON.parse(localStorage.getItem("jht.desktop.assistant-onboarding.account-a") ?? "null"))
      .toEqual({ path: "tour", step: 2 });

    currentSession = { session: null, loading: false };
    view.rerender(<DashboardApp />);
    await waitFor(() => expect(goTo).toHaveBeenCalledWith(LOGIN_PAGE));
    expect(screen.queryByTestId("assistant-guide")).not.toBeInTheDocument();

    currentSession = signedInAs("account-b");
    view.rerender(<DashboardApp />);
    expect(await screen.findByTestId("onboarding")).toBeInTheDocument();
    expect(screen.queryByTestId("assistant-guide")).not.toBeInTheDocument();
    await reachAssistantGuide(user);
    expect(screen.getByTestId("assistant-guide")).toHaveAttribute(
      "data-initial",
      JSON.stringify({ path: "explore", step: 1 }),
    );
    expect(Object.keys(JSON.parse(localStorage.getItem("jht.desktop.assistant-onboarding.account-a") ?? "{}")))
      .toEqual(["path", "step"]);
    expect(Object.keys(JSON.parse(localStorage.getItem("jht.desktop.assistant-onboarding.account-b") ?? "{}")))
      .toEqual(["path", "step"]);
  });
});
