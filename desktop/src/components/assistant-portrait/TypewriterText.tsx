import { useRef } from "react";
import { useTypewriter } from "./useTypewriter";

const SR_ONLY = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;

/**
 * A line written as a typewriter does, for the Assistant's words. While it is written the whole line
 * is in the page for a screen reader (the animated copy is hidden from it, so it is not read letter by
 * letter); once written it is plain text. A click on the line shows the rest at once.
 */
export default function TypewriterText({
  text,
  enabled = true,
  className,
  onDone,
}: {
  text: string;
  enabled?: boolean;
  className?: string;
  /** called once when the whole line is shown */
  onDone?: () => void;
}) {
  const { shown, done, skip } = useTypewriter(text, { enabled });
  const told = useRef("");
  if (done && told.current !== text) {
    told.current = text;
    onDone?.();
  }
  // Whole: the text is there once, as any text is. Writing: the full line for a screen reader, and the part
  // written so far for the eyes, which the reader skips so it is not read letter by letter.
  if (done) return <span className={className} data-testid="typewriter" data-done="true">{text}</span>;
  return (
    <span className={className} data-testid="typewriter" data-done="false" onClick={skip}>
      <span style={SR_ONLY}>{text}</span>
      <span aria-hidden="true">{shown}</span>
    </span>
  );
}
