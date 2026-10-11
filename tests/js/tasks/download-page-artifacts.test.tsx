import { createRequire } from "node:module";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import DownloadClient from "@/app/download/DownloadClient";
import { DOWNLOAD_ARTIFACTS } from "@/lib/download-funnel";

const locale = vi.hoisted(() => ({ lang: "en" }));
vi.mock("../../../web/node_modules/next/navigation.js", () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/app/components/landing/LandingI18n", () => ({
  LandingI18nProvider: ({ children }: { children: unknown }) => children,
  useLandingI18n: () => ({ lang: locale.lang, t: (key: string) => key }),
}));
vi.mock("@/app/components/landing/LandingNav", () => ({ default: () => null }));
vi.mock("@/app/components/landing/LandingCTA", () => ({
  LandingFooter: () => null,
}));
vi.mock("@/app/components/landing/ScrollToTop", () => ({
  default: () => null,
}));

const webRequire = createRequire(
  path.resolve(__dirname, "../../../web/package.json"),
);
const { createElement } = webRequire("react");
const { renderToStaticMarkup } = webRequire("react-dom/server");
function renderPage() {
  return new JSDOM(
    renderToStaticMarkup(
      createElement(DownloadClient, {
        attribution: {
          utm_source: "none",
          utm_medium: "none",
          utm_campaign: "none",
        },
      }),
    ),
  ).window.document;
}

describe("download page — active artifacts and installer withdrawal", () => {
  it("shows each platform's own version and Windows byte identities", () => {
    const document = renderPage();
    for (const slug of ["mac", "win-setup", "linux"] as const) {
      const artifact = DOWNLOAD_ARTIFACTS[slug]!;
      const link = document.querySelector(`a[href="/go/${slug}"]`)!;
      expect(link.textContent).toContain(`v${artifact.version}`);
    }
    for (const slug of ["win-setup", "win-portable"] as const) {
      const artifact = DOWNLOAD_ARTIFACTS[slug]!;
      expect(document.body.textContent).toContain(artifact.filename);
      expect(document.body.textContent).toContain(artifact.sha256);
    }
    expect(document.body.textContent).not.toContain("0.3.10");
  });

  it("removes the withdrawn installer CTA and checksum with distinct copy in all seven languages", () => {
    const active = DOWNLOAD_ARTIFACTS["win-setup"];
    const messages = new Set<string>();
    try {
      DOWNLOAD_ARTIFACTS["win-setup"] = null;
      for (const lang of ["en", "it", "es", "fr", "de", "pt", "hu"]) {
        locale.lang = lang;
        const document = renderPage();
        expect(document.querySelector('a[href="/go/win-setup"]')).toBeNull();
        expect(document.body.textContent).not.toContain(active!.sha256);
        expect(
          document.querySelector('a[href="/go/win-portable"]'),
        ).not.toBeNull();
        expect(document.querySelector('a[href="/go/mac"]')).not.toBeNull();
        expect(document.querySelector('a[href="/go/linux"]')).not.toBeNull();
        const message = document.querySelector('[role="status"]')!.textContent!;
        expect(message).not.toMatch(/0\.3\.9|0\.3\.10|https?:/);
        messages.add(message);
      }
      expect(messages.size).toBe(7);
    } finally {
      DOWNLOAD_ARTIFACTS["win-setup"] = active;
      locale.lang = "en";
    }
  });
});
