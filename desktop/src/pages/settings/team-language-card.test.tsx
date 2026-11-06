import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEAM_LANGUAGE_TEXT } from "../../components/TeamLanguagePrompt.i18n";
import { describeError } from "../../lib/error-catalog";
import TeamLanguageCard from "./TeamLanguageCard";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);

/** The native side as a team that speaks `locale` and takes what is chosen, unless `set` says otherwise. */
function team(locale: string, set: (requested: string) => unknown = (requested) => ({ locale: requested, stored: requested, changed: true })) {
  native.invoke.mockImplementation(async (command: string, args?: { locale?: string }) => {
    if (command === "direct_chat_team_language") return { locale, stored: locale };
    if (command === "direct_chat_team_language_set") return set(args?.locale ?? "");
    throw new Error(`unexpected ${command}`);
  });
}
const sets = () => native.invoke.mock.calls.filter(([command]) => command === "direct_chat_team_language_set");
const t = TEAM_LANGUAGE_TEXT.it;

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=it; path=/";
  native.invoke.mockReset();
  native.isTauri.mockReturnValue(true);
});
afterEach(cleanup);

describe("Settings › Team: the team's language", () => {
  it("shows the language the team speaks, and Save stays off until another one is picked", async () => {
    team("en");
    render(<TeamLanguageCard />);
    expect(await screen.findByRole("heading", { name: t.cardTitle })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: t.selectLabel })).toHaveValue("en");
    expect(screen.getByTestId("settings-team-language-save")).toBeDisabled();
    expect(sets()).toEqual([]);
  });

  it("writes the person's choice over any language the team had, and says it is done", async () => {
    team("de");
    render(<TeamLanguageCard />);
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: t.selectLabel }), "it");
    fireEvent.click(screen.getByTestId("settings-team-language-save"));
    expect(await screen.findByText(t.cardSaved)).toBeInTheDocument();
    expect(sets()).toEqual([["direct_chat_team_language_set", { locale: "it", choose: true }]]);
    expect(screen.getByRole("combobox", { name: t.selectLabel })).toHaveValue("it");
    expect(screen.getByTestId("settings-team-language-save")).toBeDisabled();
    // only the language file: nothing of the setup is asked
    expect(native.invoke.mock.calls.map(([command]) => command).filter((command) => command.startsWith("onboarding_"))).toEqual([]);
  });

  it("a refusal is told with the catalog's sentence and keeps the choice to try again", async () => {
    team("en", () => { throw { code: "read_only_link" }; });
    render(<TeamLanguageCard />);
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: t.selectLabel }), "fr");
    fireEvent.click(screen.getByTestId("settings-team-language-save"));
    const copy = describeError("read_only_link", { locale: "it" });
    expect(await screen.findByTestId("settings-team-language-failure")).toHaveTextContent(copy.text);
    expect(screen.getByRole("combobox", { name: t.selectLabel })).toHaveValue("fr");
    expect(screen.getByTestId("settings-team-language-save")).toBeEnabled();
    expect(screen.queryByText(t.cardSaved)).toBeNull();
  });

  it("a team that cannot be reached shows nothing, after a few looks", async () => {
    native.invoke.mockRejectedValue({ code: "disconnected" });
    const { container } = render(<TeamLanguageCard retryMs={1} />);
    await waitFor(() => expect(native.invoke).toHaveBeenCalledTimes(5));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(native.invoke).toHaveBeenCalledTimes(5);
    expect(container).toBeEmptyDOMElement();
  });

  it("outside the desktop it shows nothing and calls nothing", async () => {
    native.isTauri.mockReturnValue(false);
    const { container } = render(<TeamLanguageCard retryMs={1} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(native.invoke).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it.each(["it", "en", "de", "fr", "es", "pt", "hu"] as const)("speaks the app's language: %s", async (locale) => {
    document.cookie = `NEXT_LOCALE=${locale}; path=/`;
    team("en");
    render(<TeamLanguageCard />);
    const text = TEAM_LANGUAGE_TEXT[locale];
    expect(await screen.findByRole("heading", { name: text.cardTitle })).toBeInTheDocument();
    expect(screen.getByText(text.cardText)).toBeInTheDocument();
    expect(screen.getByTestId("settings-team-language-save")).toHaveTextContent(text.cardSave);
  });
});
