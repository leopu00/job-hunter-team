import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeError } from "../lib/error-catalog";
import { STATE_TEXT } from "../lib/onboarding-state.i18n";
import { LocalMigrationPage, type LocalMigrationPageProps } from "./LocalMigrationPage";

const LOCALES = Object.keys(STATE_TEXT) as (keyof typeof STATE_TEXT)[];

function props(over: Partial<LocalMigrationPageProps> = {}): LocalMigrationPageProps {
  return {
    phase: "error",
    code: "local_migration_target_exists",
    retryable: false,
    leaving: "idle",
    onLink: vi.fn(),
    onStayLocal: vi.fn(),
    onRetry: vi.fn(),
    onLeave: vi.fn(),
    ...over,
  };
}

afterEach(() => {
  cleanup();
  document.cookie = "NEXT_LOCALE=it; path=/";
});

describe("the page between «Continue with Google» and the dashboard, when a local profile is saved", () => {
  it("is the app's own card, not bare text on the page", () => {
    render(<LocalMigrationPage {...props()} />);
    const page = screen.getByTestId("local-migration");
    expect(page).toHaveClass("existing-team-modal");
    expect(page.parentElement).toHaveClass("existing-team-modal__backdrop");
    expect(page.querySelectorAll("button.existing-team-modal__primary, button.existing-team-modal__secondary").length)
      .toBe(page.querySelectorAll("button").length);
  });

  it("says what stopped the link in the catalog's words, and shows the code", () => {
    render(<LocalMigrationPage {...props()} />);
    const said = describeError("local_migration_target_exists", { locale: "it" });
    expect(screen.getByRole("alert")).toHaveTextContent(said.text);
    expect(screen.getByRole("alert")).toHaveTextContent(said.action);
    expect(screen.getByTestId("local-migration-code")).toHaveTextContent("Codice: local_migration_target_exists");
  });

  it("does not show a code that is not a plain code", () => {
    render(<LocalMigrationPage {...props({ code: "/Users/someone/.jht: denied" })} />);
    expect(screen.queryByTestId("local-migration-code")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(describeError(undefined, { locale: "it" }).text);
  });

  it("always has a way out: stay local and back to sign in, with or without «Try again»", async () => {
    const user = userEvent.setup();
    const stay = vi.fn();
    const leave = vi.fn();
    const retry = vi.fn();
    const view = render(<LocalMigrationPage {...props({ retryable: false, onStayLocal: stay, onLeave: leave })} />);
    expect(screen.queryByRole("button", { name: "Riprova" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Annulla e resta in locale" }));
    await user.click(screen.getByRole("button", { name: "Torna ad Accedi" }));
    expect(stay).toHaveBeenCalledOnce();
    expect(leave).toHaveBeenCalledOnce();
    view.unmount();

    render(<LocalMigrationPage {...props({ retryable: true, onRetry: retry })} />);
    await user.click(screen.getByRole("button", { name: "Riprova" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Torna ad Accedi" })).toBeEnabled();
  });

  it("the question page has the way back too, and links only on the person's gesture", async () => {
    const user = userEvent.setup();
    const link = vi.fn();
    const leave = vi.fn();
    render(<LocalMigrationPage {...props({ phase: "required", code: null, onLink: link, onLeave: leave })} />);
    expect(screen.getByRole("heading", { name: "Collega il profilo locale al tuo account Google?" })).toBeInTheDocument();
    expect(link).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Torna ad Accedi" }));
    expect(leave).toHaveBeenCalledOnce();
    expect(link).not.toHaveBeenCalled();
  });

  it("holds every button while the link or the leaving is on its way", () => {
    const view = render(<LocalMigrationPage {...props({ phase: "migrating", code: null })} />);
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
    view.unmount();
    render(<LocalMigrationPage {...props({ leaving: "leaving" })} />);
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
    expect(screen.getByRole("button", { name: "Esco…" })).toBeInTheDocument();
  });

  it("tells when leaving did not work, and lets the person try again", () => {
    render(<LocalMigrationPage {...props({ leaving: "failed" })} />);
    expect(screen.getAllByRole("alert").some((node) => node.textContent?.includes(STATE_TEXT.it.leaveFailed))).toBe(true);
    expect(screen.getByRole("button", { name: "Torna ad Accedi" })).toBeEnabled();
  });

  it("does not promise that the runtime stays local when a link was left half done", () => {
    const view = render(<LocalMigrationPage {...props({ code: "local_migration_recovery_required" })} />);
    expect(screen.getByRole("alert")).not.toHaveTextContent(STATE_TEXT.it.migrationStaysLocal);
    view.unmount();
    render(<LocalMigrationPage {...props({ code: "local_migration_storage_failed", retryable: true })} />);
    expect(screen.getByRole("alert")).toHaveTextContent(STATE_TEXT.it.migrationStaysLocal);
  });

  it("is in every language, with the sentence of the catalog in that language", () => {
    const backs = new Set<string>();
    for (const locale of LOCALES) {
      document.cookie = `NEXT_LOCALE=${locale}; path=/`;
      const text = STATE_TEXT[locale];
      backs.add(text.backToSignIn);
      render(<LocalMigrationPage {...props()} />);
      expect(screen.getByRole("heading", { name: text.migrationErrorTitle })).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent(describeError("local_migration_target_exists", { locale }).text);
      expect(screen.getByRole("button", { name: text.backToSignIn })).toBeInTheDocument();
      expect(screen.getByTestId("local-migration-code")).toHaveTextContent(`${text.errorCodeLabel}: local_migration_target_exists`);
      cleanup();
    }
    expect(backs.size).toBe(LOCALES.length);
  });
});
