import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(
    (offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const [r, g, b] = channels.map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("accenti testuali del tema light", () => {
  it("restano leggibili anche sulla card light piu' scura", () => {
    const css = readFileSync(
      resolve(process.cwd(), "../../web/app/globals.css"),
      "utf8",
    );
    const light = css.match(
      /html\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/,
    )?.[1];
    expect(light).toBeTruthy();

    for (const token of [
      "green",
      "ready",
      "yellow",
      "blue",
      "red",
      "orange",
      "purple",
    ]) {
      const value = light?.match(
        new RegExp(`--color-${token}:\\s*(#[0-9a-f]{6})`, "i"),
      )?.[1];
      expect(value, `override light mancante: ${token}`).toBeTruthy();
      expect(
        contrast(value!, "#e4e4ef"),
        `contrasto ${token}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
