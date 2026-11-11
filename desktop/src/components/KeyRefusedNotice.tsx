import type { AgentStateInfo } from "@/lib/agent-state";
import { appLocale } from "../lib/app-locale";
import type { HarnessOutcome } from "../lib/harness-choice";
import { useKeyRefusedNotice } from "../lib/key-refused";

/**
 * Under the state line of a blocked agent: when the provider refused the API key of the team, why and the command that
 * puts it right (key-refused.ts). Nothing at all for any other agent or state.
 */
export default function KeyRefusedNotice({ state, read, className }: {
  state: AgentStateInfo | null | undefined;
  read?: () => Promise<HarnessOutcome>;
  className?: string;
}) {
  const notice = useKeyRefusedNotice(state, appLocale(), read);
  if (!notice) return null;
  return (
    <p role="note" data-testid="key-refused-notice" className={className ?? "m-0 mt-1 text-[13px] break-words"} style={{ color: "var(--color-red)" }}>
      {notice.text} {notice.action}
    </p>
  );
}
