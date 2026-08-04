import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_LOADING_COPY } from "../../../web/app/public-loading.i18n";

const REPO = path.resolve(__dirname, "../../..");
const LOADING_SHELL = path.join(REPO, "web/app/loading.tsx");

describe("fallback della home pubblica", () => {
  it("mostra subito una promessa leggibile e un recovery, non solo uno spinner", () => {
    const source = readFileSync(LOADING_SHELL, "utf8");

    expect(source).toContain("data-public-loading-shell");
    expect(source).toContain("data-public-loading-promise");
    expect(source).toContain("data-public-loading-recovery");
    expect(source).toContain('role="status"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain("<h1");
    expect(source).not.toContain("loading_lower");
  });

  it("offre stato, promessa e recovery in tutte le sette lingue", () => {
    expect(Object.keys(PUBLIC_LOADING_COPY).sort()).toEqual([
      "de",
      "en",
      "es",
      "fr",
      "hu",
      "it",
      "pt",
    ]);

    for (const copy of Object.values(PUBLIC_LOADING_COPY)) {
      expect(copy.status.trim()).not.toBe("");
      expect(copy.promise.trim()).not.toBe("");
      expect(copy.recovery.trim()).not.toBe("");
    }
  });
});
