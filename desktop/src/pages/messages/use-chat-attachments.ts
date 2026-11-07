import { useEffect } from "react";
import { outcomeOf } from "./chat-kinds";
import { withName } from "./direct-chat.i18n";
import { clientMessageId, errorCode } from "./direct-chat-screen-helpers";
import type { ChatContext } from "./direct-chat-screen-context";

export function useChatAttachments(ctx: ChatContext & { attachHere: boolean }) {
  const { agentId, attachHere, status, writeLocked, client, setAttachNote, setAttachState } = ctx;
  // The paperclip asks the native side whether it can be used (this computer's team, writing allowed);
  // another agent, or no connection, has none. A note about a file belongs to the chat it was made in.
  useEffect(() => {
    setAttachNote(null);
  }, [agentId]);
  useEffect(() => {
    if (!attachHere || status.state !== "ready") {
      setAttachState(null);
      return;
    }
    let active = true;
    Promise.resolve(client.attachState?.())
      .then((next) => {
        if (active) setAttachState(next ?? { available: false });
      })
      .catch(() => {
        // the bridge could not say: the button stays off, with no reason to give
        if (active) setAttachState({ available: false });
      });
    return () => {
      active = false;
    };
  }, [attachHere, status.state, writeLocked, client]);

}
export function attachmentAction(ctx: ChatContext) {
  const { client, attaching, sending, writeLocked, status, attachState, setAttaching,
    setAttachNote, locale, setOutcomes, readSoon, t } = ctx;
  // Choose a file in the system's window and give it to the Assistant: the app copies it into the team's
  // folder and tells the Assistant; this page never sees a path.
  async function attachFile() {
    if (!client.attach || attaching || sending || writeLocked || status.state !== "ready" || !attachState?.available) return;
    setAttaching(true);
    setAttachNote(null);
    try {
      const done = await client.attach({ clientMessageId: clientMessageId(), locale });
      if (done.outcome === "sent") {
        // The message left on its own: it is a bubble in the conversation, and its delivery (taken, waiting,
        // not known) is said under it as for any message. No line under the composer: nothing is left to say.
        const receipt = done.receipt;
        if (receipt) setOutcomes((current) => new Map(current).set(receipt.messageId, outcomeOf(receipt, 0)));
        readSoon.current?.();
      } else if (done.outcome === "saved_not_sent") {
        setAttachNote({ kind: "warn", text: withName(t.attachSavedNotSent, done.displayName ?? "") });
      }
    } catch (error) {
      const code = errorCode(error);
      const words: Record<string, string> = { ...t.attachOff, ...t.attachErrors };
      const said = code !== null && Object.prototype.hasOwnProperty.call(words, code) ? words[code] : null;
      setAttachNote({ kind: "error", text: said ?? t.attachErrors.attach_failed });
    } finally {
      setAttaching(false);
    }
  }

  return attachFile;
}
