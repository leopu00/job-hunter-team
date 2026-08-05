import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import MainContent from "../../../web/app/components/main-content";
import { PublicLoadingShell } from "../../../web/app/components/PublicLoadingShell";
import {
  PUBLIC_LOADING_COPY,
  publicLoadingLocale,
  publicLoadingLocaleFromCookieStore,
} from "../../../web/app/public-loading.i18n";

const REPO = path.resolve(__dirname, "../../..");
const webRequire = createRequire(path.join(REPO, "web/package.json"));
const { createElement } = webRequire("react");
const { renderToStaticMarkup } = webRequire("react-dom/server");

describe("fallback della home pubblica", () => {
  it("renderizza struttura, promessa e recovery senza annidare un main", () => {
    const html = renderToStaticMarkup(
      createElement(PublicLoadingShell, { locale: "en" }),
    );

    expect(html).toContain("data-public-loading-shell");
    expect(html).toContain("public-loading-shell");
    expect(html).toContain("data-public-loading-promise");
    expect(html).toContain("data-public-loading-recovery");
    expect(html).toContain('role="status"');
    expect(html).toContain(PUBLIC_LOADING_COPY.en.promise);
    expect(html).toContain(PUBLIC_LOADING_COPY.en.recovery);
    expect(html).not.toMatch(/<main\b/i);
  });

  it("non mostra il template nelle transizioni rapide e non oscura la pagina", () => {
    const styles = readFileSync(path.join(REPO, "web/app/globals.css"), "utf8");
    const mainHtml = renderToStaticMarkup(
      createElement(MainContent, { children: "Contenuto" }),
    );

    expect(styles).toMatch(
      /\.public-loading-shell\s*\{[^}]*visibility:\s*hidden;[^}]*animation:\s*public-loading-reveal\s+1ms\s+steps\(1, end\)\s+220ms\s+forwards;[^}]*\}/s,
    );
    expect(mainHtml).not.toContain("opacity:");
    expect(mainHtml).not.toContain("transition:");
  });

  it("usa NEXT_LOCALE al primo render e offre tutte le sette lingue", () => {
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

    const locale = publicLoadingLocaleFromCookieStore({
      get(name) {
        return name === "NEXT_LOCALE" ? { value: "de" } : undefined;
      },
    });
    const html = renderToStaticMarkup(
      createElement(PublicLoadingShell, { locale }),
    );
    expect(locale).toBe("de");
    expect(html).toContain(PUBLIC_LOADING_COPY.de.status);
    expect(html).toContain(PUBLIC_LOADING_COPY.de.promise);
    expect(publicLoadingLocale("not-a-locale")).toBe("it");
  });
});
