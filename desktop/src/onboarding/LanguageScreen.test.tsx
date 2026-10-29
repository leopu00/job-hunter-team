import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localeLabels, locales } from "@/i18n/config";
import { explicitLocale, languagePickedAtStart } from "../lib/app-locale";
import { LanguageScreen } from "./LanguageScreen";
import { LANGUAGE_SCREEN_TEXT } from "./language-screen.i18n";

function systemLanguages(languages: string[]) {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(languages);
}

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
  localStorage.clear();
  systemLanguages(["it-IT"]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
  localStorage.clear();
});

describe("the language, the first screen of the app", () => {
  it("lists the seven languages by their own names and highlights the system's", () => {
    render(<LanguageScreen onChosen={vi.fn()} />);
    const options = screen.getAllByRole("radio");
    expect(options).toHaveLength(7);
    expect(options.map((option) => option.getAttribute("data-locale"))).toEqual(locales);
    for (const locale of locales) expect(screen.getByRole("radio", { name: new RegExp(localeLabels[locale].label) })).toBeInTheDocument();
    expect(screen.getByRole("radio", { checked: true })).toHaveAttribute("data-locale", "it");
    expect(screen.getByRole("radio", { name: "Italiano, selezionata" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Lingue disponibili" })).toBeInTheDocument();
  });

  it("starts in English when the system's language is not one of the seven", () => {
    systemLanguages(["ja-JP"]);
    render(<LanguageScreen onChosen={vi.fn()} />);
    expect(screen.getByRole("radio", { checked: true })).toHaveAttribute("data-locale", "en");
    expect(screen.getByTestId("language-continue")).toHaveTextContent("Continue in English");
  });

  it("answers the choice as it is made: every word is in the highlighted language, the button has its own name", async () => {
    render(<LanguageScreen onChosen={vi.fn()} />);
    for (const locale of locales) {
      fireEvent.click(screen.getByRole("radio", { name: new RegExp(localeLabels[locale].label) }));
      const text = LANGUAGE_SCREEN_TEXT[locale];
      expect(screen.getByRole("heading", { name: text.title })).toBeInTheDocument();
      expect(screen.getByText(text.subtitle)).toBeInTheDocument();
      expect(screen.getByText(text.eyebrow)).toBeInTheDocument();
      expect(screen.getByText(text.keyboardHint)).toBeInTheDocument();
      expect(screen.getByRole("radiogroup", { name: text.listAria })).toBeInTheDocument();
      expect(screen.getByTestId("language-continue")).toHaveTextContent(text.continueIn.replace("{language}", localeLabels[locale].label));
      expect(screen.getByTestId("language-screen")).toHaveAttribute("lang", locale);
    }
  });

  it("is chosen with the arrows and continued with Enter, and keeps the choice as the app's language", async () => {
    const chosen = vi.fn();
    const user = userEvent.setup();
    render(<LanguageScreen onChosen={chosen} />);
    expect(explicitLocale()).toBeNull();
    // the order of the list is en, it, hu, es, de, fr, pt: it → (ArrowDown) → hu → (End) → pt → (ArrowRight) wraps to en
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { checked: true })).toHaveAttribute("data-locale", "hu");
    await user.keyboard("{End}");
    expect(screen.getByRole("radio", { checked: true })).toHaveAttribute("data-locale", "pt");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { checked: true })).toHaveAttribute("data-locale", "en");
    // back from the first one wraps to the last, and one more up is the one before it
    await user.keyboard("{ArrowLeft}{ArrowUp}");
    expect(screen.getByRole("radio", { checked: true })).toHaveAttribute("data-locale", "fr");
    await user.keyboard("{Home}");
    expect(screen.getByRole("radio", { checked: true })).toHaveAttribute("data-locale", "en");
    // nothing is kept before the person continues
    expect(explicitLocale()).toBeNull();
    await user.keyboard("{Enter}");
    expect(chosen).toHaveBeenCalledOnce();
    expect(chosen).toHaveBeenCalledWith("en");
    expect(explicitLocale()).toBe("en");
    expect(document.cookie).toContain("NEXT_LOCALE=en");
    expect(localStorage.getItem("jht-lang")).toBe("en");
    expect(languagePickedAtStart()).toBe(true);
  });

  it("continues with the button too, on the language that was clicked", async () => {
    const chosen = vi.fn();
    const user = userEvent.setup();
    render(<LanguageScreen onChosen={chosen} />);
    await user.click(screen.getByRole("radio", { name: /Deutsch/ }));
    await user.click(screen.getByTestId("language-continue"));
    expect(chosen).toHaveBeenCalledWith("de");
    expect(explicitLocale()).toBe("de");
  });

  it("says when the choice cannot be kept, and goes on at the next press: the app works in that language for this start", async () => {
    const chosen = vi.fn();
    const user = userEvent.setup();
    // no cookie and no storage: nothing can be read back
    vi.spyOn(document, "cookie", "set").mockImplementation(() => undefined);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    render(<LanguageScreen onChosen={chosen} />);
    await user.click(screen.getByTestId("language-continue"));
    expect(chosen).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(LANGUAGE_SCREEN_TEXT.it.notKept);
    await user.click(screen.getByTestId("language-continue"));
    expect(chosen).toHaveBeenCalledWith("it");
  });

  it("has every text in the seven languages and none left as a placeholder", () => {
    for (const locale of locales) {
      const text = LANGUAGE_SCREEN_TEXT[locale];
      for (const [key, value] of Object.entries(text)) expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(2);
      expect(text.continueIn, locale).toContain("{language}");
    }
    // the screen is not the same sentence in two languages
    expect(new Set(locales.map((locale) => LANGUAGE_SCREEN_TEXT[locale].title)).size).toBe(7);
  });
});
