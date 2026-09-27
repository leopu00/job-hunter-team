// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyTextOverrides, TEXT_OVERRIDES } from "./overrides";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const files = [...new Set(TEXT_OVERRIDES.map((o) => o.file))];

describe("desktop-only texts", () => {
  it.each(files)("replace every overridden web text in %s, and leave no trace of the old one", (file) => {
    const id = `${repo}${file}`;
    const web = readFileSync(id, "utf-8");
    const desktop = applyTextOverrides(id, web);
    for (const o of TEXT_OVERRIDES.filter((x) => x.file === file)) {
      expect(web).toContain(o.from);
      expect(desktop).not.toContain(o.from);
      expect(desktop).toContain(o.to);
    }
  });

  it("the team page no longer tells the desktop user about a local SQLite", () => {
    const id = `${repo}web/app/(protected)/team/ActivityCharts.tsx`;
    expect(applyTextOverrides(id, readFileSync(id, "utf-8"))).not.toMatch(/SQLite/);
  });

  it("the team's status card no longer calls the desktop a read-only mobile view", () => {
    const id = `${repo}web/app/(protected)/team/MobileTeamStatus.tsx`;
    const desktop = applyTextOverrides(id, readFileSync(id, "utf-8"));
    expect(desktop).not.toMatch(/mobile view|vista mobile|vista móvil|vue mobile|mobile Ansicht|mobilnézet|vista móvel/i);
    expect(desktop).toContain("Qui vedi lo stato del team e puoi fermarlo. Per avviarlo usa «Team locale», in alto.");
  });

  it("fails loudly when the web rewords a text instead of shipping the old one", () => {
    const override = { file: "web/x.tsx", from: "old words", to: "new words" };
    expect(() => applyTextOverrides("/repo/web/x.tsx", "reworded", [override])).toThrow(/found 0/);
    expect(applyTextOverrides("/repo/web/other.tsx", "old words", [override])).toBe("old words");
  });
});
