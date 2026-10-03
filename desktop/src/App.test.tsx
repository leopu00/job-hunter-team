import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  clearGoogleIdentitySelection,
  selectGoogleIdentity,
} from "./lib/identity-choice";
import { goTo } from "./lib/pages";
import { useDeferredSession } from "./lib/supabase";
import { clearLocalIdentitySelection } from "./lib/local-profile";

vi.mock("./lib/supabase", () => ({ useDeferredSession: vi.fn() }));
vi.mock("./lib/local-profile", () => ({
  clearLocalIdentitySelection: vi.fn(),
}));
vi.mock("./lib/identity-choice", () => ({
  clearGoogleIdentitySelection: vi.fn(),
  selectGoogleIdentity: vi.fn(),
}));
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
  const restore = vi.fn();

  beforeEach(() => {
    vi.mocked(goTo).mockReset();
    vi.mocked(clearLocalIdentitySelection).mockReset();
    vi.mocked(clearGoogleIdentitySelection).mockReset();
    vi.mocked(selectGoogleIdentity).mockReset();
    restore.mockReset().mockResolvedValue(null);
    vi.mocked(useDeferredSession).mockReturnValue({
      session: null,
      loading: false,
      restore,
    });
  });

  it("shows the production identity frame without restoring Google or opening its storage", () => {
    render(<App />);
    expect(screen.getByText("login-screen")).toBeInTheDocument();
    expect(screen.queryByText(/team locale/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/api key/i)).not.toBeInTheDocument();
    expect(restore).not.toHaveBeenCalled();
    expect(selectGoogleIdentity).not.toHaveBeenCalled();
    expect(clearGoogleIdentitySelection).toHaveBeenCalledOnce();
    expect(goTo).not.toHaveBeenCalled();
  });

  it("enters the local path without restoring Google", async () => {
    render(<App />);
    expect(clearGoogleIdentitySelection).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "choose-local" }));
    expect(restore).not.toHaveBeenCalled();
    expect(clearGoogleIdentitySelection).toHaveBeenCalledTimes(2);
    expect(goTo).toHaveBeenCalledWith("dashboard.html");
  });

  it("starts reliable Google restore only after the explicit production choice", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "choose-google" }));

    expect(clearLocalIdentitySelection).toHaveBeenCalledOnce();
    expect(selectGoogleIdentity).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledOnce();
    expect(goTo).not.toHaveBeenCalled();
  });

  it("routes a restored Google session after the explicit choice", async () => {
    const view = render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "choose-google" }));
    vi.mocked(useDeferredSession).mockReturnValue({
      session: { user: { id: "synthetic-user" } },
      loading: false,
      restore,
    } as unknown as ReturnType<typeof useDeferredSession>);
    view.rerender(<App />);

    expect(goTo).toHaveBeenCalledWith("dashboard.html");
  });
});
