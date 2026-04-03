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

// ChatPanel aggiunto nel prossimo commit
export { UserMessage, AssistantMessage, ToolMessage };
