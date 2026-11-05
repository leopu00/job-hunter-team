import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { AgentRole, OfficeLayout, OfficeManifest } from "../contract";
import { createOfficeEngine } from "./engine";
import { seeded } from "./fixture.test-helpers";

// The office's own files (vitest runs from desktop/): every role drawn in it has a character of its own, a seat at its own
// furniture and the picture of it sitting there. The doctor and the maintainer wore another role's character until they had
// theirs (JHT-T175): this keeps any of the nine from losing its sheet, its seat or its picture.
const PUBLIC = resolve(process.cwd(), "public");
const layout = JSON.parse(readFileSync(resolve(PUBLIC, "office/layout.json"), "utf8")) as OfficeLayout;
const manifest = JSON.parse(readFileSync(resolve(PUBLIC, "office/manifest.json"), "utf8")) as OfficeManifest;
const fileOf = (src: string) => resolve(PUBLIC, src.replace(/^\//, ""));

const CORE: AgentRole[] = ["capitano", "sentinella", "assistente", "mentor", "dottore", "mantenitore"];
const PIPELINE: AgentRole[] = ["scout", "analista", "scorer", "scrittore", "critico"];

describe("the characters of the office", () => {
  it("every role has sheets, every sheet is in the manifest, and every picture it names is a file", () => {
    for (const role of [...CORE, ...PIPELINE]) {
      const sheets = layout.sheets[role] ?? [];
      expect(sheets.length, role).toBeGreaterThan(0);
      for (const id of sheets) {
        const character = manifest.characters.find((c) => c.id === id);
        expect(character, `${role}/${id}`).toBeDefined();
        expect(existsSync(fileOf(character!.main.src)), character!.main.src).toBe(true);
        if (character!.sit) expect(existsSync(fileOf(character!.sit.src)), character!.sit.src).toBe(true);
      }
    }
  });

  it("the doctor and the maintainer have a character of their own, not another role's", () => {
    expect(layout.sheets.dottore).toEqual(["dottore_a"]);
    expect(layout.sheets.mantenitore).toEqual(["mantenitore_a"]);
    const others = [...CORE, ...PIPELINE].filter((r) => r !== "dottore" && r !== "mantenitore").flatMap((r) => layout.sheets[r] ?? []);
    expect(others).not.toContain("dottore_a");
    expect(others).not.toContain("mantenitore_a");
  });

  it("every core role has its seat at furniture that says so, with the picture of it sitting there", () => {
    for (const role of CORE) {
      const seat = layout.coreSeats.find((s) => s.role === role);
      expect(seat, role).toBeDefined();
      const furniture = [...layout.furniture, ...layout.departments.flatMap((d) => d.desks.map((x) => x.furniture))].find((f) => f.id === seat!.furnitureId);
      expect(furniture, `${role}/${seat!.furnitureId}`).toBeDefined();
      expect(furniture!.seatOf, role).toBe(role);
      expect(furniture!.occupiedImage, role).toBeDefined();
      expect(existsSync(fileOf(furniture!.occupiedImage!.src)), furniture!.occupiedImage!.src).toBe(true);
    }
  });

  it("the doctor and the maintainer sit at their own furniture, each in its own room, with their own sheet", () => {
    const engine = createOfficeEngine(layout, { random: seeded() });
    for (const [uid, role] of [["dottore", "dottore"], ["mantenitore", "mantenitore"], ["mentor", "mentor"], ["assistente", "assistente"]] as const) {
      engine.apply({ type: "enter", agent: { uid, role, sheet: "" }, atOnce: true });
    }
    const poses = Object.fromEntries(engine.poses().map((p) => [p.uid, p]));
    expect(poses.dottore).toMatchObject({ sheet: "dottore_a", mode: "sit", seatedAt: "doctor_armchair" });
    expect(poses.mantenitore).toMatchObject({ sheet: "mantenitore_a", mode: "sit", seatedAt: "maintainer_workbench" });
    // each in its own room: the walls that close them are in the layout, and the doctor's chair is below the maintainer's bench
    expect(poses.mantenitore!.pos.y).toBeLessThan(poses.dottore!.pos.y);
    expect(poses.mantenitore!.pos.x).toBeLessThan(layout.floor.x + 800);
    expect(poses.dottore!.pos.x).toBeLessThan(layout.floor.x + 800);
    // and the characters that were already there did not move for them
    expect(poses.mentor).toMatchObject({ sheet: "mentor_a", seatedAt: "mentor_armchair" });
    expect(poses.assistente).toMatchObject({ sheet: "assistente_a", seatedAt: "desk_assistant" });
  });
});
