// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THEMES } from "../shell/theme";

const onboardingStyles = readFileSync(new URL("./onboarding.css", import.meta.url), "utf8");
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

describe("OnboardingFlow JHT palette", () => {
  it("uses shared semantic colors without the legacy lime palette or literal rendered colors", () => {
    expect(onboardingStyles).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(|hsla?\(/i);
    expect(onboardingStyles).not.toMatch(/var\(--(?:ink|muted|dim|panel|line|accent(?:-dark)?)(?:,|\))/);
    expect(onboardingStyles).not.toMatch(/187\s*,\s*242\s*,\s*70|bbf246|8cc21d|c9ff56/i);
  });

  it("maps stepper, badges, cards, CTA, focus, success and error to semantic roles", () => {
    expect(onboardingStyles).toMatch(/\.onboarding-progress li\.is-current > span,[\s\S]*?background: var\(--color-green\)/);
    expect(onboardingStyles).toMatch(/\.onboarding-session \{[\s\S]*?background: var\(--color-panel\)/);
    expect(onboardingStyles).toMatch(/\.onboarding-card \{[\s\S]*?background: linear-gradient\([^;]*var\(--color-panel\)[^;]*var\(--color-deep\)/);
    expect(onboardingStyles).toMatch(/\.onboarding-primary \{[\s\S]*?color: var\(--color-void\);[\s\S]*?background: var\(--color-green\)/);
    expect(onboardingStyles).toMatch(/\.onboarding-primary:focus-visible,[\s\S]*?outline: 2px solid var\(--color-blue\)/);
    expect(onboardingStyles).toMatch(/\.onboarding-complete__mark \{[\s\S]*?background: var\(--color-ready\)/);
    expect(onboardingStyles).toMatch(/\.onboarding-error \{[\s\S]*?color: var\(--color-red\)/);
  });

  it("keeps the existing layout bounded at 1400, 820 and 480 pixels", () => {
    expect(onboardingStyles).toMatch(/\.onboarding-shell \{[\s\S]*?overflow-x: hidden;/);
    expect(onboardingStyles).toMatch(/\.onboarding-layout \{[\s\S]*?width: min\(1180px, 100%\);/);
    expect(onboardingStyles).toMatch(/@media \(max-width: 860px\) \{[\s\S]*?\.onboarding-layout \{ grid-template-columns: 1fr;/);
    expect(onboardingStyles).toMatch(/@media \(max-width: 580px\) \{[\s\S]*?\.onboarding-choice-grid--providers \{ grid-template-columns: 1fr; \}/);
    expect(onboardingStyles).toMatch(/@media \(max-width: 580px\) \{[\s\S]*?\.onboarding-primary,[\s\S]*?\.onboarding-secondary \{ width: 100%; \}/);
  });

  it("keeps activity progress readable, responsive and still when reduced motion is requested", () => {
    expect(onboardingStyles).toMatch(/\.onboarding-runtime-progress progress \{[\s\S]*?width: 100%;/);
    expect(onboardingStyles).toMatch(/\.onboarding-activity-details ol \{[\s\S]*?overflow: auto;/);
    expect(onboardingStyles).toMatch(/@media \(max-width: 580px\) \{[\s\S]*?\.onboarding-runtime-progress__heading \{[\s\S]*?flex-direction: column;/);
    expect(onboardingStyles).toMatch(/@media \(max-width: 580px\) \{[\s\S]*?\.onboarding-activity-details li \{ grid-template-columns: 38px minmax\(0, 1fr\);/);
    expect(onboardingStyles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.onboarding-runtime-progress__indeterminate i,[\s\S]*?animation: none;/);
  });

  it.each(THEMES)("defines every onboarding token in the $label theme", ({ value }) => {
    const palette = themeTokens(value);
    const usedTokens = new Set(
      [...onboardingStyles.matchAll(/var\((--color-[\w-]+)\)/g)].map((match) => match[1]),
    );

    for (const token of usedTokens) expect(palette.has(token), `${value} lacks ${token}`).toBe(true);
  });

  it.each(THEMES)("keeps text, CTA, focus, success and error contrast readable in $label", ({ value }) => {
    const palette = themeTokens(value);
    const color = (token: string) => {
      const resolved = palette.get(token);
      expect(resolved, `${value} lacks ${token}`).toMatch(/^#[0-9a-f]{6}$/i);
      return resolved!;
    };
    const pairs = [
      ["--color-white", "--color-panel"],
      ["--color-muted", "--color-panel"],
      ["--color-muted", "--color-card"],
      ["--color-muted", "--color-row"],
      ["--color-muted", "--color-deep"],
      ["--color-muted", "--color-void"],
      ["--color-void", "--color-green"],
      ["--color-blue", "--color-card"],
      ["--color-blue", "--color-deep"],
      ["--color-blue", "--color-row"],
      ["--color-void", "--color-ready"],
      ["--color-red", "--color-panel"],
    ] as const;

    for (const [foreground, background] of pairs) {
      expect(
        contrast(color(foreground), color(background)),
        `${value}: ${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
