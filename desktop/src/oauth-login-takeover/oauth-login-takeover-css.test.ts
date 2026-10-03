// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THEMES } from "../shell/theme";

const styles = readFileSync(new URL("./oauth-login-takeover.css", import.meta.url), "utf8");
const dashboardStyles = readFileSync(new URL("../dashboard/dashboard.css", import.meta.url), "utf8");

function themeTokens(theme: string) {
  const block = dashboardStyles.match(
    new RegExp(`:root\\[data-jht-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\}`),
  )?.[1];
  expect(block, `missing palette for ${theme}`).toBeDefined();
  return new Map(
    [...block!.matchAll(/(--color-[\w-]+):\s*(#[0-9a-f]{6}|rgba?\([^;]+\))/gi)]
      .map((match) => [match[1], match[2]]),
  );
}

function relativeLuminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string) {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)]
    .sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("OAuthLoginTakeover CSS", () => {
  it("uses only the shared semantic theme palette", () => {
    expect(styles).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(|hsla?\(/i);
    expect(styles).not.toMatch(/var\(--(?:ink|muted|dim|panel|line|accent(?:-dark)?)(?:,|\))/);
    expect(styles).not.toMatch(/bbf246|8cc21d|c9ff56/i);
  });

  it.each(THEMES)("defines every used token in the $label theme", ({ value }) => {
    const palette = themeTokens(value);
    const usedTokens = new Set(
      [...styles.matchAll(/var\((--color-[\w-]+)\)/g)].map((match) => match[1]),
    );
    for (const token of usedTokens) expect(palette.has(token), `${value} lacks ${token}`).toBe(true);
  });

  it.each(THEMES)("keeps body, focus, connection, error and CTA contrast readable in $label", ({ value }) => {
    const palette = themeTokens(value);
    const color = (token: string) => {
      const resolved = palette.get(token);
      expect(resolved, `${value} lacks ${token}`).toMatch(/^#[0-9a-f]{6}$/i);
      return resolved!;
    };
    const pairs = [
      ["--color-white", "--color-panel"],
      ["--color-muted", "--color-panel"],
      ["--color-base", "--color-void"],
      ["--color-blue", "--color-panel"],
      ["--color-ready", "--color-card"],
      ["--color-red", "--color-panel"],
      ["--color-void", "--color-green"],
    ] as const;
    for (const [foreground, background] of pairs) {
      expect(contrast(color(foreground), color(background)), `${value}: ${foreground} on ${background}`)
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps terminal, copy fields and actions bounded at desktop and compact widths", () => {
    expect(styles).toMatch(/\.oauth-login-takeover \{[\s\S]*?width: min\(760px, 100%\);[\s\S]*?min-width: 0;[\s\S]*?overflow: hidden;/);
    expect(styles).toMatch(/\.oauth-login-takeover__terminal pre \{[\s\S]*?max-width: 100%;[\s\S]*?overflow: auto;[\s\S]*?overflow-wrap: anywhere;/);
    expect(styles).toMatch(/\.oauth-login-takeover__copy-grid code \{[\s\S]*?overflow-wrap: anywhere;/);
    expect(styles).toMatch(/@media \(max-width: 720px\) \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
    expect(styles).toMatch(/@media \(max-width: 520px\) \{[\s\S]*?\.oauth-login-takeover__controls button \{ width: 100%; \}/);
  });

  it("separates connection, focus and error states by semantic role", () => {
    expect(styles).toMatch(/\.oauth-login-takeover__connection\.is-connected > span \{ background: var\(--color-ready\); \}/);
    expect(styles).toMatch(/\.oauth-login-takeover__connection\.is-disconnected > span \{ background: var\(--color-red\); \}/);
    expect(styles).toMatch(/\.oauth-login-takeover button:focus-visible,[\s\S]*?outline: 2px solid var\(--color-blue\);/);
    expect(styles).toMatch(/\.oauth-login-takeover__error \{[\s\S]*?color: var\(--color-red\);/);
  });
});
