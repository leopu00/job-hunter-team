import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstalledBrowser } from "../lib/browsers";
import { LoginError, type SignInOptions } from "../lib/supabase";
import { LoginScreen } from "./login-screen";

const CANARY: InstalledBrowser = { id: "chrome-canary", name: "Google Chrome Canary" };
const AUTHORIZE = "https://example-ref.supabase.co/auth/v1/authorize?provider=google";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const noBrowsers = async () => [] as InstalledBrowser[];

beforeEach(() => {
  localStorage.clear();
});

describe("LoginScreen", () => {
  it("starts the Google sign-in and waits for the browser, with a way out", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const signIn = vi.fn((_options: SignInOptions) => pending.promise);
    const cancel = vi.fn(async () => pending.reject(new LoginError("cancelled")));
    render(<LoginScreen signIn={signIn} cancel={cancel} loadBrowsers={noBrowsers} configured />);

    await user.click(screen.getByRole("button", { name: /Accedi con Google/ }));
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(signIn.mock.calls[0][0].browser).toBe("default");
    expect(screen.getByRole("status")).toHaveTextContent("Completa l'accesso nel browser");

    await user.click(screen.getByRole("button", { name: "Annulla" }));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Accesso annullato.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Accedi con Google/ })).toBeEnabled();
  });

  it("lists the detected browsers and remembers the last choice", async () => {
    const user = userEvent.setup();
    const signIn = vi.fn(async (_options: SignInOptions) => undefined);
    const loadBrowsers = async () => [CANARY];
    const first = render(<LoginScreen signIn={signIn} loadBrowsers={loadBrowsers} configured />);

    const select = screen.getByRole("combobox", { name: "Apri con" });
    await screen.findByRole("option", { name: "Google Chrome Canary" });
    await user.selectOptions(select, "chrome-canary");
    await user.click(screen.getByRole("button", { name: /Accedi con Google/ }));
    expect(signIn.mock.calls[0][0].browser).toBe("chrome-canary");
    first.unmount();

    render(<LoginScreen signIn={signIn} loadBrowsers={loadBrowsers} configured />);
    await screen.findByRole("option", { name: "Google Chrome Canary" });
    expect(screen.getByRole("combobox", { name: "Apri con" })).toHaveValue("chrome-canary");
  });

  it("falls back to the default browser when the remembered one is gone", async () => {
    localStorage.setItem("jht.login.browser", "chrome-canary");
    const loadBrowsers = vi.fn(noBrowsers);
    render(<LoginScreen loadBrowsers={loadBrowsers} configured />);
    await vi.waitFor(() => expect(loadBrowsers).toHaveBeenCalled());
    expect(screen.getByRole("combobox", { name: "Apri con" })).toHaveValue("default");
  });

  it("with no browser, shows the link and copies it", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const signIn = vi.fn((options: SignInOptions) => {
      options.onAuthorizeUrl?.(AUTHORIZE);
      return pending.promise;
    });
    render(<LoginScreen signIn={signIn} loadBrowsers={noBrowsers} configured />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Apri con" }), "manual");
    await user.click(screen.getByRole("button", { name: /Accedi con Google/ }));
    expect(signIn.mock.calls[0][0].browser).toBe("manual");
    expect(screen.getByRole("status")).toHaveTextContent("Copia il link");
    expect(screen.getByRole("textbox", { name: "Link di accesso" })).toHaveValue(AUTHORIZE);

    await user.click(screen.getByRole("button", { name: "Copia link" }));
    expect(await navigator.clipboard.readText()).toBe(AUTHORIZE);
    expect(screen.getByRole("button", { name: "Link copiato" })).toBeInTheDocument();
    pending.resolve();
  });

  it("says why a sign-in failed and lets the user retry", async () => {
    const user = userEvent.setup();
    const signIn = vi
      .fn()
      .mockRejectedValueOnce(new LoginError("denied", "User denied"))
      .mockResolvedValueOnce(undefined);
    render(<LoginScreen signIn={signIn} loadBrowsers={noBrowsers} configured />);

    await user.click(screen.getByRole("button", { name: /Accedi con Google/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Accesso non concesso. (User denied)");

    await user.click(screen.getByRole("button", { name: /Accedi con Google/ }));
    expect(signIn).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says the keychain refused, in words the user can act on", async () => {
    const user = userEvent.setup();
    const signIn = vi.fn().mockRejectedValue(new LoginError("keychain-failed"));
    render(<LoginScreen signIn={signIn} loadBrowsers={noBrowsers} configured />);
    await user.click(screen.getByRole("button", { name: /Accedi con Google/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Consenti sempre");
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("disables the button when the build has no Supabase project", () => {
    render(<LoginScreen configured={false} loadBrowsers={noBrowsers} />);
    expect(screen.getByRole("button", { name: /Accedi con Google/ })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("VITE_SUPABASE_URL");
  });
});
