// @vitest-environment jsdom
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  FooterSocialLinks,
  SOCIAL_PROFILES,
} from "../../../web/app/components/landing/FooterSocialLinks";

const REPO = path.resolve(__dirname, "../../..");
const webRequire = createRequire(path.join(REPO, "web/package.json"));
const { createElement } = webRequire("react");
const { renderToStaticMarkup } = webRequire("react-dom/server");

function renderSocialLinks() {
  const html = renderToStaticMarkup(
    createElement(FooterSocialLinks, {
      labels: {
        instagram: "Job Hunter Team on Instagram",
        tiktok: "Job Hunter Team on TikTok",
      },
    }),
  );
  return new JSDOM(html).window.document;
}

function glyphPathFromAsset(name: string): string {
  const svg = readFileSync(
    path.join(REPO, `web/public/brand/${name}-glyph.svg`),
    "utf8",
  );
  const match = svg.match(/<path d="([^"]+)"/);
  expect(match).not.toBeNull();
  return match![1];
}

describe("social link del footer pubblico", () => {
  it("espone Instagram con URL e attributi accessibili esatti", () => {
    const document = renderSocialLinks();
    const link = document.querySelector<HTMLAnchorElement>(
      'a[data-social-profile="instagram"]',
    );

    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe(
      "https://www.instagram.com/jobhunterteam.ai/",
    );
    expect(link?.target).toBe("_blank");
    expect(new Set(link?.rel.split(/\s+/))).toEqual(
      new Set(["noopener", "noreferrer"]),
    );
    expect(link?.getAttribute("aria-label")).toBe(
      "Job Hunter Team on Instagram",
    );
  });

  it("espone TikTok con l'handle confermato da HQ-SOCIAL", () => {
    const tiktok = SOCIAL_PROFILES.find(
      (profile) => profile.network === "tiktok",
    );
    expect(tiktok?.published).toBe(true);

    const link = renderSocialLinks().querySelector<HTMLAnchorElement>(
      'a[data-social-profile="tiktok"]',
    );
    expect(link?.getAttribute("href")).toBe(
      "https://www.tiktok.com/@jobhunterteam.ai",
    );
    expect(link?.target).toBe("_blank");
    expect(new Set(link?.rel.split(/\s+/))).toEqual(
      new Set(["noopener", "noreferrer"]),
    );
    expect(link?.getAttribute("aria-label")).toBe("Job Hunter Team on TikTok");
  });

  it("non chiama nessun host esterno per i glifi", () => {
    // Il glifo TikTok arrivava dal CDN ttwstatic: con il profilo pubblicato
    // ogni visitatore sarebbe stato visto da TikTok senza aver cliccato nulla.
    const html = renderSocialLinks().documentElement.innerHTML;
    expect(html).not.toContain("ttwstatic");
    expect(html).not.toMatch(/https?:\/\/[^"']*\.(svg|png)/);
  });

  it("disegna i glifi inline, così seguono il tema senza un secondo file", () => {
    const document = renderSocialLinks();

    for (const network of ["instagram", "tiktok"] as const) {
      const svg = document.querySelector(
        `a[data-social-profile="${network}"] svg`,
      );
      expect(svg).not.toBeNull();
      // currentColor è l'intero meccanismo: un fill fisso lo spegnerebbe, e un
      // <img src> non erediterebbe il colore della pagina (misurato: resta nero
      // sul tema scuro).
      expect(svg?.getAttribute("fill")).toBe("currentColor");
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
      // Il colore va portato da uno style inline: con la classe arbitraria
      // `text-[var(--color-white)]` il glifo ereditava il verde dei link del
      // footer (misurato sulla preview: rgb(8,113,58)). Questo test non può
      // vederlo — in JSDOM non c'è CSS — quindi si limita a fissare la forma
      // che sulla preview è risultata corretta: dark rgb(240,240,250), light
      // rgb(10,10,32).
      expect(svg?.getAttribute("style")).toContain("var(--color-white)");

      const drawn = svg?.querySelector("path")?.getAttribute("d");
      expect(drawn).toBe(glyphPathFromAsset(network));
    }

    // Nessun <img>: resterebbe monocromo sul tema sbagliato.
    expect(document.querySelector("[data-footer-social] img")).toBeNull();
  });

  it("non rimette un fondo pieno sotto i glifi", () => {
    // Il fondo nero serviva a rendere leggibile un glifo bianco fisso. Con il
    // glifo che segue il tema non serve più, e l'operatore lo vuole trasparente.
    const document = renderSocialLinks();
    for (const link of document.querySelectorAll("[data-social-profile]")) {
      const cls = link.getAttribute("class") ?? "";
      expect(cls).not.toMatch(/\bbg-(black|white)\b/);
      expect(link.getAttribute("style")).toBeNull();
      // Più piccoli di prima (erano h-8 w-8).
      expect(cls).toContain("h-6 w-6");
    }
  });
});
