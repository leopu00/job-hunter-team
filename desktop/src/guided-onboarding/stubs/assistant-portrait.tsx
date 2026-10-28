/**
 * STAND-IN for desktop/src/components/assistant-portrait: the props of its contract (`expression` is the
 * agent's emotion, any string; unknown or null is neutral). The real one replaces this by changing one import
 * in ../deps.ts.
 */
export function AssistantPortrait({
  expression,
  speaking,
  className,
}: {
  expression?: string | null;
  speaking?: boolean;
  line?: string | number;
  className?: string;
}) {
  return (
    <div className={className} data-testid="assistant-portrait-stub" data-expression={expression ?? "neutro"} data-speaking={speaking ? "true" : "false"} aria-hidden="true">
      AI
    </div>
  );
}
