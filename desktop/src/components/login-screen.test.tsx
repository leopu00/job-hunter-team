import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LoginError } from "../lib/supabase";
import { LoginScreen } from "./login-screen";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("LoginScreen", () => {
  it("starts the Google sign-in and waits for the browser, with a way out", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const signIn = vi.fn(() => pending.promise);
    const cancel = vi.fn(async () => pending.reject(new LoginError("cancelled")));
    render(<LoginScreen signIn={signIn} cancel={cancel} configured />);

    await user.click(screen.getByRole("button", { name: /Accedi con Google/ }));
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Completa l'accesso nel browser");

    await user.click(screen.getByRole("button", { name: "Annulla" }));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Accesso annullato.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Accedi con Google/ })).toBeEnabled();
  });

  it("says why a sign-in failed and lets the user retry", async () => {
    const user = userEvent.setup();
    const signIn = vi
      .fn()
      .mockRejectedValueOnce(new LoginError("denied", "User denied"))
      .mockResolvedValueOnce(undefined);
    render(<LoginScreen signIn={signIn} configured />);

    await user.click(screen.getByRole("button", { name: /Accedi con Google/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Accesso non concesso. (User denied)");

    await user.click(screen.getByRole("button", { name: /Accedi con Google/ }));
    expect(signIn).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables the button when the build has no Supabase project", () => {
    render(<LoginScreen configured={false} />);
    expect(screen.getByRole("button", { name: /Accedi con Google/ })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("VITE_SUPABASE_URL");
  });
});
