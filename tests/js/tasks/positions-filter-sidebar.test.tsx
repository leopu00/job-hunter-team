import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  searchParams: null as URLSearchParams | null,
  push: vi.fn(),
}));

vi.mock("../../../web/node_modules/next/navigation.js", () => ({
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => navigation.searchParams,
}));

vi.mock("@/lib/use-locale", () => ({
  useLocale: () => "en",
}));

import PositionsFilterSidebar from "../../../web/app/(protected)/positions/PositionsFilterSidebar";

const REPO = path.resolve(__dirname, "../../..");
const webRequire = createRequire(path.join(REPO, "web/package.json"));
const { createElement } = webRequire("react");
const { renderToStaticMarkup } = webRequire("react-dom/server");

describe("PositionsFilterSidebar — parametri URL non pronti", () => {
  it("renderizza con useSearchParams nullo come un URL senza filtri", () => {
    navigation.searchParams = null;

    const html = renderToStaticMarkup(
      createElement(PositionsFilterSidebar, { availableSources: ["LinkedIn"] }),
    );

    expect(html).toContain("Filters");
    expect(html).toContain("0 · 0");
    expect(html).not.toContain("Remove all filters");
  });

  it("mantiene le selezioni quando i parametri URL sono disponibili", () => {
    navigation.searchParams = new URLSearchParams(
      "family=Engineering&noscore=1&status=new%2Cready",
    );

    const html = renderToStaticMarkup(
      createElement(PositionsFilterSidebar, { availableSources: ["LinkedIn"] }),
    );

    expect(html).toContain("Remove all filters");
    expect(html).toContain("New");
    expect(html).toContain("Ready");
  });
});
