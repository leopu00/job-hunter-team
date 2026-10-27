import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";
import { DEPT_ORDER, type OfficeLayout } from "./contract";
import { localizeLayout, officeText } from "./office.i18n";

const layout = JSON.parse(readFileSync("public/office/layout.json", "utf8")) as OfficeLayout;
const ENGLISH = ["research", "analysis", "compatibility", "applications", "quality check", "finds relevant", "turns listings", "gauges how well", "tailors each", "reviews every"];

describe("the office's signs in the person's language", () => {
  it.each(locales)("%s: the name and the tagline painted on the floor are the dictionary's", (locale) => {
    const t = officeText(locale);
    for (const dept of localizeLayout(layout, locale).departments) {
      expect(dept.name).toBe(t.departmentNames[dept.id]);
      expect(dept.tagline).toBe(t.departmentTaglines[dept.id]);
    }
  });

  it.each(locales)("%s: a handoff tag names the department and the one that takes its work", (locale) => {
    const t = officeText(locale);
    for (const dept of localizeLayout(layout, locale).departments) {
      const next = DEPT_ORDER[DEPT_ORDER.indexOf(dept.id) + 1];
      if (!next) expect(dept.handoff).toBeUndefined();
      else expect(dept.handoff?.label).toBe(`${t.departmentNames[dept.id].toUpperCase()}  →  ${t.departmentNames[next].toUpperCase()}`);
    }
  });

  it("the English layout says what the layout file says", () => {
    const english = localizeLayout(layout, "en").departments;
    expect(english.map((d) => d.name)).toEqual(layout.departments.map((d) => d.name));
    expect(english.map((d) => d.handoff?.label)).toEqual(layout.departments.map((d) => d.handoff?.label));
  });

  it("Portuguese leaves no English word on the office's signs", () => {
    const signs = JSON.stringify(localizeLayout(layout, "pt").departments.map((d) => [d.name, d.tagline, d.handoff?.label])).toLowerCase();
    for (const word of ENGLISH) expect(signs, word).not.toContain(word);
  });

  it("does not change what is not a sign: the zones, the desks and the rest of the layout", () => {
    const pt = localizeLayout(layout, "pt");
    expect(pt.furniture).toBe(layout.furniture);
    pt.departments.forEach((dept, i) => expect({ ...dept, name: 0, tagline: 0, handoff: 0 }).toEqual({ ...layout.departments[i], name: 0, tagline: 0, handoff: 0 }));
  });
});
