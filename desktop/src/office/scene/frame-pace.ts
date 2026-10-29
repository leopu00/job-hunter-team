/**
 * How often and how sharp the office is drawn. A scene that redraws every agent, bubble, tag and pile at the
 * display's rate (120 Hz on a recent Mac, on a canvas of two device pixels per pixel) kept a third of a core busy
 * at rest, and went on drawing for a window nobody could see: the office draws at most 30 frames a second, no
 * sharper than 1.5 device pixels per pixel, and not at all while the window is hidden.
 */
export const OFFICE_MAX_FPS = 30;
export const OFFICE_MAX_RESOLUTION = 1.5;

/** The scene's resolution for a display's pixel ratio: never under one, never over the cap. */
export function sceneResolution(devicePixelRatio: number | undefined): number {
  const ratio = Number.isFinite(devicePixelRatio) && (devicePixelRatio as number) > 0 ? (devicePixelRatio as number) : 1;
  return Math.min(Math.max(ratio, 1), OFFICE_MAX_RESOLUTION);
}

/** The part of a Pixi ticker the pause needs. */
export interface PausableTicker {
  started: boolean;
  start(): void;
  stop(): void;
}

/**
 * Stops the tickers while the page is hidden and starts again the ones this stopped when it is shown. A ticker that
 * was not running is never started by it. Returns the way to stop watching (a ticker it stopped is started again).
 */
export function pauseWhenHidden(tickers: PausableTicker[], doc: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener"> = document): () => void {
  const paused = new Set<PausableTicker>();
  const apply = () => {
    if (doc.visibilityState === "hidden") {
      for (const ticker of tickers) {
        if (ticker.started) {
          ticker.stop();
          paused.add(ticker);
        }
      }
    } else {
      for (const ticker of paused) ticker.start();
      paused.clear();
    }
  };
  doc.addEventListener("visibilitychange", apply);
  apply();
  return () => {
    doc.removeEventListener("visibilitychange", apply);
    for (const ticker of paused) ticker.start();
    paused.clear();
  };
}
