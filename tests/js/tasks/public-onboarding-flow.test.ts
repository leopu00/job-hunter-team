import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function readWebFile(relativePath: string) {
  return fs.readFileSync(
    path.resolve(__dirname, "../../../web", relativePath),
    "utf8",
  );
}

const ctaSource = readWebFile("app/components/landing/LandingCTA.tsx");
const navSource = readWebFile("app/components/landing/LandingNav.tsx");
const landingI18nSource = readWebFile("app/components/landing/LandingI18n.tsx");
const downloadSource = readWebFile("app/download/DownloadClient.tsx");
const runSource = readWebFile("app/run/page.tsx");

describe("percorso pubblico di onboarding", () => {
  it("manda la CTA finale della home al percorso di avvio, non al download", () => {
    const ctaStart = ctaSource.indexOf('id="cta"');
    const cta = ctaSource.slice(
      ctaStart,
      ctaSource.indexOf("</section>", ctaStart),
    );

    expect(cta).toContain('href="/run"');
    expect(cta).not.toContain('href="/download"');
  });

  it("espone Come si avvia prima del download nella navigazione desktop e mobile", () => {
    const desktop = navSource.slice(
      navSource.indexOf('className="hidden md:flex items-center gap-6"'),
      navSource.indexOf('<div className="flex items-center gap-2 sm:gap-3">'),
    );
    const mobile = navSource.slice(
      navSource.indexOf('id="mobile-nav-menu"'),
      navSource.indexOf(
        'href="/pricing"',
        navSource.indexOf('id="mobile-nav-menu"'),
      ),
    );

    for (const navigation of [desktop, mobile]) {
      const home = navigation.indexOf('href="/"');
      const run = navigation.indexOf('href="/run"');
      const download = navigation.indexOf('href="/download"');

      expect(home).toBeGreaterThanOrEqual(0);
      expect(run).toBeGreaterThan(home);
      expect(download).toBeGreaterThan(run);
    }

    expect(landingI18nSource).toContain(
      'nav_download: { it: "Installa", en: "Download", hu: "Telepítés" }',
    );
  });

  it("apre Downloads sul Desktop e non presenta più l'app come in arrivo", () => {
    const modes = downloadSource.slice(
      downloadSource.indexOf("const MODES"),
      downloadSource.indexOf("type PlatformId"),
    );

    expect(modes.indexOf('id: "desktop"')).toBeLessThan(
      modes.indexOf('id: "terminal"'),
    );
    expect(downloadSource).toContain('useState<InstallMode>("desktop")');
    expect(downloadSource).toContain("data-install-mode={m.id}");
    expect(runSource).not.toContain("soon: true");
    expect(runSource).not.toContain('soon: "In arrivo"');
  });
});
