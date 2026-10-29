import { useEffect, useRef } from "react";
import {
  ASSISTANT_EXPRESSIONS,
  ASSISTANT_PORTRAIT_SRC,
  DEFAULT_ASSISTANT_EXPRESSION,
  expressionFor,
} from "./expressions";
import "./assistant-portrait.css";

/** One settle: the portrait leans in a little and returns, 320 ms, at every new line the Assistant says. */
const SETTLE = [
  { transform: "scale(1.014) translateY(-1px)" },
  { transform: "scale(1) translateY(0)" },
];
const SETTLE_MS = 320;

/**
 * The Assistant's portrait, with the expression it has now. The `expression` is the prop (an agent's
 * emotion as text): an unknown one, `severo` (she has no portrait for it) or none is the neutral face. `line` changes at every new line the Assistant says (a counter, or the line
 * itself) and makes the portrait settle once; the first value does not, the portrait enters instead.
 * Every expression is in the page from the first frame and only one is visible, so a change is a
 * crossfade of the two faces and never a blank or a load. The portrait is decoration: it has no
 * name for a screen reader, whose text is the Assistant's own words beside it.
 */
export default function AssistantPortrait({
  expression = DEFAULT_ASSISTANT_EXPRESSION,
  speaking = false,
  line,
  className,
}: {
  expression?: string | null;
  /** a reply is coming in or has just come: the breathing is livelier */
  speaking?: boolean;
  line?: string | number;
  className?: string;
}) {
  const current = expressionFor(expression);
  const body = useRef<HTMLDivElement>(null);
  const seen = useRef(line);

  useEffect(() => {
    if (seen.current === line) return;
    seen.current = line;
    const node = body.current;
    // No Web Animations (or none wanted): the settle is only a flourish, and the portrait stays as it is.
    if (!node || typeof node.animate !== "function") return;
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    node.animate(SETTLE, { duration: SETTLE_MS, easing: "ease-out" });
  }, [line]);

  return (
    <div
      className={["assistant-portrait", className].filter(Boolean).join(" ")}
      data-testid="assistant-portrait"
      data-expression={current}
      data-speaking={speaking ? "true" : "false"}
      aria-hidden="true"
    >
      <div className="assistant-portrait__body" ref={body}>
        {ASSISTANT_EXPRESSIONS.map((name) => (
          <img
            key={name}
            src={ASSISTANT_PORTRAIT_SRC[name]}
            alt=""
            draggable={false}
            decoding="async"
            data-face={name}
            data-current={name === current ? "true" : "false"}
            className="assistant-portrait__face"
            // the face in view is wanted now; the others are only to be ready for the crossfade
            {...(name === current ? { fetchPriority: "high" as const } : { loading: "lazy" as const })}
          />
        ))}
      </div>
    </div>
  );
}

export { AssistantPortrait };
