// @vitest-environment node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ONBOARDING_ARTWORK } from "./OnboardingArtwork";
import { ONBOARDING_TEXT } from "./onboarding.i18n";

const desktop = process.cwd();
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

// The provider step's illustration used to carry the marks of three providers, while the app offers Codex only.
// The file the step loads was checked by eye (the pixels cannot be read in a test): its checksum is pinned here,
// so a swap for another picture is a deliberate change of this test, and the picture with the three marks is not loaded.

describe("the provider step's illustration shows Codex's mark only", () => {
  const src = ONBOARDING_ARTWORK.provider.src;
  const file = resolve(desktop, "public", src.replace(/^\//, ""));

  it("loads the picture with the single mark, checked on 26/10/2026, at its pinned checksum", () => {
    expect(src).toBe("/onboarding/provider-v3.webp");
    expect(statSync(file).isFile()).toBe(true);
    expect(sha256(file)).toBe("bf410e8491eee1a8653525b6291b0fef45bef800afdf97cbcc692ee116016ea6");
  });

  it("does not load the picture that carries the marks of Claude and Kimi, anywhere in the desktop or the web", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? entry.name === "node_modules" ? [] : walk(join(dir, entry.name))
          : /\.(tsx?|css|html|json|md)$/.test(entry.name) ? [join(dir, entry.name)] : [],
      );
    const roots = [join(desktop, "src"), join(desktop, "index.html"), resolve(desktop, "..", "web", "app")];
    const offenders = roots
      .flatMap((root) => (statSync(root).isDirectory() ? walk(root) : [root]))
      .filter((path) => !path.endsWith("provider-artwork-marks.test.ts"))
      .filter((path) => readFileSync(path, "utf8").includes("provider-v2.webp"));
    expect(offenders).toEqual([]);
  });

  it("is described in every language as driven by Codex, with no other provider named", () => {
    for (const [locale, text] of Object.entries(ONBOARDING_TEXT)) {
      expect(text.artwork.provider, locale).toContain("Codex");
      expect(text.artwork.provider, locale).not.toMatch(/claude|kimi|moonshot|anthropic/i);
    }
  });

  it("is recorded in the manifest with the OpenAI mark as the only source", () => {
    const manifest = JSON.parse(readFileSync(join(desktop, "public/onboarding/manifest.json"), "utf8"));
    expect(manifest.generation.provider_mark_sources.map((mark: { provider: string }) => mark.provider)).toEqual(["OpenAI"]);
    const step = manifest.review_candidates.find((candidate: { step: string }) => candidate.step === "provider");
    expect(step.asset).toBe("provider-v3.webp");
  });
});
