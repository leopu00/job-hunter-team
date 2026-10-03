import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { OnboardingRuntimeState } from "../lib/onboarding";
import {
  collectionArtwork,
  OnboardingArtwork,
  ONBOARDING_ARTWORK,
  runtimeArtwork,
} from "./OnboardingArtwork";

describe("onboarding artwork mapping", () => {
  it("maps collection steps and the selected host to stable asset paths", () => {
    expect(ONBOARDING_ARTWORK[collectionArtwork(0, { kind: "local" })].src)
      .toBe("/onboarding/identity.webp");
    expect(ONBOARDING_ARTWORK[collectionArtwork(1, { kind: "local" })].src)
      .toBe("/onboarding/environment-computer-v2.webp");
    expect(ONBOARDING_ARTWORK[collectionArtwork(1, {
      kind: "vps",
      address: "host.example.invalid",
      user: "root",
      port: 22,
      keyPath: "/synthetic/key",
    })].src).toBe("/onboarding/environment-vps-v2.webp");
    expect(ONBOARDING_ARTWORK[collectionArtwork(2, { kind: "local" })].src)
      .toBe("/onboarding/provider-v2.webp");
    expect(ONBOARDING_ARTWORK[collectionArtwork(3, { kind: "local" })].src)
      .toBe("/onboarding/runtime.webp");
  });

  it.each([
    [{ status: "working", stage: "runtime", message: "runtime" }, "runtime"],
    [{ status: "working", stage: "container", message: "container" }, "runtime"],
    [{ status: "working", stage: "provider", message: "provider" }, "runtime"],
    [{ status: "action-required", stage: "ssh-host-key", message: "fingerprint" }, "runtime"],
    [{ status: "action-required", stage: "provider-login", message: "auth" }, "providerAuth"],
    [{ status: "working", stage: "team-start", message: "team" }, "teamStart"],
    [{ status: "action-required", stage: "assistant", message: "assistant" }, "assistantReady"],
    [{ status: "ready" }, "assistantReady"],
  ] as Array<[OnboardingRuntimeState, keyof typeof ONBOARDING_ARTWORK]>)(
    "maps runtime state %# without changing the state object",
    (runtime, expected) => {
      const before = structuredClone(runtime);
      expect(runtimeArtwork(runtime)).toBe(expected);
      expect(runtime).toEqual(before);
    },
  );

  it("renders intrinsic dimensions, useful alt text and the uncropped stable path", () => {
    render(<OnboardingArtwork name="providerAuth" />);
    const image = screen.getByRole("img", { name: /accesso sicuro/i });
    expect(image).toHaveAttribute("src", "/onboarding/provider-auth.webp");
    expect(image).toHaveAttribute("width", "1600");
    expect(image).toHaveAttribute("height", "1200");
    expect(image).toHaveAttribute("decoding", "async");
  });

  it("keeps the 4:3 safe area contained at desktop and mobile widths", () => {
    const css = readFileSync("src/onboarding/onboarding-artwork.css", "utf8");
    expect(css).toMatch(/aspect-ratio:\s*4\s*\/\s*3/);
    expect(css).toMatch(/max-width:\s*100%/);
    expect(css).toMatch(/object-fit:\s*contain/);
    expect(css).toMatch(/object-position:\s*center/);
    expect(css).toMatch(/@media\s*\(max-width:\s*580px\)/);
  });
});
