import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
    expect(html).toContain("data-public-loading-promise");
    expect(html).toContain("data-public-loading-recovery");
    expect(html).toContain('role="status"');
    expect(html).toContain(PUBLIC_LOADING_COPY.en.promise);
    expect(html).toContain(PUBLIC_LOADING_COPY.en.recovery);
    expect(html).not.toMatch(/<main\b/i);
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
