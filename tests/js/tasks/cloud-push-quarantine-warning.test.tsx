import { createRequire } from "node:module";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { CloudPushQuarantineWarning } from "@/app/components/CloudRefreshButton";
import { cloudPushQuarantineCount } from "@/lib/team-state/sync-freshness";
import type { Locale } from "@/i18n/config";

const REPO = path.resolve(__dirname, "../../..");
const webRequire = createRequire(path.join(REPO, "web/package.json"));
const { createElement } = webRequire("react");
const { renderToStaticMarkup } = webRequire("react-dom/server");
const LOCALES: Locale[] = ["en", "it", "hu", "es", "de", "fr", "pt"];

function render(locale: Locale, status: string | null) {
  return renderToStaticMarkup(
    createElement(CloudPushQuarantineWarning, { locale, status }),
  );
}

describe("cloud push quarantine warning", () => {
  it("renders a sanitized aggregate in every supported locale", () => {
    const copies = LOCALES.map((locale) => {
      const html = render(locale, "quarantined:2");
      expect(html).toContain("data-cloud-push-quarantine-warning");
      expect(html).toContain('role="alert"');
      const text = new JSDOM(html).window.document.body.textContent ?? "";
      expect(text).toContain("2");
      expect(text).not.toContain("applications");
      expect(text).not.toContain("HTTP");
      return text;
    });
    expect(new Set(copies).size).toBe(LOCALES.length);
  });

  it("disappears after recovery and rejects malformed/detail-bearing status", () => {
    expect(render("en", "current")).toBe("");
    expect(render("en", null)).toBe("");
    expect(render("en", "quarantined:2:applications_upsert_failed")).toBe("");
    expect(cloudPushQuarantineCount("quarantined:0000000")).toBe(0);
    expect(cloudPushQuarantineCount("quarantined:0")).toBe(0);
  });
});
