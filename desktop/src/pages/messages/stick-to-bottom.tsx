import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * The conversation opens on its latest line and stays there, until the person scrolls up BY HAND (the wheel, a
 * touch, a key, the scroll bar): then nothing moves under their eyes, the new lines are counted, and a round
 * button brings them back down. «At the bottom» survives what makes the list taller or shorter under it (a
 * question card, a resized window, a tab shown again) and every scroll the page itself made; a person who never
 * scrolled away always finds the newest line or card in view.
 */

/** Within how many pixels of the end the list counts as at the bottom. */
export const BOTTOM_SLACK_PX = 24;

export interface ScrollMeasures {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export function distanceFromBottom(m: ScrollMeasures): number {
  return Math.max(0, m.scrollHeight - m.clientHeight - m.scrollTop);
}

/** After a scroll: at the bottom when it got there; no longer at the bottom only when the person went UP. */
export function afterScroll(atBottom: boolean, previousTop: number, m: ScrollMeasures): boolean {
  if (distanceFromBottom(m) <= BOTTOM_SLACK_PX) return true;
  return m.scrollTop < previousTop - 1 ? false : atBottom;
}

/** How long after the person's last wheel, touch or key a scroll still counts as theirs. */
export const GESTURE_MS = 1000;

/** The gestures that move a list by hand; a scroll with none of them behind it was the page's own (a clamp, an anchor, our own jump). */
const GESTURE_EVENTS = ["wheel", "touchmove", "keydown"] as const;

/** How many new lines to count when the last one changes: none at the bottom, else how many came (at least one). */
export function arrivedSince(atBottom: boolean, countBefore: number, countNow: number): number {
  return atBottom ? 0 : Math.max(1, countNow - countBefore);
}

export interface StickToBottom {
  /** on the scrolling container */
  ref: (node: HTMLElement | null) => void;
  atBottom: boolean;
  /** lines that came while the person was reading above */
  unseen: number;
  onScroll: () => void;
  /** the button: down to the latest line, smoothly */
  jump: () => void;
}

/**
 * `conversation` changes when another chat opens in the same place: back to the bottom. `last` is
 * the key of the latest line, `count` how many lines there are.
 */
export function useStickToBottom({ conversation, last, count }: { conversation: string; last: string | null; count: number }): StickToBottom {
  const container = useRef<HTMLElement | null>(null);
  const [node, setNode] = useState<HTMLElement | null>(null);
  const ref = useCallback((next: HTMLElement | null) => {
    container.current = next;
    setNode(next);
  }, []);
  const bottom = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const previousTop = useRef(0);
  const before = useRef({ last, count });
  // the person's hand on the list: a gesture just made, or the scroll bar held down
  const gestureAt = useRef(0);
  const holding = useRef(false);

  const mark = useCallback((value: boolean) => {
    bottom.current = value;
    setAtBottom(value);
    if (value) setUnseen(0);
  }, []);

  const stick = useCallback(() => {
    const c = container.current;
    if (!c) return;
    c.scrollTop = c.scrollHeight;
    previousTop.current = c.scrollTop;
  }, []);

  // another conversation in the same place: at the bottom again
  useLayoutEffect(() => {
    mark(true);
    before.current = { last, count };
    stick();
    // only when the conversation changes: `last` and `count` are followed below
  }, [conversation, mark, stick]);

  // a container that appears later starts from the bottom, if the person was there
  useLayoutEffect(() => {
    if (node && bottom.current) stick();
  }, [node, stick]);

  // a new line or card (even one that lands before the last, by its time): at the bottom it stays in view, above it is counted
  useLayoutEffect(() => {
    const prev = before.current;
    before.current = { last, count };
    if (last === prev.last && count === prev.count) return;
    if (bottom.current) stick();
    else if (count > prev.count || last !== prev.last) setUnseen((n) => n + arrivedSince(false, prev.count, count));
  }, [last, count, stick]);

  // the person's own gestures: only they can take the list away from the bottom
  useEffect(() => {
    if (!node) return;
    const touched = () => {
      gestureAt.current = Date.now();
    };
    const down = () => {
      holding.current = true;
      touched();
    };
    const up = () => {
      holding.current = false;
      touched();
    };
    for (const name of GESTURE_EVENTS) node.addEventListener(name, touched, { passive: true });
    node.addEventListener("pointerdown", down, { passive: true });
    window.addEventListener("pointerup", up, { passive: true });
    window.addEventListener("pointercancel", up, { passive: true });
    return () => {
      for (const name of GESTURE_EVENTS) node.removeEventListener(name, touched);
      node.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [node]);

  // the height changes under it (a card grows, the window is resized): at the bottom it stays there
  useEffect(() => {
    if (!node || typeof ResizeObserver === "undefined") return;
    const resize = new ResizeObserver(() => {
      if (bottom.current) stick();
    });
    const watch = () => {
      resize.disconnect();
      resize.observe(node);
      for (const child of Array.from(node.children)) resize.observe(child);
    };
    watch();
    const children = typeof MutationObserver === "undefined" ? null : new MutationObserver(watch);
    children?.observe(node, { childList: true });
    return () => {
      resize.disconnect();
      children?.disconnect();
    };
  }, [node, stick]);

  const onScroll = useCallback(() => {
    const c = container.current;
    if (!c) return;
    const byHand = holding.current || Date.now() - gestureAt.current < GESTURE_MS;
    const now = afterScroll(bottom.current, previousTop.current, c);
    previousTop.current = c.scrollTop;
    // a scroll the person did not make never takes the list away from the bottom: it is put back
    if (!now && bottom.current && !byHand) {
      stick();
      return;
    }
    if (now !== bottom.current) mark(now);
  }, [mark, stick]);

  const jump = useCallback(() => {
    const c = container.current;
    if (!c) return;
    mark(true);
    if (typeof c.scrollTo === "function") c.scrollTo({ top: c.scrollHeight, behavior: "smooth" });
    else stick();
  }, [mark, stick]);

  return { ref, atBottom, unseen, onScroll, jump };
}

/**
 * The round button, as the LAST child of the scrolling container: a place 0 px high stuck to the
 * bottom of the visible part, with the button over it on the right; it moves nothing.
 */
export function JumpToLatest({ atBottom, unseen, label, onClick }: { atBottom: boolean; unseen: number; label: string; onClick: () => void }) {
  if (atBottom) return null;
  return (
    <div className="sticky bottom-0 h-0 flex justify-end">
      <button
        type="button"
        data-testid="direct-chat-jump"
        onClick={onClick}
        aria-label={label}
        title={label}
        className="relative -top-11 mr-1 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-bright)] shadow"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M8 3v9.5M3.5 8 8 12.5 12.5 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {unseen > 0 && (
          <span
            data-testid="direct-chat-jump-count"
            className="absolute -top-1.5 -right-1.5 min-w-[16px] rounded-full bg-[var(--color-green)] px-1 text-[11px] font-semibold leading-4 text-[var(--color-void)]"
          >
            {unseen > 99 ? "99+" : unseen}
          </span>
        )}
      </button>
    </div>
  );
}
