// @vitest-environment jsdom
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { metadata } from "../../../web/app/credits/page";
import { MusicCreditLine } from "../../../web/app/credits/CreditsClient";
import { CREDITS_COPY } from "../../../web/app/credits/credits.i18n";
import {
  MUSIC_LICENSE_URL,
  MUSIC_PROVENANCE,
  PUBLIC_MUSIC_CREDIT,
} from "../../../web/lib/media-credits";

const REPO = path.resolve(__dirname, "../../..");
const webRequire = createRequire(path.join(REPO, "web/package.json"));
const { createElement } = webRequire("react");
const { renderToStaticMarkup } = webRequire("react-dom/server");
const LOCALES = ["it", "en", "es", "fr", "de", "pt", "hu"] as const;

function renderCredit(locale: (typeof LOCALES)[number]) {
  if (!PUBLIC_MUSIC_CREDIT) throw new Error("music credit unexpectedly off");
  return new JSDOM(
    renderToStaticMarkup(
      createElement(MusicCreditLine, {
        lang: locale,
        credit: PUBLIC_MUSIC_CREDIT,
      }),
    ),
  ).window.document;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return sourceFiles(file);
    return /\.(?:ts|tsx)$/.test(name) ? [file] : [];
  });
}

describe("pagina crediti pubblica permanente", () => {
  it("mantiene l'attribuzione pubblica in un solo oggetto removibile", () => {
    expect(PUBLIC_MUSIC_CREDIT).toEqual({
      work: "Covert Affair",
      composer: "Kevin MacLeod",
      source: "incompetech.com",
      license: "CC BY 4.0",
      licenseUrl: MUSIC_LICENSE_URL,
    });

    const consumers = sourceFiles(path.join(REPO, "web/app"))
      .filter((file) =>
        readFileSync(file, "utf8").includes("PUBLIC_MUSIC_CREDIT"),
      )
      .map((file) => path.relative(REPO, file));
    expect(consumers).toEqual(["web/app/credits/CreditsClient.tsx"]);
  });

  it("rende una sola riga essenziale e tradotta in tutte le sette lingue", () => {
    for (const locale of LOCALES) {
      const document = renderCredit(locale);
      const line = document.querySelector("p[data-music-credit]");
      const text = line?.textContent ?? "";

      expect(document.querySelectorAll("p[data-music-credit]")).toHaveLength(1);
      expect(text).toContain("Covert Affair");
      expect(text).toContain("Kevin MacLeod");
      expect(text).toContain("CC BY 4.0");
      expect(text).toContain("CC0");
      expect(line?.querySelector("a")?.getAttribute("href")).toBe(
        MUSIC_LICENSE_URL,
      );
      expect(CREDITS_COPY.credit_line[locale]).toContain("{license}");
    }
    expect(
      new Set(LOCALES.map((locale) => CREDITS_COPY.credit_line[locale])).size,
    ).toBe(LOCALES.length);
  });

  it("conserva fuori dalla UI la provenienza verificata dei due audio", () => {
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
  });

  it("espone metadati permanenti e lascia la Home senza attribuzioni duplicate", () => {
    expect(metadata.alternates).toEqual({ canonical: "/credits" });
    expect(metadata.robots).toEqual({ index: true, follow: true });

    const homeTrailer = readFileSync(
      path.join(REPO, "web/app/components/public-media/HomeTrailer.tsx"),
      "utf8",
    );
    expect(homeTrailer).not.toMatch(
      /media-credits|data-music-credit|Music credit|CC BY/,
    );
  });
});
