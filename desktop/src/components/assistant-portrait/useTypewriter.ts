import { useEffect, useRef, useState } from "react";

/** Characters a second: a line is read as it comes, about the pace of the game's dialogue box. */
export const TYPEWRITER_CHARS_PER_SECOND = 55;
const FRAME_MS = 1000 / 30;

function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The text as a typewriter writes it: the part of `text` shown so far, and `done`. A new `text`
 * starts again from nothing; `skip()` shows the rest at once. With `enabled` false, or for a person
 * who asked the system for less motion, the whole text is there from the first frame. Characters
 * are counted as people see them (a letter with an accent, an emoji, is one), never cut in two.
 */
export function useTypewriter(
  text: string,
  { enabled = true, charsPerSecond = TYPEWRITER_CHARS_PER_SECOND }: { enabled?: boolean; charsPerSecond?: number } = {},
): { shown: string; done: boolean; skip: () => void } {
  const letters = Array.from(text);
  const total = letters.length;
  const instant = !enabled || charsPerSecond <= 0 || reducedMotion();
  // what was shown, and of which text: a new text is read as nothing shown yet, in its very first frame
  const [progress, setProgress] = useState({ text, count: 0 });
  const count = instant ? total : progress.text === text ? Math.min(progress.count, total) : 0;
  // set by skip(): the timer of that text has nothing left to write
  const skipped = useRef(false);

  useEffect(() => {
    if (instant || total === 0) return;
    skipped.current = false;
    const start = Date.now();
    const tick = window.setInterval(() => {
      if (skipped.current) return void window.clearInterval(tick);
      const next = Math.min(total, Math.floor(((Date.now() - start) / 1000) * charsPerSecond));
      // never back: a tick that lands after the rest was shown must not take it away
      setProgress((p) => ({ text, count: Math.max(p.text === text ? p.count : 0, next) }));
      if (next >= total) window.clearInterval(tick);
    }, FRAME_MS);
    return () => window.clearInterval(tick);
  }, [text, total, instant, charsPerSecond]);

  return {
    shown: letters.slice(0, count).join(""),
    done: count >= total,
    skip: () => {
      skipped.current = true;
      setProgress({ text, count: total });
    },
  };
}
