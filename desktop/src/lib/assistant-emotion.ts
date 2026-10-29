/**
 * The mood tag an agent may put at the very start of a message in the app's chat («[caldo] Welcome!»): the avatar
 * shows it as an expression and the text shown never carries it. The list is closed (the same words as the game's
 * dialogues); anything else stays text.
 */
export const EMOTIONS = ["neutro", "caldo", "divertito", "severo", "pensieroso", "sorpreso"] as const;

export type Emotion = (typeof EMOTIONS)[number];

const LEADING_TAG = /^\s*\[([a-z]+)\](?!\()[ \t]*/;

/**
 * `{ emotion, text }` of a message from the agent: a leading tag of the closed list is taken out (and its spaces),
 * ONE only. A tag out of the list, in the middle of the text, in capitals, or a second tag, is left as written and
 * `emotion` is null. Never throws, never returns an empty string for a non-empty message with a tag and text.
 */
export function splitEmotion(text: string): { emotion: Emotion | null; text: string } {
  const found = LEADING_TAG.exec(text);
  const word = found?.[1];
  if (!found || !word || !(EMOTIONS as readonly string[]).includes(word)) return { emotion: null, text };
  return { emotion: word as Emotion, text: text.slice(found[0].length) };
}
