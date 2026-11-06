import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeamLanguagePrompt from "./TeamLanguagePrompt";
import { TEAM_LANGUAGE_TEXT } from "./TeamLanguagePrompt.i18n";
import { describeError } from "../lib/error-catalog";
import { teamLanguageAsked } from "../lib/team-language";
import { fill } from "../lib/text-slots";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);

/** The native side as a team that speaks `locale` (the file says `stored`) and takes what is set. */
function team(locale: string, stored: string | null = null, set: (requested: string) => unknown = (requested) => ({ locale: requested, stored: requested, changed: true })) {
  native.invoke.mockImplementation(async (command: string, args?: { locale?: string }) => {
    if (command === "direct_chat_team_language") return { locale, stored };
    if (command === "direct_chat_team_language_set") return set(args?.locale ?? "");
    throw new Error(`unexpected ${command}`);
  });
}
const sets = () => native.invoke.mock.calls.filter(([command]) => command === "direct_chat_team_language_set");

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=it; path=/";
  localStorage.clear();
  sessionStorage.clear();
  native.invoke.mockReset();
  native.isTauri.mockReturnValue(true);
});
afterEach(cleanup);

describe("TeamLanguagePrompt", () => {
  it("asks «Lingua della squadra: Italiano?» of a team still in English, with the app's language preselected, and writes nothing until the answer", async () => {
    team("en", "en");
    render(<TeamLanguagePrompt identityKey="a" />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Lingua della squadra: Italiano?");
    expect(screen.getByLabelText(TEAM_LANGUAGE_TEXT.it.selectLabel)).toHaveValue("it");
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual(["direct_chat_team_language"]);
    expect(teamLanguageAsked("a", "it")).toBe(false);
  });

  it("follows the language said on the app's first screen without asking, and remembers it for the account", async () => {
    localStorage.setItem("jht-lang-picked", "1");
    team("en", "en");
    render(<TeamLanguagePrompt identityKey="a" />);
    await waitFor(() => expect(teamLanguageAsked("a", "it")).toBe(true));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sets()).toEqual([["direct_chat_team_language_set", { locale: "it" }]]);
  });

  it("asks as before when the team refuses what the first screen said", async () => {
    localStorage.setItem("jht-lang-picked", "1");
    team("en", "en", () => { throw { code: "read_only_link" }; });
    render(<TeamLanguagePrompt identityKey="a" />);
    expect(await screen.findByRole("dialog")).toHaveTextContent("Lingua della squadra: Italiano?");
    expect(teamLanguageAsked("a", "it")).toBe(false);
  });

  it("does not touch a team that already speaks the app's language, even after the first screen", async () => {
    localStorage.setItem("jht-lang-picked", "1");
    team("it", "it");
    render(<TeamLanguagePrompt identityKey="a" />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sets()).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("writes the language with the one set, as the person's own choice, closes, and is never asked again for that account and language", async () => {
    team("en", null);
    const { unmount } = render(<TeamLanguagePrompt identityKey="a" />);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByTestId("team-language-confirm"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sets()).toEqual([["direct_chat_team_language_set", { locale: "it", choose: true }]]);
    expect(teamLanguageAsked("a", "it")).toBe(true);
    unmount();
    native.invoke.mockClear();
    render(<TeamLanguagePrompt identityKey="a" />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(native.invoke).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("takes another language from the list when the person wants the team in one the app is not in", async () => {
    team("en", "en");
    render(<TeamLanguagePrompt identityKey="a" />);
    await screen.findByRole("dialog");
    await userEvent.selectOptions(screen.getByLabelText(TEAM_LANGUAGE_TEXT.it.selectLabel), "de");
    expect(screen.getByRole("dialog")).toHaveTextContent("Lingua della squadra: Deutsch?");
    fireEvent.click(screen.getByTestId("team-language-confirm"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sets()).toEqual([["direct_chat_team_language_set", { locale: "de", choose: true }]]);
  });

  it("«Lascia l'inglese» writes nothing and is remembered", async () => {
    team("en", "en");
    render(<TeamLanguagePrompt identityKey="a" />);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByTestId("team-language-keep"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sets()).toEqual([]);
    expect(teamLanguageAsked("a", "it")).toBe(true);
  });

  it.each([
    ["chosen in its file", "it"],
    ["given by its environment", null],
  ])("asks nothing of a team that already speaks the app's language, %s", async (_name, stored) => {
    team("it", stored);
    render(<TeamLanguagePrompt identityKey="a" />);
    await waitFor(() => expect(native.invoke).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sets()).toEqual([]);
  });

  it.each([
    ["a team that has another language chosen", "de", "de", "Deutsch"],
    ["a team whose language comes from its environment", "hu", null, "Magyar"],
  ])("asks of %s, saying which one it speaks, and «keep» leaves it", async (_name, locale, stored, label) => {
    team(locale, stored);
    render(<TeamLanguagePrompt identityKey="a" />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Lingua della squadra: Italiano?");
    expect(dialog).toHaveTextContent(fill(TEAM_LANGUAGE_TEXT.it.bodyOther, { language: label }));
    expect(screen.getByTestId("team-language-keep")).toHaveTextContent(fill(TEAM_LANGUAGE_TEXT.it.keepCurrent, { language: label }));
    fireEvent.click(screen.getByTestId("team-language-keep"));
    expect(sets()).toEqual([]);
    expect(teamLanguageAsked("a", "it")).toBe(true);
  });

  it("the first screen's language is followed by itself only over the English: a team with another language is asked", async () => {
    localStorage.setItem("jht-lang-picked", "1");
    team("de", "de");
    render(<TeamLanguagePrompt identityKey="a" />);
    expect(await screen.findByRole("dialog")).toHaveTextContent("Lingua della squadra: Italiano?");
    expect(sets()).toEqual([]);
    fireEvent.click(screen.getByTestId("team-language-confirm"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sets()).toEqual([["direct_chat_team_language_set", { locale: "it", choose: true }]]);
  });

  it("a language of the app changed in Settings asks once more, once: the answer for the language before does not count", async () => {
    team("it", "it");
    localStorage.setItem("jht-team-language-asked:a", "it");
    // the person picks German in Settings: the page reloads in German, the team still speaks Italian
    document.cookie = "NEXT_LOCALE=de; path=/";
    const first = render(<TeamLanguagePrompt identityKey="a" />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Sprache des Teams: Deutsch?");
    expect(dialog).toHaveTextContent(fill(TEAM_LANGUAGE_TEXT.de.bodyOther, { language: "Italiano" }));
    fireEvent.click(screen.getByTestId("team-language-keep"));
    expect(teamLanguageAsked("a", "de")).toBe(true);
    first.unmount();
    // the reload after it, and the next start: no question
    native.invoke.mockClear();
    render(<TeamLanguagePrompt identityKey="a" />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(native.invoke).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the answer of the older app (asked once, no language) asks again once for the app's language", async () => {
    localStorage.setItem("jht-team-language-asked:a", "1");
    team("en", "en");
    render(<TeamLanguagePrompt identityKey="a" />);
    expect(await screen.findByRole("dialog")).toHaveTextContent("Lingua della squadra: Italiano?");
  });

  it("asks nothing when the app itself is in English: there is no other language to offer", async () => {
    document.cookie = "NEXT_LOCALE=en; path=/";
    team("en", "en");
    render(<TeamLanguagePrompt identityKey="a" />);
    await waitFor(() => expect(native.invoke).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a team that has just been given a language by someone else answers changed:false, and the dialog closes without a word", async () => {
    team("en", "en", () => ({ locale: "fr", stored: "fr", changed: false }));
    render(<TeamLanguagePrompt identityKey="a" />);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByTestId("team-language-confirm"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByTestId("team-language-failure")).toBeNull();
    expect(teamLanguageAsked("a", "it")).toBe(true);
  });

  it("a refused write is told with the catalog's sentence, keeps the dialog and is not remembered", async () => {
    team("en", "en", () => { throw { code: "read_only_link" }; });
    render(<TeamLanguagePrompt identityKey="a" />);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByTestId("team-language-confirm"));
    const copy = describeError("read_only_link", { locale: "it" });
    expect(await screen.findByTestId("team-language-failure")).toHaveTextContent(copy.text);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("team-language-confirm")).toBeEnabled();
    expect(teamLanguageAsked("a", "it")).toBe(false);
  });

  it("a reply that is not one of the seven languages is a failure, not a success", async () => {
    team("en", "en", () => ({ locale: "xx", stored: "xx", changed: true }));
    render(<TeamLanguagePrompt identityKey="a" />);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByTestId("team-language-confirm"));
    expect(await screen.findByTestId("team-language-failure")).toBeInTheDocument();
    expect(teamLanguageAsked("a", "it")).toBe(false);
  });

  it("looks again while the team does not answer yet (the chat's link still opening), and gives up after forty tries", async () => {
    let answers = false;
    native.invoke.mockImplementation(async () => {
      if (!answers) throw { code: "disconnected" };
      return { locale: "en", stored: "en" };
    });
    // the eight tries span 8 x 40 ms; waitFor looks every 50 ms, so the answer starts while there are tries left
    render(<TeamLanguagePrompt identityKey="a" retryMs={40} />);
    await waitFor(() => expect(native.invoke.mock.calls.length).toBeGreaterThanOrEqual(2));
    answers = true;
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    cleanup();
    native.invoke.mockReset();
    native.invoke.mockRejectedValue({ code: "disconnected" });
    render(<TeamLanguagePrompt identityKey="b" retryMs={1} />);
    await waitFor(() => expect(native.invoke).toHaveBeenCalledTimes(40));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(native.invoke).toHaveBeenCalledTimes(40);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stops looking when the page goes away", async () => {
    native.invoke.mockRejectedValue({ code: "disconnected" });
    const { unmount } = render(<TeamLanguagePrompt identityKey="a" retryMs={5} />);
    await waitFor(() => expect(native.invoke).toHaveBeenCalled());
    unmount();
    const calls = native.invoke.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(native.invoke.mock.calls.length).toBeLessThanOrEqual(calls + 1);
  });

  it("Escape puts the question off without writing and without remembering it: not at the reloads of this run, again at the next start", async () => {
    team("en", "en");
    const { unmount } = render(<TeamLanguagePrompt identityKey="a" />);
    const select = await screen.findByLabelText(TEAM_LANGUAGE_TEXT.it.selectLabel);
    // the focus is given by an effect that runs after the question is drawn: wait for it, do not race it
    await waitFor(() => expect(select).toHaveFocus());
    fireEvent.keyDown(select, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sets()).toEqual([]);
    expect(localStorage.getItem("jht-team-language-asked:a")).toBeNull();
    unmount();
    // a reload of the same run (a language picked, «back to home»): not asked again
    const reloaded = render(<TeamLanguagePrompt identityKey="a" />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("dialog")).toBeNull();
    reloaded.unmount();
    // the next start of the app
    sessionStorage.clear();
    render(<TeamLanguagePrompt identityKey="a" />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("Escape does nothing while the language is being written", async () => {
    let finish: (reply: unknown) => void = () => {};
    team("en", "en", () => new Promise((resolve) => { finish = resolve; }));
    render(<TeamLanguagePrompt identityKey="a" />);
    const select = await screen.findByLabelText(TEAM_LANGUAGE_TEXT.it.selectLabel);
    fireEvent.click(screen.getByTestId("team-language-confirm"));
    await waitFor(() => expect(screen.getByTestId("team-language-confirm")).toBeDisabled());
    fireEvent.keyDown(select, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    finish({ locale: "it", stored: "it", changed: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Tab and Shift+Tab go round the three controls and never out of the dialog", async () => {
    team("en", "en");
    render(<TeamLanguagePrompt identityKey="a" />);
    const select = await screen.findByLabelText(TEAM_LANGUAGE_TEXT.it.selectLabel);
    const keep = screen.getByTestId("team-language-keep");
    const confirm = screen.getByTestId("team-language-confirm");
    // the opening focus lands after the question is drawn: let it land before moving the focus by hand
    await waitFor(() => expect(select).toHaveFocus());
    confirm.focus();
    expect(fireEvent.keyDown(confirm, { key: "Tab" })).toBe(false);
    expect(select).toHaveFocus();
    expect(fireEvent.keyDown(select, { key: "Tab", shiftKey: true })).toBe(false);
    expect(confirm).toHaveFocus();
    // inside the ring the browser's own order is left alone
    keep.focus();
    expect(fireEvent.keyDown(keep, { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(keep, { key: "Tab", shiftKey: true })).toBe(true);
  });

  it("outside the desktop it asks nothing and calls nothing", async () => {
    native.isTauri.mockReturnValue(false);
    render(<TeamLanguagePrompt identityKey="a" retryMs={1} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(native.invoke).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each(["it", "en", "de", "fr", "es", "pt", "hu"] as const)("speaks the app's language: %s", async (locale) => {
    document.cookie = `NEXT_LOCALE=${locale}; path=/`;
    team("en", "en");
    render(<TeamLanguagePrompt identityKey={`l-${locale}`} />);
    if (locale === "en") {
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(screen.queryByRole("dialog")).toBeNull();
      return;
    }
    const dialog = await screen.findByRole("dialog");
    const text = TEAM_LANGUAGE_TEXT[locale];
    expect(dialog).toHaveTextContent(text.body);
    expect(screen.getByLabelText(text.selectLabel)).toHaveValue(locale);
    expect(screen.getByTestId("team-language-keep")).toHaveTextContent(text.keepEnglish);
    expect(screen.getByTestId("team-language-confirm")).toHaveTextContent(text.confirm);
    expect(dialog.querySelector("h2")?.textContent).toBe(fill(text.title, { language: screen.getByRole("option", { selected: true }).textContent ?? "" }));
  });
});
