/**
 * The Assistant's expressions: one painted portrait per emotion, the same five the game has
 * (game/assets/gen-art/portraits/assistente). The names are the game's, in Italian, because they are
 * ids: the tag an agent's line may start with is one of these, and no text of the app shows them.
 */
export const ASSISTANT_EXPRESSIONS = ["neutro", "caldo", "divertito", "pensieroso", "sorpreso"] as const;

export type AssistantExpression = (typeof ASSISTANT_EXPRESSIONS)[number];

export const DEFAULT_ASSISTANT_EXPRESSION: AssistantExpression = "neutro";

/** The portraits, resized and converted to WebP with their transparency (640 px wide, ~75 KB each). */
export const ASSISTANT_PORTRAIT_SRC: Record<AssistantExpression, string> = {
  neutro: "/assistant/portrait-neutro.webp",
  caldo: "/assistant/portrait-caldo.webp",
  divertito: "/assistant/portrait-divertito.webp",
  pensieroso: "/assistant/portrait-pensieroso.webp",
  sorpreso: "/assistant/portrait-sorpreso.webp",
};

export function isAssistantExpression(value: unknown): value is AssistantExpression {
  return typeof value === "string" && (ASSISTANT_EXPRESSIONS as readonly string[]).includes(value);
}

/**
 * Emotions the agent's line may carry that the Assistant has no portrait for: the game has `severo`
 * for other roles, not for her. The face is the neutral one, and no image is made up.
 */
const NO_PORTRAIT_FOR: Readonly<Record<string, AssistantExpression>> = { severo: "neutro" };

/** The expression to show for an emotion given as text (an agent's tag): unknown, empty or null is neutral. */
export function expressionFor(emotion: string | null | undefined): AssistantExpression {
  if (isAssistantExpression(emotion)) return emotion;
  return (emotion && NO_PORTRAIT_FOR[emotion]) || DEFAULT_ASSISTANT_EXPRESSION;
}
