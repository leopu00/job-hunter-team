import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO = path.resolve(__dirname, "../../..");

describe("navigazione pubblica senza placeholder di route", () => {
  it("non definisce un loading boundary globale", () => {
    // Senza app/loading.tsx Next mantiene la route corrente mentre la nuova
    // viene risolta, invece di sostituirla con un placeholder intermedio.
    expect(existsSync(path.join(REPO, "web/app/loading.tsx"))).toBe(false);
    expect(
      existsSync(path.join(REPO, "web/app/components/PublicLoadingShell.tsx")),
    ).toBe(false);
    expect(existsSync(path.join(REPO, "web/app/public-loading.i18n.ts"))).toBe(
      false,
    );
  });

  it("non conserva marker o animazioni del vecchio placeholder", () => {
    const styles = readFileSync(path.join(REPO, "web/app/globals.css"), "utf8");

    expect(styles).not.toContain("public-loading-shell");
    expect(styles).not.toContain("public-loading-reveal");
    expect(styles).not.toContain("data-public-loading-shell");
  });

  it("non dissolve il contenuto delle route pubbliche dopo il cambio pagina", () => {
    const publicEntries = [
      "web/app/components/landing/LandingHome.tsx",
      "web/app/agents/page.tsx",
      "web/app/project/page.tsx",
      "web/app/pricing/page.tsx",
      "web/app/run/page.tsx",
      "web/app/download/DownloadClient.tsx",
      "web/app/contact/page.tsx",
      "web/app/privacy/page.tsx",
    ];

    for (const entry of publicEntries) {
      const source = readFileSync(path.join(REPO, entry), "utf8");
      expect(source, entry).not.toMatch(/animation:\s*"fade-in[^";]*both"/);
    }
  });
});
