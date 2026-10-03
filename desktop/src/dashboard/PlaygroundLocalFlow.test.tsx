import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { OnboardingFlowProps, OnboardingSubmission } from "../lib/onboarding";
import { DashboardEntrypoint } from "./DashboardEntrypoint";

const SUBMISSION: OnboardingSubmission = {
  host: { kind: "local" },
  provider: "claude",
};

vi.mock("../lib/onboarding-playground", () => ({
  onboardingPlaygroundEnabled: () => true,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => true,
  Channel: class MockChannel {
    onmessage: ((value: unknown) => void) | null = null;
  },
}));
vi.mock("../lib/supabase", () => ({
  supabase: { from: vi.fn() },
  supabaseConfig: { configured: true, url: "https://example.invalid" },
  supabaseConfigured: true,
  useDeferredSession: () => ({ session: null, loading: false, restore: vi.fn() }),
  useSession: () => ({ session: null, loading: false }),
  signInWithGoogle: vi.fn(),
  cancelGoogleSignIn: vi.fn(),
}));
vi.mock("../lib/browsers", () => ({
  listBrowsers: async () => [],
  readBrowserChoice: () => "default",
  saveBrowserChoice: vi.fn(),
}));
vi.mock("../lib/desktop-platform", () => ({
  readDesktopPlatform: async () => "macos",
}));
vi.mock("../lib/pages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/pages")>()),
  goTo: vi.fn(),
}));
vi.mock("../lib/direct-chat", () => ({
  connectDirectChat: vi.fn(),
  directChatStatus: vi.fn(),
  reconnectDirectChat: vi.fn(),
}));
vi.mock("../onboarding", () => ({
  OnboardingFlow: (props: OnboardingFlowProps) => (
    <section data-testid="integrated-onboarding">
      <button type="button" onClick={() => void props.onSubmit(SUBMISSION).catch(() => undefined)}>
        prepare-local
      </button>
    </section>
  ),
}));
vi.mock("../onboarding/ExistingTeamConnectModal", () => ({ default: () => null }));
vi.mock("../pages/messages", () => ({ default: () => null }));
vi.mock("../shell/Shell", () => ({ default: () => null }));
vi.mock("../shell/router", () => ({ navigate: vi.fn() }));

describe("DEV playground local flow", () => {
  const prepared = {
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

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.resetAllMocks();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "runtime_playground_local_orphan_recover") return false;
      if (command === "runtime_local_profile_create") {
        return { profileId: "opaque-profile-b" };
      }
      if (command === "onboarding_prepare") return prepared;
      return undefined;
    });
  });

  it("awaits one orphan recovery from first frame before B and local prepare", async () => {
    const user = userEvent.setup();
    let finishRecovery!: () => void;
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "runtime_playground_local_orphan_recover") {
        return new Promise<boolean>((resolve) => {
          finishRecovery = () => resolve(true);
        });
      }
      if (command === "runtime_local_profile_create") {
        return Promise.resolve({ profileId: "opaque-profile-b" });
      }
      if (command === "onboarding_prepare") return Promise.resolve(prepared);
      return Promise.resolve(undefined);
    });
    render(<DashboardEntrypoint />);

    await user.click(screen.getByRole("button", { name: "Usa in locale" }));
    await user.type(screen.getByRole("textbox", { name: "Nome visualizzato" }), "Bea Locale");
    const create = screen.getByRole("button", { name: "Continua in locale" });
    await user.dblClick(create);

    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      "runtime_playground_local_orphan_recover",
    ]);

    finishRecovery();
    await screen.findByTestId("integrated-onboarding");
    await user.click(screen.getByRole("button", { name: "prepare-local" }));
    await vi.waitFor(() => expect(
      vi.mocked(invoke).mock.calls.filter(([command]) => command === "onboarding_prepare"),
    ).toHaveLength(1));

    const commands = vi.mocked(invoke).mock.calls.map(([command]) => command);
    expect(commands.filter((command) => command === "runtime_playground_local_orphan_recover"))
      .toHaveLength(1);
    expect(commands.filter((command) => command === "runtime_local_profile_create")).toHaveLength(1);
    expect(commands.filter((command) => command === "onboarding_prepare")).toHaveLength(1);
    expect(commands.indexOf("runtime_playground_local_orphan_recover"))
      .toBeLessThan(commands.indexOf("runtime_local_profile_create"));
    expect(commands.indexOf("runtime_local_profile_create"))
      .toBeLessThan(commands.indexOf("runtime_account_scope_set_local"));
    expect(commands.indexOf("runtime_account_scope_set_local"))
      .toBeLessThan(commands.indexOf("onboarding_prepare"));
  });

  it("keeps B and prepare unreachable when orphan recovery fails", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "runtime_playground_local_orphan_recover") {
        throw { code: "playground_reset_owner_unattested" };
      }
      if (command === "runtime_local_profile_create") {
        return { profileId: "opaque-profile-b" };
      }
      if (command === "onboarding_prepare") return prepared;
      return undefined;
    });
    render(<DashboardEntrypoint />);

    await user.click(screen.getByRole("button", { name: "Usa in locale" }));
    await user.type(screen.getByRole("textbox", { name: "Nome visualizzato" }), "Bea Locale");
    await user.click(screen.getByRole("button", { name: "Continua in locale" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/profilo locale/i);
    const commands = vi.mocked(invoke).mock.calls.map(([command]) => command);
    expect(commands).toEqual(["runtime_playground_local_orphan_recover"]);
    expect(commands).not.toContain("runtime_local_profile_create");
    expect(commands).not.toContain("runtime_account_scope_set_local");
    expect(commands).not.toContain("onboarding_prepare");
    expect(screen.queryByTestId("integrated-onboarding")).not.toBeInTheDocument();
  });
});
