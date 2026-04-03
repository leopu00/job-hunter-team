import { Box, Container, Spacer, Text } from "@mariozechner/pi-tui";

const DIM = "\x1b[2m", BOLD = "\x1b[1m", RESET = "\x1b[0m";
const FG_CYAN = "\x1b[36m", FG_YELLOW = "\x1b[33m", FG_RED = "\x1b[31m";
const BG_GRAY = "\x1b[48;5;236m";

const dim = (s: string) => `${DIM}${s}${RESET}`;
const bold = (s: string) => `${BOLD}${s}${RESET}`;
const systemFg = (s: string) => `${DIM}${FG_CYAN}${s}${RESET}`;
const userBg = (s: string) => `${BG_GRAY}${s}${RESET}`;
const toolOk = (s: string) => `${FG_YELLOW}${s}${RESET}`;
const toolErr = (s: string) => `${FG_RED}${s}${RESET}`;
const toolPending = (s: string) => `${DIM}${s}${RESET}`;

class UserMessage extends Container {
  private body: Text;
  constructor(text: string) {
    super();
    this.body = new Text(userBg(text), 0, 0);
    this.addChild(new Spacer(1));
    this.addChild(new Text(dim("you"), 0, 0));
    this.addChild(this.body);
  }
  setText(t: string) { this.body.setText(userBg(t)); }
}

class AssistantMessage extends Container {
  private body: Text;
  constructor(text: string) {
    super();
    this.body = new Text(text, 0, 0);
    this.addChild(new Spacer(1));
    this.addChild(this.body);
  }
  setText(t: string) { this.body.setText(t); }
}

class ToolMessage extends Container {
  private header: Text;
  private output: Text;
  private isError = false;
  private isPartial = true;
  private name: string;

  constructor(toolName: string) {
    super();
    this.name = toolName;
    this.header = new Text("", 0, 0);
    this.output = new Text("", 0, 0);
    const box = new Box(1, 1, (l) => toolPending(l));
    box.addChild(this.header); box.addChild(this.output);
    this.addChild(new Spacer(1)); this.addChild(box);
    this.refresh();
  }

  private refresh() {
    const label = `${bold(this.name)}${this.isPartial ? " (running)" : ""}`;
    this.header.setText(this.isError ? toolErr(label) : toolOk(label));
  }

  setResult(text: string, opts?: { isError?: boolean }) {
    this.isPartial = false; this.isError = Boolean(opts?.isError);
    this.output.setText(dim(text.slice(0, 500))); this.refresh();
  }

  setPartialResult(text: string) { this.output.setText(dim(text)); }
}

export class ChatPanel extends Container {
  private readonly max: number;
  private assistantRuns = new Map<string, AssistantMessage>();
  private toolsById = new Map<string, ToolMessage>();

  constructor(max = 180) { super(); this.max = Math.max(20, max); }

  private append(c: Container) {
    this.addChild(c);
    while (this.children.length > this.max) {
      const old = this.children[0];
      if (!old) break;
      this.removeChild(old);
      for (const [k, v] of this.assistantRuns) { if (v === old) { this.assistantRuns.delete(k); break; } }
      for (const [k, v] of this.toolsById) { if (v === old) { this.toolsById.delete(k); break; } }
    }
  }

  clearAll() { this.clear(); this.assistantRuns.clear(); this.toolsById.clear(); }

  addSystem(text: string) {
    const e = new Container();
    e.addChild(new Spacer(1)); e.addChild(new Text(systemFg(text), 1, 0)); this.append(e);
  }

  addUser(text: string) { this.append(new UserMessage(text)); }

  updateAssistant(text: string, runId: string) {
    const e = this.assistantRuns.get(runId);
    if (e) { e.setText(text); return; }
    const msg = new AssistantMessage(text); this.assistantRuns.set(runId, msg); this.append(msg);
  }

  finalizeAssistant(text: string, runId: string) {
    const e = this.assistantRuns.get(runId);
    if (e) { e.setText(text); this.assistantRuns.delete(runId); return; }
    this.append(new AssistantMessage(text));
  }

  dropAssistant(runId: string) {
    const e = this.assistantRuns.get(runId);
    if (!e) return; this.removeChild(e); this.assistantRuns.delete(runId);
  }

  startTool(toolCallId: string, toolName: string, _args: unknown) {
    if (this.toolsById.has(toolCallId)) return this.toolsById.get(toolCallId)!;
    const t = new ToolMessage(toolName); this.toolsById.set(toolCallId, t); this.append(t); return t;
  }

  updateToolResult(id: string, result: unknown, opts?: { partial?: boolean; isError?: boolean }) {
    const t = this.toolsById.get(id); if (!t) return;
    const text = typeof result === "string" ? result : JSON.stringify(result ?? "");
    if (opts?.partial) t.setPartialResult(text); else t.setResult(text, { isError: opts?.isError });
  }

  setToolsExpanded(_expanded: boolean) { /* future: collapse/expand tool output */ }
}

export { UserMessage, AssistantMessage, ToolMessage };
