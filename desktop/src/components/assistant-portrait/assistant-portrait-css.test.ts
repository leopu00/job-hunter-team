import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Read as text, with its line ends as a person reads them (a Windows checkout turns them into CRLF).
const css = readFileSync(resolve(process.cwd(), "src/components/assistant-portrait/assistant-portrait.css"), "utf8").replace(/\r\n/g, "\n");

describe("the Assistant's portrait, in its CSS", () => {
  it("crossfades the faces in 150 ms", () => {
    expect(css).toMatch(/\.assistant-portrait__face \{[^}]*transition: opacity 150ms/);
    expect(css).toMatch(/\.assistant-portrait__face\[data-current="true"\] \{\s*opacity: 1;/);
  });

  it("breathes by +0.6% and tilts a hair, slowly, and never stops", () => {
    expect(css).toMatch(/@keyframes assistant-portrait-breathe \{\s*from \{ transform: scale\(1\); \}\s*to \{ transform: scale\(1\.006\); \}/);
    expect(css).toMatch(/assistant-portrait-breathe 4\.6s ease-in-out infinite alternate/);
    expect(css).toMatch(/assistant-portrait-tilt 7\.4s ease-in-out infinite alternate/);
  });

  it("comes in with a slide and a fade", () => {
    expect(css).toMatch(/@keyframes assistant-portrait-enter \{\s*from \{ opacity: 0; transform: translateY\(18px\); \}/);
  });

  it("stops every animation and the crossfade for a person who asked the system for less motion", () => {
    const block = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}\n?$/)?.[1] ?? "";
    // the livelier breathing of «speaking» is stopped too: its selector is the stronger one
    expect(block).toMatch(/\.assistant-portrait,\s*\.assistant-portrait__body,\s*\.assistant-portrait\[data-speaking="true"\] \.assistant-portrait__body \{\s*animation: none;/);
    expect(block).toMatch(/\.assistant-portrait__face \{\s*transition: none;/);
  });
});
