import { describe, expect, it } from "vitest";
import type { OfficeLayout, OfficeSnapshot } from "../contract";
import { tooltipFor } from "./OfficeTooltip";

const layout = { departments: [{ id: "scout", name: "Research", tagline: "Finds relevant opportunities for you." }] } as unknown as OfficeLayout;
const snapshot = {
  teamOnline: true,
  heartbeatAt: null,
  roster: [],
  piles: { scout: 13, analisti: 4, scorer: 2, scrittori: 1, critici: 3 },
  transitions: [
    { ts: new Date().toISOString(), byAgent: "scout-1", from: null, to: "new", position: { id: "p", legacyId: 1, title: "Dev", company: "Acme" } },
  ],
} as OfficeSnapshot;
const ctx = { layout, snapshot, statuses: { at: 0, agents: { "scout-1": { status: "working" as const } } }, locale: "it" };

describe("the tag under the pointer: what the page already holds, nothing invented", () => {
  it("an agent: its published status and its last move", () => {
    const t = tooltipFor({ kind: "agent", uid: "scout-1", role: "scout" }, ctx);
    expect(t.title).toBe("SCOUT-1");
    expect(t.lines[0]).toBe("WORKING");
    expect(t.lines[1]).toContain("Dev · Acme");
  });

  it("an agent the team did not publish says so, not WAITING", () => {
    expect(tooltipFor({ kind: "agent", uid: "scout-2", role: "scout" }, ctx).lines).toEqual(["stato non pubblicato"]);
  });

  it("a pile, a department, the shelf: the counts of the snapshot", () => {
    expect(tooltipFor({ kind: "pile", dept: "scout" }, ctx)).toEqual({ title: "Research", lines: ["13 posizioni sulla pila"] });
    // what the department does, in the person's language (the floor's sign stays English)
    expect(tooltipFor({ kind: "department", dept: "scout" }, ctx).lines).toEqual(["Trova le opportunità giuste per te.", "in ingresso: 13"]);
    expect(tooltipFor({ kind: "department", dept: "scout" }, { ...ctx, locale: "en" }).lines[0]).toBe("Finds relevant opportunities for you.");
    expect(tooltipFor({ kind: "printer" }, ctx).lines).toEqual(["3 pronti col PASS del critico"]);
  });

  it("without a snapshot no number is shown", () => {
    expect(tooltipFor({ kind: "pile", dept: "scout" }, { ...ctx, snapshot: null }).lines).toEqual(["posizioni sulla pila"]);
  });

  it("tells one position in the singular, in every language that has one", () => {
    const one = { ...ctx, snapshot: { ...snapshot, piles: { ...snapshot.piles, scout: 1, critici: 1 } } as OfficeSnapshot };
    expect(tooltipFor({ kind: "pile", dept: "scout" }, one).lines).toEqual(["1 posizione sulla pila"]);
    expect(tooltipFor({ kind: "pile", dept: "scout" }, { ...one, locale: "en" }).lines).toEqual(["1 position on the pile"]);
    expect(tooltipFor({ kind: "shelf" }, one).lines).toEqual(["1 pronto col PASS del critico"]);
    expect(tooltipFor({ kind: "shelf" }, { ...one, locale: "es" }).lines).toEqual(["1 listo con el PASS del crítico"]);
  });

  it("speaks the language it is asked for, and the English words of the game stay", () => {
    const en = { ...ctx, locale: "en" };
    expect(tooltipFor({ kind: "agent", uid: "scout-2", role: "scout" }, en).lines).toEqual(["status not published"]);
    expect(tooltipFor({ kind: "pile", dept: "scout" }, en)).toEqual({ title: "Research", lines: ["13 positions on the pile"] });
    expect(tooltipFor({ kind: "board" }, en)).toEqual({ title: "Board", lines: ["positions ready, sent, answered"] });
    expect(tooltipFor({ kind: "agent", uid: "scout-1", role: "scout" }, en).lines[0]).toBe("WORKING");
  });
});

describe("what each department does, said in every language", () => {
  it("has the five departments in every language, and the English is the floor's sign", async () => {
    const { OFFICE_TEXT } = await import("../office.i18n");
    const { readFileSync } = await import("node:fs");
    const floor = JSON.parse(readFileSync("public/office/layout.json", "utf-8")) as { departments: { id: string; tagline: string }[] };
    for (const [locale, text] of Object.entries(OFFICE_TEXT)) {
      expect(Object.keys(text.departmentTaglines).sort(), locale).toEqual(["analisti", "critici", "scorer", "scout", "scrittori"]);
      for (const line of Object.values(text.departmentTaglines)) expect(line.trim().length, locale).toBeGreaterThan(10);
    }
    for (const d of floor.departments) expect(OFFICE_TEXT.en.departmentTaglines[d.id as "scout"]).toBe(d.tagline);
  });
});
