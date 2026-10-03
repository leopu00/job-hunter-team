import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { goTo } from "./lib/pages";
import { useSession } from "./lib/supabase";
import { clearLocalIdentitySelection, localIdentitySelected } from "./lib/local-profile";
import { onboardingPlaygroundEnabled } from "./lib/onboarding-playground";

vi.mock("./lib/supabase", () => ({ useSession: vi.fn() }));
vi.mock("./lib/local-profile", () => ({
  clearLocalIdentitySelection: vi.fn(),
  localIdentitySelected: vi.fn(),
}));
vi.mock("./lib/onboarding-playground", () => ({ onboardingPlaygroundEnabled: vi.fn() }));
vi.mock("./components/login-screen", () => ({
  LoginScreen: ({
    onChooseGoogle,
    onLocalReady,
  }: {
    onChooseGoogle?: () => boolean | Promise<boolean>;
    onLocalReady?: () => void;
  }) => (
    <section>
      <p>login-screen</p>
      {onChooseGoogle && <button type="button" onClick={() => void onChooseGoogle()}>choose-google</button>}
      {onLocalReady && <button type="button" onClick={onLocalReady}>choose-local</button>}
    </section>
  ),
}));
vi.mock("./lib/pages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/pages")>()),
  goTo: vi.fn(),
}));

describe("authentication entrypoint", () => {
  beforeEach(() => {
    vi.mocked(goTo).mockReset();
    vi.mocked(clearLocalIdentitySelection).mockReset();
    vi.mocked(localIdentitySelected).mockReturnValue(false);
    vi.mocked(onboardingPlaygroundEnabled).mockReturnValue(false);
  });

  it("shows the identity entrypoint and no API-key setup entry", () => {
    vi.mocked(useSession).mockReturnValue({ session: null, loading: false });
    render(<App />);
    expect(screen.getByText("login-screen")).toBeInTheDocument();
    expect(screen.queryByText(/team locale/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/api key/i)).not.toBeInTheDocument();
    expect(goTo).not.toHaveBeenCalled();
  });

  it("routes a restored local identity into the same gated dashboard entrypoint", () => {
    vi.mocked(useSession).mockReturnValue({ session: null, loading: false });
    vi.mocked(localIdentitySelected).mockReturnValue(true);
    render(<App />);
    expect(goTo).toHaveBeenCalledWith("dashboard.html");
  });

  it("routes a restored Google session into the gated dashboard entrypoint", () => {
    vi.mocked(useSession).mockReturnValue({
      session: { user: { id: "synthetic-user" } },
      loading: false,
    } as unknown as ReturnType<typeof useSession>);
    render(<App />);
    expect(goTo).toHaveBeenCalledWith("dashboard.html");
  });

  it("keeps an existing Google session on step 1 when playground mode is enabled", () => {
    vi.mocked(onboardingPlaygroundEnabled).mockReturnValue(true);
    vi.mocked(useSession).mockReturnValue({
      session: { user: { id: "synthetic-user" } },
      loading: false,
    } as unknown as ReturnType<typeof useSession>);

    render(<App />);

    expect(screen.getByText("login-screen")).toBeInTheDocument();
    expect(goTo).not.toHaveBeenCalled();
  });

  it("keeps an existing local profile on step 1 when playground mode is enabled", () => {
    vi.mocked(onboardingPlaygroundEnabled).mockReturnValue(true);
    vi.mocked(useSession).mockReturnValue({ session: null, loading: false });
    vi.mocked(localIdentitySelected).mockReturnValue(true);

    render(<App />);

    expect(screen.getByText("login-screen")).toBeInTheDocument();
    expect(goTo).not.toHaveBeenCalled();
  });

  it("continues an existing Google session only after the explicit playground choice", async () => {
    vi.mocked(onboardingPlaygroundEnabled).mockReturnValue(true);
    vi.mocked(useSession).mockReturnValue({
      session: { user: { id: "synthetic-user" } },
      loading: false,
    } as unknown as ReturnType<typeof useSession>);
    vi.mocked(localIdentitySelected).mockReturnValue(true);

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "choose-google" }));

    expect(clearLocalIdentitySelection).toHaveBeenCalledOnce();
    expect(goTo).toHaveBeenCalledWith("dashboard.html");
  });

  it("continues the selected local profile without clearing sessions or profile data", async () => {
    vi.mocked(onboardingPlaygroundEnabled).mockReturnValue(true);
    vi.mocked(useSession).mockReturnValue({ session: null, loading: false });
    vi.mocked(localIdentitySelected).mockReturnValue(true);

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "choose-local" }));

    expect(clearLocalIdentitySelection).not.toHaveBeenCalled();
    expect(goTo).toHaveBeenCalledWith("dashboard.html");
  });
});
