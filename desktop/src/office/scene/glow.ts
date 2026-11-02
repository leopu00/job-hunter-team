/**
 * agent_npc.gd react_to_work: when a real transition shows, the body glows
 * teal (Godot's modulate (0.72, 1.3, 1.05), which Pixi's multiplying tint
 * cannot brighten: the red and the blue are darkened instead, the green
 * stays). `pulse` is 0..1, the engine's AgentPose.pulse.
 */
export function glowTint(pulse: number | undefined): number {
  if (!pulse || pulse <= 0) return 0xffffff;
  const k = Math.min(1, pulse);
  const r = Math.round(255 - 255 * 0.28 * k);
  const b = Math.round(255 - 255 * 0.06 * k);
  return (r << 16) | (255 << 8) | b;
}
