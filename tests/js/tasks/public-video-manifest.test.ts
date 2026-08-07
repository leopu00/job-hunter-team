import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  initialVideoBytes,
  orientationForViewport,
  playableVariant,
  PUBLIC_VIDEO_BUDGET,
  PUBLIC_VIDEOS,
  validatePublicVideo,
  type PublicVideo,
} from "../../../web/lib/public-video-manifest";

const REPO = path.resolve(__dirname, "../../..");
const DEFERRED_VIDEO = path.join(
  REPO,
  "web/app/components/public-media/DeferredVideo.tsx",
);
const HOME_VIDEO = path.join(
  REPO,
  "web/app/components/public-media/HomeTrailer.tsx",
);

function publicAsset(publicUrl: string): string {
  return path.join(REPO, "web/public", publicUrl.replace(/^\//, ""));
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function readyFixture(): PublicVideo {
  return {
    id: "trailer",
    published: true,
    variants: {
      landscape: {
        aspectRatio: "16 / 9",
        src: "https://media.invalid/trailer-landscape.mp4",
        poster: {
          src: "https://media.invalid/trailer-landscape.webp",
          bytes: 10,
        },
        captions: [
          {
            src: "https://media.invalid/trailer-en.vtt",
            srcLang: "en",
            label: "English",
            default: true,
          },
        ],
      },
      portrait: {
        aspectRatio: "9 / 16",
        src: "https://media.invalid/trailer-portrait.mp4",
        poster: {
          src: "https://media.invalid/trailer-portrait.webp",
          bytes: 10,
        },
        captions: [
          {
            src: "https://media.invalid/trailer-en.vtt",
            srcLang: "en",
            label: "English",
            default: true,
          },
        ],
      },
    },
  };
}

describe("manifest video pubblico", () => {
  it("pubblica solo il video approvato e mantiene verificabile la derivazione", () => {
    const video = PUBLIC_VIDEOS.trailer;
    expect(video.published).toBe(true);
    expect(playableVariant(video, "landscape")?.src).toBe(
      "/media/home-video-r4-web.mp4",
    );
    expect(playableVariant(video, "portrait")?.src).toBe(
      "/media/home-video-r4-web.mp4",
    );
    expect(initialVideoBytes(video)).toBe(
      PUBLIC_VIDEO_BUDGET.initialVideoBytes,
    );
    expect(validatePublicVideo(video)).toEqual([]);
    expect(video.provenance.approvedMasterSha256).toBe(
      "9f24ca9dfc0918d7f7a35b672f58300a2d6deb3722215409f4f0e93c542e3cf1",
    );

    const derivative = publicAsset(video.variants.landscape.src);
    const poster = publicAsset(video.variants.landscape.poster.src);
    expect(statSync(derivative).size).toBe(video.provenance.derivativeBytes);
    expect(sha256(derivative)).toBe(video.provenance.derivativeSha256);
    expect(statSync(poster).size).toBe(video.variants.landscape.poster.bytes);
    expect(sha256(poster)).toBe(video.provenance.posterSha256);

    for (const pending of [PUBLIC_VIDEOS.game, PUBLIC_VIDEOS.web]) {
      expect(pending.published).toBe(false);
      expect(playableVariant(pending, "landscape")).toBeNull();
      expect(playableVariant(pending, "portrait")).toBeNull();
      expect(initialVideoBytes(pending)).toBe(
        PUBLIC_VIDEO_BUDGET.initialVideoBytes,
      );
      expect(validatePublicVideo(pending)).toEqual([]);
      expect(JSON.stringify(pending)).not.toMatch(/https?:\/\//);
    }
  });

  it("un media non pubblicato non produce placeholder o cornici", () => {
    const source = readFileSync(DEFERRED_VIDEO, "utf8");
    const home = readFileSync(HOME_VIDEO, "utf8");

    expect(source).toContain("if (!video.published) return null");
    expect(source).not.toContain("data-video-pending");
    expect(home).toContain("validatePublicVideo(video)");
    expect(home).toContain("return null");
    expect(home).not.toContain("<h2");
    expect(home).not.toContain("trailer_title");
  });

  it("sceglie la variante nativa adatta all'orientamento solo al click", () => {
    const video = readyFixture();
    expect(orientationForViewport(false)).toBe("landscape");
    expect(orientationForViewport(true)).toBe("portrait");
    expect(
      playableVariant(video, orientationForViewport(false))?.src,
    ).toContain("landscape");
    expect(playableVariant(video, orientationForViewport(true))?.src).toContain(
      "portrait",
    );
  });

  it("rifiuta media pubblicato senza captions o poster entro il budget", () => {
    const video = readyFixture();
    video.variants.landscape.captions = [];
    video.variants.portrait.poster.bytes =
      PUBLIC_VIDEO_BUDGET.maxLazyPosterBytes + 1;
    expect(validatePublicVideo(video)).toEqual([
      "trailer:landscape non è riproducibile",
      "trailer:portrait poster oltre il budget",
    ]);
  });

  it("mantiene il player senza preload e rende il poster lazy", () => {
    const source = readFileSync(DEFERRED_VIDEO, "utf8");
    expect(source).toContain('preload="none"');
    expect(source).toContain('loading="lazy"');
    expect(source).toContain('kind="captions"');
    expect(source).toContain("if (!video.published)");
    expect(source).not.toContain("data-video-pending");
    expect(source).not.toContain("autoPlay");
    expect(source).toContain("videoRef.current?.play()");
    expect(source.indexOf("const variant = activated")).toBeLessThan(
      source.indexOf("<video"),
    );
  });
});
