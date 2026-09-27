/**
 * The timing of a character's sprite sheet: which track a mode and a facing
 * read, and which frame of it shows now. A port of game/scripts/characters/
 * sprite_sheet_rig.gd, without the drawing (that is the scene's).
 */

import { SIT_TRACKS, TRACKS, WALK_MAX_FPS, WALK_REFERENCE_SPEED, type AgentMode, type SheetFacing, type Track } from "../contract";

/**
 * SpriteSheetRig.walk_fps_for_speed: the walk cycle's cadence follows the
 * body's speed (a six-pose step covers ~45 world px), never under the
 * track's own fps and never over WALK_MAX_FPS.
 */
export function walkFpsForSpeed(baseFps: number, worldSpeed: number): number {
  if (baseFps <= 0) return 0;
  const proportional = (baseFps * Math.max(worldSpeed, WALK_REFERENCE_SPEED)) / WALK_REFERENCE_SPEED;
  return Math.min(Math.max(proportional, baseFps), WALK_MAX_FPS);
}

/**
 * The mode the rig really plays (SpriteSheetRig.set_motion): "sit" without a
 * seated sheet degrades to "work" (typing standing up), unknown modes to idle.
 */
export function effectiveMode(mode: AgentMode, hasSit: boolean): AgentMode {
  if (mode === "sit") return hasSit ? "sit" : "work";
  return TRACKS[`${mode}_down`] ? mode : "idle";
}

/**
 * The track a mode and facing read. `still` true on a seated agent is the
 * rig's sit_idle: the seated sheet's first frame, no motion.
 */
export function trackFor(mode: AgentMode, facing: SheetFacing, still = false): Track {
  if (mode === "sit") {
    const key = `${still ? "sit_idle" : "sit"}_${facing}`;
    return SIT_TRACKS[key] ?? SIT_TRACKS[`${still ? "sit_idle" : "sit"}_down`]!;
  }
  return TRACKS[`${mode}_${facing}`] ?? TRACKS[`${mode}_down`]!;
}

/** SpriteSheetRig._update_frame: the frame of the track after `t` seconds at `fps`. */
export function frameAt(track: Track, t: number, fps: number): number {
  if (fps <= 0) return 0;
  return Math.floor(t * fps) % track.frames;
}

/** Whether the rig's gait restarts from the first contact (a new walk or carry leg). */
export function startsGait(previous: AgentMode, next: AgentMode): boolean {
  return previous !== "walk" && previous !== "carry" && (next === "walk" || next === "carry");
}
