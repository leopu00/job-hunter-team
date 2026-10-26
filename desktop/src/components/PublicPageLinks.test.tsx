import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { locales } from "@/i18n/config";
import { PUBLIC_PAGE_TEXT } from "../lib/public-pages";
import PublicPageLinks from "./PublicPageLinks";

const core = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => core);

afterEach(() => {
  cleanup();
  core.invoke.mockReset();
  core.isTauri.mockReturnValue(true);
  localStorage.removeItem("jht-lang");
});

describe("privacy and terms in the app", () => {
  it("are written in the seven languages", () => {
    expect(Object.keys(PUBLIC_PAGE_TEXT).sort()).toEqual([...locales].sort());
    for (const locale of locales) {
      for (const word of Object.values(PUBLIC_PAGE_TEXT[locale])) expect(word.trim().length, locale).toBeGreaterThan(3);
    }
  });

  it.each(locales)("the two buttons ask for the page by its word, in %s", async (locale) => {
    localStorage.setItem("jht-lang", locale);
    core.invoke.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<PublicPageLinks />);
    await user.click(screen.getByRole("button", { name: PUBLIC_PAGE_TEXT[locale].privacy }));
    await user.click(screen.getByRole("button", { name: PUBLIC_PAGE_TEXT[locale].terms }));
    // The call carries a word, never an address.
    expect(core.invoke.mock.calls).toEqual([
      ["open_public_page", { page: "privacy" }],
      ["open_public_page", { page: "terms" }],
    ]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("say so when the browser did not open, and when the app is not the desktop", async () => {
    localStorage.setItem("jht-lang", "en");
    const user = userEvent.setup();
    core.invoke.mockResolvedValue({ ok: false, error: "browser_failed" });
    render(<PublicPageLinks />);
    await user.click(screen.getByRole("button", { name: "Privacy notice" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("browser could not be opened"));
    cleanup();
    core.invoke.mockReset();
    core.isTauri.mockReturnValue(false);
    render(<PublicPageLinks />);
    await user.click(screen.getByRole("button", { name: "Terms of service" }));
    expect(core.invoke).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
