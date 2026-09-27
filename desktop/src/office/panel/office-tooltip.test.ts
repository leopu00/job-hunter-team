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
    expect(tooltipFor({ kind: "department", dept: "scout" }, ctx).lines).toEqual(["Finds relevant opportunities for you.", "in ingresso: 13"]);
    expect(tooltipFor({ kind: "printer" }, ctx).lines).toEqual(["3 pronti col PASS del critico"]);
  });

  it("without a snapshot no number is shown", () => {
    expect(tooltipFor({ kind: "pile", dept: "scout" }, { ...ctx, snapshot: null }).lines).toEqual(["posizioni sulla pila"]);
  });
});
