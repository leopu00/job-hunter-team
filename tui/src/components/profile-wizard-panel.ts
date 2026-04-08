import { Container, Text } from "@mariozechner/pi-tui";
import { theme } from "../tui-theme.js";
import type { ProfileWizardState } from "../tui-types.js";

function formatAnswer(value: string | string[]): string {
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "(vuoto)";
  return value.trim() || "(vuoto)";
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(text.length - max);
}

export class ProfileWizardPanel extends Container {
  refresh(wizard: ProfileWizardState, currentInput: string): void {
    this.clear();

    const current = wizard.steps[wizard.stepIndex];
    const progress = `${wizard.stepIndex + 1}/${wizard.steps.length}`;
    const currentValue = wizard.draft[current.field];
    const fallback = formatAnswer(currentValue) === "(vuoto)" ? "" : formatAnswer(currentValue);
    const displayValue = currentInput.length > 0 ? currentInput : fallback;
    const cursor = currentInput.length > 0 ? "█" : "";
    const contentWidth = 42;
    const padded = truncate(`${displayValue}${cursor}`, contentWidth).padEnd(contentWidth, " ");

    this.add(theme.header("  ■ CONFIGURA PROFILO"));
    this.add(theme.border("  " + "─".repeat(60)));
    this.add("");
    this.add(`  ${theme.accent(current.title)} ${theme.dim("· " + progress)}`);
    this.add("");
    this.add(`  ${theme.text(current.question)}`);
    this.add("");
    this.add(`  ${theme.border("┌" + "─".repeat(contentWidth + 2) + "┐")}`);
    this.add(`  ${theme.border("│")} ${theme.text(padded)} ${theme.border("│")}`);
    this.add(`  ${theme.border("└" + "─".repeat(contentWidth + 2) + "┘")}`);

    if (wizard.lastMessage) {
      this.add("");
      this.add(theme.warning(`  ${wizard.lastMessage}`));
    }
  }

  private add(text: string) {
    this.addChild(new Text(text, 0, 0));
  }
}
