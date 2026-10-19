import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const charts = readFileSync(resolve(process.cwd(), "../web/app/components/MapCharts.tsx"), "utf8");

// The Positions card scrolls inside itself: its last visible row used to be cut
// in half with nothing to say the list goes on.
describe("the Positions card list fades out at the bottom", () => {
  it("masks the last 28 px and keeps room for the last row above the fade", () => {
    expect(charts).toMatch(/const LIST_FADE_PX = 28;/);
    expect(charts).toMatch(/paddingBottom: LIST_FADE_PX/);
    expect(charts).toMatch(/maskImage: `linear-gradient\(to bottom, #000 calc\(100% - \$\{LIST_FADE_PX\}px\), transparent\)`/);
    expect(charts).toMatch(/WebkitMaskImage:/);
  });

  it("is applied to the scrolling list of positions", () => {
    expect(charts).toMatch(/overscrollBehavior: "contain",[^}]*\.\.\.LIST_FADE_STYLE,/);
  });
});
