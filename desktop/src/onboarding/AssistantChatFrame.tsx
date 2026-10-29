import type { CSSProperties, ReactNode } from "react";

/**
 * The window-tall frame of the Assistant's chat during the onboarding. The chat takes «all the height it is
 * given» (a percentage), which only means something when the frame HAS a height: without one the chat was as tall
 * as its content (about 600 px before the first message) and, once it had more, the whole window scrolled instead
 * of the conversation, so a new card could stay out of sight. Same measure as the Shell's full-bleed column.
 */
export const ASSISTANT_CHAT_FRAME: CSSProperties = {
  height: "calc(100svh / var(--zoom, 1))",
  overflow: "hidden",
};

export function AssistantChatFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <main data-testid="onboarding-assistant-chat" aria-label={label} style={ASSISTANT_CHAT_FRAME}>
      {children}
    </main>
  );
}
