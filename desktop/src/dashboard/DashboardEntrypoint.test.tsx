import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearGoogleIdentitySelection,
  selectGoogleIdentity,
} from "../lib/identity-choice";
import {
  clearLocalIdentitySelection,
  resetPlaygroundLocalProfile,
} from "../lib/local-profile";
import { onboardingPlaygroundEnabled } from "../lib/onboarding-playground";
import { useDeferredSession } from "../lib/supabase";
import { DashboardEntrypoint } from "./DashboardEntrypoint";

vi.mock("../lib/onboarding-playground", () => ({ onboardingPlaygroundEnabled: vi.fn() }));
vi.mock("../lib/local-profile", () => ({
  clearLocalIdentitySelection: vi.fn(),
  resetPlaygroundLocalProfile: vi.fn(),
}));
vi.mock("../lib/identity-choice", () => ({
  clearGoogleIdentitySelection: vi.fn(),
  selectGoogleIdentity: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({ useDeferredSession: vi.fn() }));
vi.mock("./DashboardApp", () => ({ default: () => <p>dashboard-app</p> }));
vi.mock("../components/login-screen", () => ({
  LoginScreen: ({
    onChooseGoogle,
      onLocalReady,
      onResetLocalPlayground,
    }: {
      onChooseGoogle: () => boolean | Promise<boolean>;
      onLocalReady: () => void;
      onResetLocalPlayground?: () => Promise<void>;
  }) => (
    <section>
      <p>identity-choice</p>
      <button type="button" onClick={() => void onChooseGoogle()}>choose-google</button>
      <button type="button" onClick={onLocalReady}>choose-local</button>
      {onResetLocalPlayground && (
        <button type="button" onClick={() => void onResetLocalPlayground()}>reset-local</button>
      )}
    </section>
  ),
}));

describe("dashboard.html entrypoint", () => {
  const restore = vi.fn();

  beforeEach(() => {
    vi.mocked(onboardingPlaygroundEnabled).mockReturnValue(false);
    vi.mocked(clearLocalIdentitySelection).mockReset();
    vi.mocked(clearGoogleIdentitySelection).mockReset();
    vi.mocked(selectGoogleIdentity).mockReset();
    vi.mocked(resetPlaygroundLocalProfile).mockReset().mockResolvedValue();
    restore.mockReset().mockResolvedValue(null);
    vi.mocked(useDeferredSession).mockReturnValue({ session: null, loading: false, restore });
  });

  it("keeps the production entrypoint unchanged without the playground flag", () => {
    render(<DashboardEntrypoint />);
    expect(screen.getByText("dashboard-app")).toBeInTheDocument();
    expect(screen.queryByText("identity-choice")).not.toBeInTheDocument();
  });

  it("forces identity choice despite a restored Google session until Google is chosen", async () => {
    vi.mocked(onboardingPlaygroundEnabled).mockReturnValue(true);
    vi.mocked(useDeferredSession).mockReturnValue({
      session: { user: { id: "synthetic-user" } },
      loading: false,
      restore,
    } as unknown as ReturnType<typeof useDeferredSession>);

    render(<DashboardEntrypoint />);
    expect(screen.getByText("identity-choice")).toBeInTheDocument();
    expect(screen.queryByText("dashboard-app")).not.toBeInTheDocument();
    expect(restore).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "choose-google" }));
    expect(clearLocalIdentitySelection).toHaveBeenCalledOnce();
    expect(selectGoogleIdentity).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledOnce();
    expect(screen.getByText("dashboard-app")).toBeInTheDocument();
  });

  it("waits for a new Google session after the explicit choice", async () => {
    vi.mocked(onboardingPlaygroundEnabled).mockReturnValue(true);
    const view = render(<DashboardEntrypoint />);

    await userEvent.click(screen.getByRole("button", { name: "choose-google" }));
    expect(screen.getByText("identity-choice")).toBeInTheDocument();

    vi.mocked(useDeferredSession).mockReturnValue({
      session: { user: { id: "new-synthetic-user" } },
      loading: false,
      restore,
    } as unknown as ReturnType<typeof useDeferredSession>);
    view.rerender(<DashboardEntrypoint />);
    expect(screen.getByText("dashboard-app")).toBeInTheDocument();
  });

  it("enters the dashboard only after the local path reports its scope ready", async () => {
    vi.mocked(onboardingPlaygroundEnabled).mockReturnValue(true);
    render(<DashboardEntrypoint />);

    await userEvent.click(screen.getByRole("button", { name: "choose-local" }));
    expect(clearLocalIdentitySelection).not.toHaveBeenCalled();
    expect(clearGoogleIdentitySelection).toHaveBeenCalledOnce();
    expect(restore).not.toHaveBeenCalled();
    expect(screen.getByText("dashboard-app")).toBeInTheDocument();
  });

  it("exposes the atomic local reset only through the DEV playground entrypoint", async () => {
    vi.mocked(onboardingPlaygroundEnabled).mockReturnValue(true);
    render(<DashboardEntrypoint />);

    await userEvent.click(screen.getByRole("button", { name: "reset-local" }));
    expect(resetPlaygroundLocalProfile).toHaveBeenCalledOnce();
    expect(screen.getByText("identity-choice")).toBeInTheDocument();
  });
});
