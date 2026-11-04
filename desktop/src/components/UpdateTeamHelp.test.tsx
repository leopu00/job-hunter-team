import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { locales } from "@/i18n/config";
import { ERROR_CATALOG } from "../lib/error-catalog";
import { TEAM_UPDATE_COMMAND } from "../lib/team-update";
import UpdateTeamHelp from "./UpdateTeamHelp";
import { UPDATE_TEAM_TEXT } from "./UpdateTeamHelp.i18n";

const setLang = (lang: string) => {
  localStorage.setItem("jht-lang", lang);
  document.cookie = `NEXT_LOCALE=${lang}; path=/`;
};
const clipboard = (writeText: (value: string) => Promise<void>) =>
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

beforeEach(() => setLang("en"));
afterEach(() => {
  cleanup();
  localStorage.removeItem("jht-lang");
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
});

describe("the guide that shows how to update the team", () => {
  it("is there under every message that asks to update the team, and under no other", () => {
    for (const [code, copy] of Object.entries(ERROR_CATALOG)) {
      const view = render(<UpdateTeamHelp code={code} />);
      const asks = /^Update the team\b/i.test(copy.action.en);
      expect(screen.queryByTestId("update-team-button") !== null, code).toBe(asks);
      view.unmount();
    }
    const none = render(<UpdateTeamHelp code={null} />);
    expect(none.container).toBeEmptyDOMElement();
  });

  it("opens with the program to open, the command and what to do after, and closes again", () => {
    render(<UpdateTeamHelp code="budget_unavailable" />);
    expect(screen.getByRole("button", { name: "Update the team" })).toBeInTheDocument();
    expect(screen.queryByTestId("update-team-guide")).toBeNull();
    fireEvent.click(screen.getByTestId("update-team-button"));
    const guide = screen.getByTestId("update-team-guide");
    expect(guide).toHaveTextContent("Open the Terminal (on Windows: PowerShell).");
    expect(guide).toHaveTextContent("Paste this command and press Enter:");
    expect(screen.getByTestId("update-team-command")).toHaveTextContent(TEAM_UPDATE_COMMAND);
    expect(guide).toHaveTextContent("come back here and try again");
    expect(guide).toHaveTextContent("If the team runs on a server");
    fireEvent.click(screen.getByTestId("update-team-close"));
    expect(screen.queryByTestId("update-team-guide")).toBeNull();
    expect(screen.getByTestId("update-team-button")).toBeInTheDocument();
  });

  it("copies exactly the command and says so", async () => {
    const writeText = vi.fn(async (_value: string) => undefined);
    clipboard(writeText);
    render(<UpdateTeamHelp code="budget_unavailable" />);
    fireEvent.click(screen.getByTestId("update-team-button"));
    fireEvent.click(screen.getByRole("button", { name: "Copy the command" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Command copied."));
    expect(writeText).toHaveBeenCalledExactlyOnceWith("jht upgrade");
  });

  it("says the copy did not work, and leaves the command to select, when the computer refuses", async () => {
    clipboard(async () => {
      throw new Error("denied");
    });
    render(<UpdateTeamHelp code="budget_unavailable" />);
    fireEvent.click(screen.getByTestId("update-team-button"));
    fireEvent.click(screen.getByTestId("update-team-copy"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Copying did not work"));
    expect(screen.getByTestId("update-team-command")).toHaveTextContent("jht upgrade");
  });

  it("is written in the 7 languages, with the same lines in each, and says Terminal in plain words", () => {
    const keys = Object.keys(UPDATE_TEAM_TEXT.it).sort();
    expect(Object.keys(UPDATE_TEAM_TEXT).sort()).toEqual([...locales].sort());
    for (const locale of locales) {
      const text = UPDATE_TEAM_TEXT[locale];
      expect(Object.keys(text).sort(), locale).toEqual(keys);
      for (const [key, value] of Object.entries(text)) {
        expect(value.trim(), `${locale}.${key}`).not.toBe("");
        // Nothing the person has to look up: no image, runtime, container, host or daemon.
        expect(value, `${locale}.${key}`).not.toMatch(/runtime|immagine|image|docker|podman|container|\bhost\b|daemon|wrapper/i);
      }
      expect(text.step1, locale).toMatch(/Termin[aá]l/);
      expect(text.step1, locale).toMatch(/PowerShell/);
      if (locale !== "en") expect(text.button, locale).not.toBe(UPDATE_TEAM_TEXT.en.button);
    }
  });

  it.each([...locales])("%s: the button and the guide come in the language of the app", (locale) => {
    setLang(locale);
    render(<UpdateTeamHelp code="budget_unavailable" />);
    expect(screen.getByTestId("update-team-button")).toHaveTextContent(UPDATE_TEAM_TEXT[locale].button);
    fireEvent.click(screen.getByTestId("update-team-button"));
    expect(screen.getByTestId("update-team-guide")).toHaveTextContent(UPDATE_TEAM_TEXT[locale].title);
    expect(screen.getByTestId("update-team-copy")).toHaveTextContent(UPDATE_TEAM_TEXT[locale].copy);
  });
});
