import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  initializeTheme,
  readStoredTheme,
  THEME_STORAGE_KEY,
} from "./theme";

beforeEach(() => {
  localStorage.removeItem(THEME_STORAGE_KEY);
  document.documentElement.removeAttribute("data-jht-theme");
  document.documentElement.removeAttribute("data-theme");
});

describe("desktop theme persistence", () => {
  it("falls back safely when the stored value is invalid", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "ultraviolet");

    expect(readStoredTheme(localStorage)).toBe(DEFAULT_THEME);
    expect(initializeTheme()).toBe("dark");
    expect(document.documentElement).toHaveAttribute("data-jht-theme", "dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("maps the two light palettes onto the reused web light mode", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "paper");

    expect(initializeTheme()).toBe("paper");
    expect(document.documentElement).toHaveAttribute("data-jht-theme", "paper");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });
});
