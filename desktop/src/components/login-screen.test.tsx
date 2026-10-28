import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstalledBrowser } from "../lib/browsers";
import { LoginError, type SignInOptions } from "../lib/supabase";
import { LoginScreen } from "./login-screen";
import { LOGIN_TEXT } from "./login-screen.i18n";
import { ERROR_CATALOG } from "../lib/error-catalog";

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
  it("offers Google and local as independent entry paths without old personal questions", () => {
    render(<LoginScreen loadBrowsers={noBrowsers} configured />);
    expect(screen.getByRole("img", { name: /due percorsi di identità/i }))
      .toHaveAttribute("src", "/onboarding/identity.webp");
    expect(screen.getByRole("button", { name: /Continua con Google/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Usa in locale" })).toBeInTheDocument();
    for (const oldQuestion of [/ruolo/i, /anni di esperienza/i, /località/i]) {
      expect(screen.queryByText(oldQuestion)).not.toBeInTheDocument();
    }
  });

  it("creates a local identity with only a device-local display name", async () => {
    const user = userEvent.setup();
    const signIn = vi.fn(async () => undefined);
    const createLocal = vi.fn(async (displayName: string) => ({
      profileId: "opaque-local-profile",
      displayName,
    }));
    const onLocalReady = vi.fn();
    render(
      <LoginScreen
        signIn={signIn}
        loadBrowsers={noBrowsers}
        configured
        readLocal={() => null}
        createLocal={createLocal}
        onLocalReady={onLocalReady}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Usa in locale" }));
    expect(screen.getByRole("textbox", { name: "Nome visualizzato" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/ruolo|esperienza|località/i)).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Nome visualizzato" }), "Ada Locale");
    await user.click(screen.getByRole("button", { name: "Continua in locale" }));

    expect(createLocal).toHaveBeenCalledWith("Ada Locale");
    expect(signIn).not.toHaveBeenCalled();
    expect(onLocalReady).toHaveBeenCalledOnce();
  });

  it("says why «Continua in locale» is off while the name is empty, and says nothing once there is one", async () => {
    const user = userEvent.setup();
    render(<LoginScreen loadBrowsers={noBrowsers} configured readLocal={() => null} createLocal={vi.fn()} onLocalReady={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Usa in locale" }));
    const button = screen.getByRole("button", { name: "Continua in locale" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-describedby", "login-name-missing");
    expect(document.getElementById("login-name-missing")).toHaveTextContent(LOGIN_TEXT.it.nameMissing);
    // a name made only of spaces is still no name
    await user.type(screen.getByRole("textbox", { name: "Nome visualizzato" }), "  ");
    expect(button).toBeDisabled();
    expect(document.getElementById("login-name-missing")).not.toBeNull();
    await user.type(screen.getByRole("textbox", { name: "Nome visualizzato" }), "Ada");
    expect(button).toBeEnabled();
    expect(document.getElementById("login-name-missing")).toBeNull();
    expect(button).not.toHaveAttribute("aria-describedby");
  });

  it.each(Object.keys(LOGIN_TEXT) as (keyof typeof LOGIN_TEXT)[])("%s: the empty-name sentence exists", (locale) => {
    expect(LOGIN_TEXT[locale].nameMissing.trim()).not.toBe("");
  });

  it("selects a saved local profile before the dashboard activates its scope", async () => {
    const user = userEvent.setup();
    const selectLocal = vi.fn((_profileId: string) => ({
      profileId: "opaque-local-profile",
      displayName: "Ada Locale",
    }));
    const onLocalReady = vi.fn();
    render(
      <LoginScreen
        loadBrowsers={noBrowsers}
        configured
        listLocal={() => [{ profileId: "opaque-local-profile", displayName: "Ada Locale" }]}
        readLocal={() => ({ profileId: "opaque-local-profile", displayName: "Ada Locale" })}
        ownerLocal={() => null}
        selectLocal={selectLocal}
        onLocalReady={onLocalReady}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Continua come Ada Locale" }));
    expect(selectLocal).toHaveBeenCalledWith("opaque-local-profile");
    expect(screen.queryByRole("textbox", { name: "Nome visualizzato" })).not.toBeInTheDocument();
    expect(onLocalReady).toHaveBeenCalledOnce();
  });

  it("offers the atomic local reset only when the playground supplies it", async () => {
    const user = userEvent.setup();
    const onResetLocalPlayground = vi.fn(async () => undefined);
    render(
      <LoginScreen
        loadBrowsers={noBrowsers}
        configured
        listLocal={() => [{ profileId: "opaque-local-profile", displayName: "Ada Locale" }]}
        readLocal={() => ({ profileId: "opaque-local-profile", displayName: "Ada Locale" })}
        onResetLocalPlayground={onResetLocalPlayground}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Reimposta identità locale di test" }));
    expect(onResetLocalPlayground).toHaveBeenCalledOnce();
    expect(screen.getByRole("textbox", { name: "Nome visualizzato" })).toBeInTheDocument();
  });

  it("offers explicit orphan recovery when the renderer profile is already absent", async () => {
    const user = userEvent.setup();
    const onRecoverLocalPlayground = vi.fn(async () => undefined);
    render(
      <LoginScreen
        loadBrowsers={noBrowsers}
        configured
        readLocal={() => null}
        onRecoverLocalPlayground={onRecoverLocalPlayground}
      />,
    );

    expect(screen.queryByRole("button", { name: "Reimposta identità locale di test" }))
      .not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Recupera reset locale di test" }));
    expect(onRecoverLocalPlayground).toHaveBeenCalledOnce();
    expect(screen.getByRole("textbox", { name: "Nome visualizzato" })).toBeInTheDocument();
  });

  it("starts the Google sign-in and waits for the browser, with a way out", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const signIn = vi.fn((_options: SignInOptions) => pending.promise);
    const cancel = vi.fn(async () => pending.reject(new LoginError("cancelled")));
    render(<LoginScreen signIn={signIn} cancel={cancel} loadBrowsers={noBrowsers} configured />);

    await user.click(screen.getByRole("button", { name: /Continua con Google/ }));
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(signIn.mock.calls[0][0].browser).toBe("default");
    expect(screen.getByRole("status")).toHaveTextContent("Completa l'accesso nel browser");

    await user.click(screen.getByRole("button", { name: "Annulla" }));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(ERROR_CATALOG.cancelled.text.it)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continua con Google/ })).toBeEnabled();
  });

  it("uses an explicitly chosen restored Google session without opening OAuth again", async () => {
    const user = userEvent.setup();
    const signIn = vi.fn(async () => undefined);
    const onChooseGoogle = vi.fn(async () => true);
    render(
      <LoginScreen
        signIn={signIn}
        onChooseGoogle={onChooseGoogle}
        loadBrowsers={noBrowsers}
        configured
      />,
    );

    await user.click(screen.getByRole("button", { name: /Continua con Google/ }));

    expect(onChooseGoogle).toHaveBeenCalledOnce();
    expect(signIn).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("lists the detected browsers and remembers the last choice", async () => {
    const user = userEvent.setup();
    const signIn = vi.fn(async (_options: SignInOptions) => undefined);
    const loadBrowsers = async () => [CANARY];
    const first = render(<LoginScreen signIn={signIn} loadBrowsers={loadBrowsers} configured />);

    const select = screen.getByRole("combobox", { name: "Apri con" });
    await screen.findByRole("option", { name: "Google Chrome Canary" });
    await user.selectOptions(select, "chrome-canary");
    await user.click(screen.getByRole("button", { name: /Continua con Google/ }));
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
    await user.click(screen.getByRole("button", { name: /Continua con Google/ }));
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

    await user.click(screen.getByRole("button", { name: /Continua con Google/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(`${ERROR_CATALOG.denied.text.it} (User denied) ${ERROR_CATALOG.denied.action.it}`);

    await user.click(screen.getByRole("button", { name: /Continua con Google/ }));
    expect(signIn).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says a keychain refusal needs a restart and does not offer another attempt", async () => {
    const user = userEvent.setup();
    const signIn = vi.fn().mockRejectedValue(new LoginError("keychain-failed"));
    render(<LoginScreen signIn={signIn} loadBrowsers={noBrowsers} configured />);
    await user.click(screen.getByRole("button", { name: /Continua con Google/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Chiudi completamente Job Hunter Team");
    expect(screen.getByRole("button", { name: "Riavvia per riprovare" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Apri con" })).toBeDisabled();
    expect(screen.getByRole("alert")).not.toHaveTextContent(/Consenti sempre|Riprova/);
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("disables Google but keeps local setup usable when the build has no Supabase project", async () => {
    const user = userEvent.setup();
    render(<LoginScreen configured={false} loadBrowsers={noBrowsers} />);
    expect(screen.getByRole("button", { name: /Continua con Google/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Usa in locale" })).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent(ERROR_CATALOG.auth_not_configured.text.it);
    expect(screen.getByRole("alert")).toHaveTextContent(ERROR_CATALOG.auth_not_configured.action.it);
    await user.click(screen.getByRole("button", { name: "Usa in locale" }));
    expect(screen.getByRole("textbox", { name: "Nome visualizzato" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("LoginScreen with several local profiles", () => {
  const ada = { profileId: "profile-a", displayName: "Ada" };
  const bea = { profileId: "profile-b", displayName: "Bea" };

  it("lists the saved profiles, says which one has the team and which was used last, and chooses by id", async () => {
    const user = userEvent.setup();
    const selectLocal = vi.fn((_id: string) => bea);
    const onLocalReady = vi.fn();
    render(
      <LoginScreen
        loadBrowsers={noBrowsers}
        configured
        listLocal={() => [ada, bea]}
        readLocal={() => bea}
        ownerLocal={() => ada}
        selectLocal={selectLocal}
        onLocalReady={onLocalReady}
      />,
    );

    const list = screen.getByRole("list", { name: "Profili locali salvati" });
    expect(screen.getByRole("heading", { name: "Profili su questo Mac" })).toBeInTheDocument();
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByTestId("login-profile-owner")).toHaveTextContent("Squadra di questo Mac");
    expect(within(rows[0]).queryByTestId("login-profile-last")).toBeNull();
    expect(within(rows[1]).getByTestId("login-profile-last")).toHaveTextContent("Ultimo usato");
    expect(within(rows[1]).queryByTestId("login-profile-owner")).toBeNull();

    // a profile that does not own the team is chosen all the same: it enters, and the app says whose the team is
    await user.click(screen.getByRole("button", { name: "Continua come Bea" }));
    expect(selectLocal).toHaveBeenCalledWith("profile-b");
    expect(onLocalReady).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("adds a profile with «Nuovo profilo locale» and does not choose or replace the saved ones", async () => {
    const user = userEvent.setup();
    const createLocal = vi.fn(async (displayName: string) => ({ profileId: "profile-c", displayName }));
    const selectLocal = vi.fn((_id: string) => ada);
    const onLocalReady = vi.fn();
    render(
      <LoginScreen
        loadBrowsers={noBrowsers}
        configured
        listLocal={() => [ada, bea]}
        readLocal={() => bea}
        ownerLocal={() => ada}
        createLocal={createLocal}
        selectLocal={selectLocal}
        onLocalReady={onLocalReady}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Nuovo profilo locale" }));
    expect(screen.getByText("Si aggiunge agli altri: non li sostituisce.")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Nome visualizzato" }), "Carla");
    await user.click(screen.getByRole("button", { name: "Continua in locale" }));

    expect(createLocal).toHaveBeenCalledWith("Carla");
    expect(selectLocal).not.toHaveBeenCalled();
    expect(onLocalReady).toHaveBeenCalledOnce();
  });

  it("has no list and offers «Usa in locale» when nothing is saved", () => {
    render(<LoginScreen loadBrowsers={noBrowsers} configured listLocal={() => []} readLocal={() => null} ownerLocal={() => null} />);
    expect(screen.queryByRole("list", { name: "Profili locali salvati" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Nuovo profilo locale" })).toBeNull();
    expect(screen.getByRole("button", { name: "Usa in locale" })).toBeInTheDocument();
  });

  it("says a profile that could not be chosen, and stays on the list", async () => {
    const user = userEvent.setup();
    render(
      <LoginScreen
        loadBrowsers={noBrowsers}
        configured
        listLocal={() => [ada]}
        readLocal={() => ada}
        ownerLocal={() => ada}
        selectLocal={() => { throw new Error("local-profile-missing"); }}
        onLocalReady={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Continua come Ada" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Non riesco ad attivare il profilo locale");
    expect(screen.getByRole("button", { name: "Continua come Ada" })).toBeEnabled();
  });
});
