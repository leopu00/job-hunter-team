/** Test UI batch 18 — MediaPlayer, Cropper */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
function readSrc(rel: string) { return fs.readFileSync(path.join(WEB, rel), "utf-8"); }

/* ── MediaPlayer ── */
describe("MediaPlayer", () => {
  const src = readSrc("components/MediaPlayer.tsx");

  it("export default MediaPlayer + MediaPlayerProps + type audio/video", () => {
    expect(src).toMatch(/export default function MediaPlayer\b/);
    expect(src).toContain("export interface MediaPlayerProps");
    expect(src).toContain("'audio' | 'video'");
    expect(src).toContain("type = 'video'");
  });

  it("play/pause toggle + media events: timeupdate, loadedmetadata, play, pause, ended", () => {
    expect(src).toContain("playing ? m.pause() : m.play()");
    expect(src).toContain("'timeupdate'");
    expect(src).toContain("'loadedmetadata'");
    expect(src).toContain("'play'");
    expect(src).toContain("'pause'");
    expect(src).toContain("'ended'");
  });

  it("volume: ArrowUp +0.1 / ArrowDown -0.1 + mute key m + range input 0-1", () => {
    expect(src).toContain("e.key === 'ArrowUp'");
    expect(src).toContain("Math.min(m.volume + 0.1, 1)");
    expect(src).toContain("e.key === 'ArrowDown'");
    expect(src).toContain("Math.max(m.volume - 0.1, 0)");
    expect(src).toContain("e.key === 'm'");
    expect(src).toContain('type="range" min={0} max={1}');
  });

  it("seek: ArrowRight +5s / ArrowLeft -5s + progress drag clientX + pct", () => {
    expect(src).toContain("e.key === 'ArrowRight'");
    expect(src).toContain("m.currentTime + 5");
    expect(src).toContain("e.key === 'ArrowLeft'");
    expect(src).toContain("m.currentTime - 5");
    expect(src).toContain("onProgressMouseDown");
    expect(src).toContain("(e.clientX - rect.left) / rect.width");
  });

  it("fullscreen: key f + requestFullscreen + fmtTime + auto-hide 2500ms + icons ⏸/▶/🔊/🔇", () => {
    expect(src).toContain("e.key === 'f'");
    expect(src).toContain("requestFullscreen");
    expect(src).toContain("exitFullscreen");
    expect(src).toContain("function fmtTime");
    expect(src).toContain("padStart(2, '0')");
    expect(src).toContain("), 2500)");
    expect(src).toContain("playing ? '⏸' : '▶'");
  });
});

/* ── Cropper ── */
describe("Cropper", () => {
  const src = readSrc("components/Cropper.tsx");

  it("export default Cropper + CropperProps + aspectRatio free/number + outputSize", () => {
    expect(src).toMatch(/export default function Cropper\b/);
    expect(src).toContain("export interface CropperProps");
    expect(src).toContain("aspectRatio?: number | 'free'");
    expect(src).toContain("outputSize = 512");
  });

  it("zoom range 0.5-3 + rotate ±90 buttons ↺/↻ + CANVAS_SIZE 320", () => {
    expect(src).toContain("const CANVAS_SIZE = 320");
    expect(src).toContain("min={0.5} max={3}");
    expect(src).toContain("setRotate(r => r - 90)");
    expect(src).toContain("setRotate(r => r + 90)");
    expect(src).toContain("↺"); expect(src).toContain("↻");
  });

  it("canvas draw: rotate Math.PI/180 + scale zoom + overlay rgba(0,0,0,0.5) + rule-of-thirds", () => {
    expect(src).toContain("rotate * Math.PI) / 180");
    expect(src).toContain("ctx.scale(zoom, zoom)");
    expect(src).toContain("rgba(0,0,0,0.5)");
    expect(src).toContain("crop.w * n / 3");
  });

  it("drag: move vs resize near edge + aspect clamp + export toDataURL jpeg 0.92 + toBlob", () => {
    expect(src).toContain("nearEdge ? 'resize' : 'move'");
    expect(src).toContain("aspectRatio === 'free'");
    expect(src).toContain("newW / (aspectRatio as number)");
    expect(src).toContain("toDataURL('image/jpeg', 0.92)");
    expect(src).toContain("toBlob(blob =>");
  });

  it("UI: Annulla + Ritaglia ✓ + cursor crosshair/grabbing + handles 4 angoli", () => {
    expect(src).toContain("Annulla");
    expect(src).toContain("Ritaglia ✓");
    expect(src).toContain("dragging ? 'grabbing' : 'crosshair'");
    expect(src).toContain("crop.x+crop.w,crop.y+crop.h");
  });
});
