import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DashboardI18nProvider } from "@/app/components/DashboardI18n";
import { locales } from "@/i18n/config";
import { EXISTING_TEAM_READONLY_TEXT } from "../../lib/existing-team-readonly.i18n";
import { desktopLinks } from "../../shell/desktop-links";
import { SHELL_TEXT } from "../../shell/shell.i18n";
import { SETTINGS_TEXT } from "../settings/settings.i18n";
import { HELP_TEXT } from "./help.i18n";
import HelpPage from "./index";

const props = { params: {}, search: new URLSearchParams() };
afterEach(() => localStorage.removeItem("jht-lang"));

describe("the help page", () => {
  it("lists the pages of the read-only view, by the names the navigation gives them", async () => {
    localStorage.setItem("jht-lang", "en");
    render(
      <DashboardI18nProvider>
        <HelpPage {...props} />
      </DashboardI18nProvider>,
    );
    expect(screen.getByRole("heading", { name: "Help" })).toBeInTheDocument();
    const pages = within(screen.getByRole("region", { name: "The pages" }));
    for (const name of ["Dashboard", "Map", "Positions", "Team", "Profile", "Office", "Agents", "Settings"]) {
      expect(pages.getByText(name, { selector: "dt" })).toBeInTheDocument();
    }
  });

  it("links the privacy notice and the terms, as the website does", () => {
    localStorage.setItem("jht-lang", "en");
    render(
      <DashboardI18nProvider>
        <HelpPage {...props} />
      </DashboardI18nProvider>,
    );
    expect(screen.getByRole("button", { name: "Privacy notice" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Terms of service" })).toBeInTheDocument();
  });

  it("names the two navbar buttons its trouble paragraph points at, as the navbar does", () => {
    localStorage.setItem("jht-lang", "en");
    render(
      <DashboardI18nProvider>
        <HelpPage {...props} />
      </DashboardI18nProvider>,
    );
    expect(screen.getByText(/press “Refresh”\. “Back to setup” takes you back/)).toBeInTheDocument();
  });

  it("promises nothing the app does not have: no sentence about writing, applying, sending or notifying", () => {
    for (const locale of locales) {
      const text = JSON.stringify(HELP_TEXT[locale]).toLowerCase();
      for (const word of ["cv", "cover letter", "lettera", "candidatur", "notific", "e-mail", "swipe", "chat"]) {
        expect(text, `${locale}: ${word}`).not.toContain(word);
      }
    }
  });

  it.each(locales)("%s: its two navigation labels are the ones the bars use", (locale) => {
    const links = Object.fromEntries(desktopLinks(locale).map((link) => [link.href, link.label]));
    expect(links["/help"]).toBe(HELP_TEXT[locale].navLabel);
    expect(links["/help"]).toBe(EXISTING_TEAM_READONLY_TEXT[locale].help);
    expect(links["/settings"]).toBe(SETTINGS_TEXT[locale].navLabel);
    expect(links["/settings"]).toBe(EXISTING_TEAM_READONLY_TEXT[locale].settings);
  });

  it.each(locales)("%s: the button names it quotes exist in the shell's and the read-only view's texts", (locale) => {
    expect(SHELL_TEXT[locale].refresh.length).toBeGreaterThan(0);
    expect(EXISTING_TEAM_READONLY_TEXT[locale].back.length).toBeGreaterThan(0);
    expect(HELP_TEXT[locale].trouble).toContain("{refresh}");
    expect(HELP_TEXT[locale].trouble).toContain("{back}");
  });

  const THIS_COMPUTER: Record<string, RegExp> = {
    it: /questo computer/, en: /this computer/, de: /diesem Computer/, fr: /cet ordinateur/, es: /este ordenador/, pt: /neste computador/, hu: /ezen a számítógépen/,
  };

  it.each(locales)("%s: it is for a team on this computer as well as on a VPS, and does not tie a page to the VPS", (locale) => {
    const t = HELP_TEXT[locale];
    expect(t.intro).toMatch(THIS_COMPUTER[locale]);
    expect(t.intro).toContain("VPS");
    for (const page of ["team", "profile", "office"] as const) expect(t.pages[page], `${locale}: ${page}`).not.toContain("VPS");
  });
});
