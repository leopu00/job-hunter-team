import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { goTo } from "./lib/pages";
import { useSession } from "./lib/supabase";
import { localIdentitySelected } from "./lib/local-profile";

vi.mock("./lib/supabase", () => ({ useSession: vi.fn() }));
vi.mock("./lib/local-profile", () => ({ localIdentitySelected: vi.fn() }));
vi.mock("./components/login-screen", () => ({ LoginScreen: () => <p>login-screen</p> }));
vi.mock("./lib/pages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/pages")>()),
  goTo: vi.fn(),
}));

describe("authentication entrypoint", () => {
  beforeEach(() => {
    vi.mocked(goTo).mockReset();
    vi.mocked(localIdentitySelected).mockReturnValue(false);
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
});
