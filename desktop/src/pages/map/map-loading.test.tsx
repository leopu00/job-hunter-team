import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";
import { T } from "@/app/components/JobsGlobe.i18n";
import GlobePlaceholder from "@/app/components/GlobePlaceholder";
import MapLoading from "@/app/(protected)/map/loading";

const read = (path: string) => readFileSync(resolve(process.cwd(), "..", path), "utf8");
const globe = read("web/app/components/JobsGlobe.tsx");
const lazy = read("web/app/components/JobsGlobeLazy.tsx");

afterEach(() => {
  cleanup();
  localStorage.removeItem("jht-lang");
});

// The map used to open as the skeleton of a dashboard, then as an empty frame while the globe's chunk
// loaded, then as a dark globe with a line of 11px text: it never looked like the map it was becoming.
describe("the map while it loads", () => {
  it("opens with the map's own shape: the frame, the globe's disc and the corner cards, not a dashboard", () => {
    const { container } = render(<MapLoading />);
    expect(container.querySelector(".map-shell")).not.toBeNull();
    expect(screen.getByTestId("globe-placeholder")).toBeInTheDocument();
    // four cards sit on the globe, on wide windows only
    expect(container.querySelectorAll(".map-shell > .hidden.md\\:block")).toHaveLength(4);
    // no KPI row and no pipeline rows of the dashboard
    expect(container.querySelector(".sm\\:grid-cols-4")).toBeNull();
  });

  it("says «loading the map» in the app's language, for the screen readers and in sight", () => {
    for (const lang of locales) {
      localStorage.setItem("jht-lang", lang);
      render(<GlobePlaceholder />);
      expect(screen.getByRole("status"), lang).toHaveAttribute("aria-label", T.loading_map[lang]);
      expect(T.loading_map[lang].length, lang).toBeGreaterThan(8);
      cleanup();
    }
  });

  it("keeps the globe's place while its chunk loads, and shows a readable line, not 11px of dim text, while the data comes", () => {
    expect(lazy).toContain("loading: () => <GlobePlaceholder />");
    expect(lazy).not.toContain("loading: () => null");
    expect(globe).toContain('data-testid="globe-loading"');
    expect(globe).not.toContain("text-[11px] text-[var(--color-dim)] pointer-events-none");
  });
});

describe("the empty map offers a way on", () => {
  it("has an action in every language, that opens the list of the positions", () => {
    for (const lang of locales) expect(T.empty_action[lang].length, lang).toBeGreaterThan(8);
    expect(globe).toMatch(/<Link\s+href="\/positions"\s+data-testid="map-empty-action"/);
    expect(globe).toContain('tr("empty_action")');
    // the card is drawn once the positions are loaded and there are none, never on the landing showcase
    expect(globe).toMatch(/\{loaded && data\.length === 0 && !showcase && \(/);
  });
});
