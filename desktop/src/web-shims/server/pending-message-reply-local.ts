/**
 * Stand-in for web/lib/pending-message-reply-local.ts, the reply written into
 * the local SQLite workspace. The desktop shell takes the cloud branch
 * (isLocalRequest() is false), so this never runs; if it did, it must not
 * pretend to have saved anything.
 */
export function replyPendingMessageLocal(_id: string, _reply: string): boolean {
  throw new Error("replyPendingMessageLocal: the desktop has no local workspace");
}
