type RunState = {
  contentText: string;
  thinkingText: string;
  displayText: string;
};

function extractContent(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const record = message as Record<string, unknown>;
  if (typeof record.content === "string") return record.content.trim();
  if (!Array.isArray(record.content)) return "";
  return record.content
    .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => (b.text as string).trim())
    .filter(Boolean)
    .join("\n");
}

function extractThinking(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const record = message as Record<string, unknown>;
  if (!Array.isArray(record.content)) return "";
  return record.content
    .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
    .filter((b) => b.type === "thinking" && typeof b.thinking === "string")
    .map((b) => (b.thinking as string).trim())
    .filter(Boolean)
    .join("\n");
}

function composeDisplay(params: {
  contentText: string;
  thinkingText: string;
  showThinking: boolean;
}): string {
  if (params.showThinking && params.thinkingText) {
    return `<think>\n${params.thinkingText}\n</think>\n\n${params.contentText}`.trim();
  }
  return params.contentText;
}

export class TuiStreamAssembler {
  private runs = new Map<string, RunState>();

  private getOrCreate(runId: string): RunState {
    let state = this.runs.get(runId);
    if (!state) {
      state = { contentText: "", thinkingText: "", displayText: "" };
      this.runs.set(runId, state);
    }
    return state;
  }

  ingestDelta(runId: string, message: unknown, showThinking: boolean): string | null {
    const state = this.getOrCreate(runId);
    const content = extractContent(message);
    const thinking = extractThinking(message);
    if (content) state.contentText = content;
    if (thinking) state.thinkingText = thinking;
    const next = composeDisplay({ contentText: state.contentText, thinkingText: state.thinkingText, showThinking });
    if (!next || next === state.displayText) return null;
    state.displayText = next;
    return next;
  }

  finalize(runId: string, message: unknown, showThinking: boolean, errorMessage?: string): string {
    const state = this.getOrCreate(runId);
    const content = extractContent(message) || state.contentText;
    const thinking = extractThinking(message) || state.thinkingText;
    const text = composeDisplay({ contentText: content, thinkingText: thinking, showThinking });
    this.runs.delete(runId);
    if (!text && errorMessage) return `error: ${errorMessage}`;
    return text || "(no output)";
  }

  drop(runId: string) {
    this.runs.delete(runId);
  }
}
