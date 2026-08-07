// @vitest-environment jsdom
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import CreditsPage, {
  CANONICAL_MUSIC_CREDIT,
  MUSIC_PROVENANCE,
  metadata,
} from "../../../web/app/credits/page";

const REPO = path.resolve(__dirname, "../../..");
const webRequire = createRequire(path.join(REPO, "web/package.json"));
const { createElement } = webRequire("react");
const { renderToStaticMarkup } = webRequire("react-dom/server");

const EXPECTED_CREDIT = [
  "Covert Affair Kevin MacLeod (incompetech.com)",
  "Licensed under Creative Commons: By Attribution 4.0",
  "https://creativecommons.org/licenses/by/4.0/",
  "Edited for timing and mixed with a CC0 cymbal-roll intro.",
] as const;

function renderCredits() {
  return new JSDOM(renderToStaticMarkup(createElement(CreditsPage))).window
    .document;
}

describe("pagina crediti pubblica permanente", () => {
  it("riproduce il blocco canonico del manifest senza variazioni", () => {
    expect(CANONICAL_MUSIC_CREDIT).toEqual(EXPECTED_CREDIT);

    const document = renderCredits();
    const renderedLines = [
      ...document.querySelectorAll("[data-canonical-credit] > p"),
    ].map((line) => line.textContent);

    expect(renderedLines).toEqual(EXPECTED_CREDIT);
    expect(
      document
        .querySelector('[data-canonical-credit] a')
        ?.getAttribute("href"),
    ).toBe(EXPECTED_CREDIT[2]);
  });

  it("espone una struttura semantica accessibile e metadati permanenti", () => {
    const document = renderCredits();
    const article = document.querySelector("article");

    expect(article?.getAttribute("aria-labelledby")).toBe("credits-title");
    expect(document.querySelector("h1#credits-title")?.textContent).toBe(
      "Credits",
    );
    expect(
      document.querySelector('section[aria-labelledby="music-credit-title"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('section[aria-labelledby="provenance-title"] dl'),
    ).not.toBeNull();
    expect(document.querySelector("main")).toBeNull();
    expect(metadata.alternates).toEqual({ canonical: "/credits" });
    expect(metadata.robots).toEqual({ index: true, follow: true });
  });

  it("pubblica la provenienza verificabile di musica e intro CC0", () => {
    expect(MUSIC_PROVENANCE).toEqual({
      work: "Covert Affair",
      composer: "Kevin MacLeod",
      source: "incompetech.com",
      isrc: "USUAN1100795",
      license: "CC BY 4.0",
      sourceAudioSha256:
        "279be47ea7880460be1393d66a83bcc7bee18e10d73537420098e4e1b1c0646f",
      intro: "Orch 006 cymbal roll — Karma-Ron",
      introLicense: "CC0",
      introAudioSha256:
        "215972193c783912bcd1fd249b4ed909d36d9d43145923bfb6fd3357160cd907",
    });

    const text = renderCredits().querySelector(
      'section[aria-labelledby="provenance-title"]',
    )?.textContent;
    expect(text).toContain(MUSIC_PROVENANCE.sourceAudioSha256);
    expect(text).toContain(MUSIC_PROVENANCE.introAudioSha256);
  });

  it("resta autonoma da trailer e componenti Landing condivisi", () => {
    const source = readFileSync(
      path.join(REPO, "web/app/credits/page.tsx"),
      "utf8",
    );

    expect(source).not.toMatch(/components\/landing|Landing[A-Z]/);
    expect(source).not.toMatch(/app\/trailer|TrailerClient/);
    expect(source).not.toMatch(/--color-(?:text|bg)-muted/);
  });
});
