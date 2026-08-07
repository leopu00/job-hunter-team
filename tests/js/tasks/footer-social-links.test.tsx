// @vitest-environment jsdom
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
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
    expect(link?.querySelector("img")?.getAttribute("src")).toBe(
      "/brand/instagram-glyph-white.svg",
    );
    expect(link?.querySelector("img")?.getAttribute("loading")).toBe("lazy");
  });

  it("mantiene il glyph Meta invariato e senza trattamenti CSS", () => {
    const asset = readFileSync(
      path.join(REPO, "web/public/brand/instagram-glyph-white.svg"),
      "utf8",
    ).trimEnd();
    expect(createHash("sha256").update(asset).digest("hex")).toBe(
      "3347813e9e8f082cdf48495818bd370ccff94b687efb8aa1c8a7b36cfcfb8291",
    );

    const document = renderSocialLinks();
    const image = document.querySelector(
      'a[data-social-profile="instagram"] img',
    );
    expect(image?.getAttribute("class")).toBeNull();
    expect(image?.getAttribute("style")).toBeNull();
  });

  it("non rende TikTok navigabile, focusabile né scaricabile prima del GO", () => {
    const tiktok = SOCIAL_PROFILES.find(
      (profile) => profile.network === "tiktok",
    );
    expect(tiktok?.published).toBe(false);

    const document = renderSocialLinks();
    expect(document.querySelector('[data-social-profile="tiktok"]')).toBeNull();
    expect(
      [...document.querySelectorAll("a")].some((link) =>
        link.href.includes("tiktok"),
      ),
    ).toBe(false);
    expect(document.documentElement.innerHTML).not.toContain(
      "lf16-tiktok-common.ttwstatic.com",
    );
  });
});
