/**
 * A small synthetic office for the engine's tests: two departments (scout,
 * analisti), the capitano's seat, a printer and a glass wall with a gap.
 * Not the real layout (that is john's /office/layout.json): the tests check
 * the engine's rules, not the Godot numbers.
 */

import type { Department, FurnitureItem, OfficeLayout } from "../contract";

function desk(id: string, x: number, y: number): FurnitureItem {
  return { id, kind: "desk", rect: { x, y, w: 96, h: 48 }, blocking: true, image: null, facing: "up" };
}

function dept(id: "scout" | "analisti", role: "scout" | "analista", x: number): Department {
  return {
    id,
    role,
    name: id,
    color: "#2196f3",
    zone: { x, y: 100, w: 400, h: 500 },
    inbox: { x: x + 200, y: 520 },
    inboxDropAccess: { x: x + 200, y: 560 },
    inboxPickupAccess: { x: x + 240, y: 560 },
    desks: [0, 1].map((i) => {
      const furniture = desk(`${id}_desk_${i}`, x + 40 + i * 180, 200);
      // desk_spot(up): centre x, rect.end.y + 24
      return { index: i, furniture, seat: { x: furniture.rect.x + 48, y: 272 }, seatFacing: "up" as const };
    }),
  };
}

export function smallOffice(): OfficeLayout {
  const scout = dept("scout", "scout", 100);
  const analisti = dept("analisti", "analista", 700);
  const capDesk: FurnitureItem = { id: "cap_desk", kind: "desk", rect: { x: 560, y: 640, w: 96, h: 48 }, blocking: true, image: null, seatOf: "capitano" };
  return {
    version: 1,
    world: { x: 0, y: 0, w: 1280, h: 800 },
    floor: { x: 0, y: 0, w: 1280, h: 800 },
    floorImage: { src: "/office/floor.webp" },
    // as in the real layout.json, the departments' desks are only in departments[].desks
    furniture: [capDesk],
    departments: [scout, analisti],
    coreSeats: [{ role: "capitano", seat: { x: 608, y: 620 }, seatFacing: "down", furnitureId: "cap_desk" }],
    door: { x: 640, y: 780 },
    nav: {
      cell: 32,
      margin: 28,
      wallMargin: 14,
      // a glass wall between the departments, open at the bottom
      walls: [{ x: 600, y: 0, w: 8, h: 600 }],
    },
    sheets: {
      capitano: ["coordinatore_a"],
      scout: ["scout_a", "scout_b"],
      analista: ["analista_a", "analista_b", "analista_c"],
      scorer: [],
      scrittore: [],
      critico: [],
      sentinella: [],
      assistente: [],
      mentor: [],
    },
    pois: { printer: { x: 400, y: 60 }, outputShelf: { x: 900, y: 740 } },
  };
}

/** A deterministic random: a fixed sequence, so every trip's pauses repeat. */
export function seeded(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
