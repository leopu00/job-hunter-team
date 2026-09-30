import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectDirectChat } from "../lib/direct-chat";
import {
  loadOnboardingGate,
  markOnboardingReady,
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
  startOnboardingProviderLogin,
  startOnboardingTeam,
} from "../lib/onboarding-runtime";
import { goTo, LOGIN_PAGE } from "../lib/pages";
import { fixtureData } from "../pages/dashboard/dashboard-fixture";
import { loadDashboard } from "../pages/dashboard/load-dashboard";
import { useSession } from "../lib/supabase";
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
}));
vi.mock("../lib/onboarding-runtime", () => ({
  closeOnboardingProviderLogin: vi.fn(),
  openOnboardingAssistant: vi.fn(),
  prepareOnboardingRuntime: vi.fn(),
  readOnboardingSnapshot: vi.fn(),
  startOnboardingProviderLogin: vi.fn(),
  startOnboardingTeam: vi.fn(),
}));
vi.mock("../lib/direct-chat", () => ({ connectDirectChat: vi.fn() }));
vi.mock("../onboarding", () => ({
  OnboardingFlow: (props: OnboardingFlowProps) => {
    const stage = props.runtime.status === "ready" ? "" : `:${props.runtime.stage}`;
    const actionStage = props.runtime.status === "action-required" ? props.runtime.stage : null;
    return (
      <section data-testid="onboarding">
        <p>{props.runtime.status}{stage}</p>
        <button type="button" onClick={() => void props.onSubmit(SUBMISSION)}>submit-onboarding</button>
        {actionStage && (
          <button type="button" onClick={() => void props.onRuntimeAction(actionStage)}>continue-runtime</button>
        )}
      </section>
    );
  },
}));
vi.mock("../pages/dashboard/load-dashboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../pages/dashboard/load-dashboard")>()),
  loadDashboard: vi.fn(),
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

type SessionState = ReturnType<typeof useSession>;
const signedIn = {
  session: {
    user: { id: "synthetic-user", email: "person@example.invalid" },
    refresh_token: "synthetic-refresh-token",
  },
  loading: false,
} as unknown as SessionState;

describe("DashboardApp onboarding router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadDashboard).mockResolvedValue(fixtureData());
    vi.mocked(saveOnboardingProfile).mockResolvedValue(SUBMISSION.profile);
    vi.mocked(closeOnboardingProviderLogin).mockResolvedValue();
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

  it("reaches the dashboard only after provider, team, Assistant and direct chat are verified", async () => {
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
    vi.mocked(readOnboardingSnapshot).mockResolvedValue({ ...SNAPSHOT, providerAuthenticated: true });
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
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(connectDirectChat).toHaveBeenCalledWith({ kind: "local" });
    expect(markOnboardingReady).toHaveBeenCalledWith(
      "synthetic-user",
      expect.objectContaining({ directChatReady: true }),
    );
    await waitFor(() => expect(loadDashboard).toHaveBeenCalled());
  });
});
