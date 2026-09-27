import { SIT_TRACKS, TRACKS, type AgentPose, type CharacterSheet, type Rect, type SheetRef, type Track } from "../contract";

/**
 * Which cell of which sheet a pose shows, the way SpriteSheetRig picks it
 * (game/scripts/characters/sprite_sheet_rig.gd _apply_track/_update_frame):
 * the track is `${mode}_${facing}`, "sit" reads the seated sheet, and a
 * character without one sits with its idle track. The engine decides the
 * frame number; here it only wraps inside the track.
 */
export type CellPick = { sheet: SheetRef; cell: Rect; track: Track };

export function pickCell(pose: AgentPose, character: CharacterSheet): CellPick {
  if (pose.mode === "sit" && character.sit) {
    const track = SIT_TRACKS[`sit_${pose.facing}`] ?? SIT_TRACKS.sit_down;
    return { sheet: character.sit, track, cell: cellRect(character.sit, track, pose.frame) };
  }
  const mode = pose.mode === "sit" ? "idle" : pose.mode;
  const track = TRACKS[`${mode}_${pose.facing}`] ?? TRACKS.idle_down;
  return { sheet: character.main, track, cell: cellRect(character.main, track, pose.frame) };
}

export function cellRect(sheet: SheetRef, track: Track, frame: number): Rect {
  const col = track.frames > 0 ? ((frame % track.frames) + track.frames) % track.frames : 0;
  return { x: col * sheet.cell.w, y: track.row * sheet.cell.h, w: sheet.cell.w, h: sheet.cell.h };
}

/** The anchor that puts the feet on the pose's position, as a fraction of the cell. */
export function feetAnchor(sheet: SheetRef): { x: number; y: number } {
  return { x: sheet.feet.x / sheet.cell.w, y: sheet.feet.y / sheet.cell.h };
}
