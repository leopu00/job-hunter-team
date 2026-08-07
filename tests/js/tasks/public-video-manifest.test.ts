import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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
  it("non espone URL, player o traffico video prima del publish flag", () => {
    for (const video of Object.values(PUBLIC_VIDEOS)) {
      expect(video.published).toBe(false);
      expect(playableVariant(video, "landscape")).toBeNull();
      expect(playableVariant(video, "portrait")).toBeNull();
      expect(initialVideoBytes(video)).toBe(
        PUBLIC_VIDEO_BUDGET.initialVideoBytes,
      );
      expect(validatePublicVideo(video)).toEqual([]);
      expect(JSON.stringify(video)).not.toMatch(/https?:\/\//);
    }
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
    expect(source).not.toContain("autoPlay");
    expect(source).toContain("videoRef.current?.play()");
    expect(source.indexOf("const variant = activated")).toBeLessThan(
      source.indexOf("<video"),
    );
  });
});
