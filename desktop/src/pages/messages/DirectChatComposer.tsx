import type { ChatScreenModel } from "./use-direct-chat-screen-model";
import { DICTATION_LOCALE, withName } from "./direct-chat.i18n";
import { excerpt } from "./chat-kinds";
import { newLineAt } from "./direct-chat-screen-helpers";
import { VoiceInputControl } from "../../voice-input";
const MAX_MESSAGE_LENGTH = 4_000;
function ReplyPreview({ m }: { m: ChatScreenModel }) {
  const { target, t, setReplyTo, setAnswerRefusal } = m;
  return (
    <>
      {target && (
        <div
          data-testid="direct-chat-reply-to"
          data-answer={target.kind === "question" && target.words ? "true" : undefined}
          className="w-full mb-1.5 flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1 text-[14px]"
        >
          <span className="shrink-0 text-[var(--color-muted)]">
            {target.kind === "question" && target.words ? t.replyingToQuestion : t.replyingTo}
          </span>
          <b className="min-w-0 flex-1 truncate font-semibold text-[var(--color-base)]" title={target.text}>
            {excerpt(target.text)}
          </b>
          <button
            type="button"
            data-testid="direct-chat-reply-clear"
            aria-label={t.replyClear}
            title={t.replyClear}
            onClick={() => {
              setReplyTo(null);
              setAnswerRefusal(null);
            }}
            className="shrink-0 px-1 text-[14px] leading-none text-[var(--color-muted)]"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
function ComposerNotes({ m }: { m: ChatScreenModel }) {
  const { answerRefusal, attachHere, attachState, t, attachNote, agentOff, writeLocked, selected } = m;
  return (
    <>
      {answerRefusal && (
        <p role="alert" data-testid="direct-chat-answer-refused" className="w-full m-0 mb-1.5 text-[14px] text-[var(--color-red)]">
          {answerRefusal}
        </p>
      )}
      {attachHere && attachState && !attachState.available && attachState.code && attachState.code in t.attachOff && (
        <p data-testid="direct-chat-attach-off" className="w-full m-0 mb-1.5 text-[14px] text-[var(--color-muted)]">
          {t.attachOff[attachState.code as keyof typeof t.attachOff]}
        </p>
      )}
      {attachNote && (
        <p
          role="alert"
          data-testid="direct-chat-attach-note"
          data-kind={attachNote.kind}
          className={`w-full m-0 mb-1.5 text-[14px] ${attachNote.kind === "warn" ? "text-[var(--color-yellow)]" : "text-[var(--color-red)]"}`}
        >
          {attachNote.text}
        </p>
      )}
      {agentOff && !writeLocked && (
        // the box is one line: on a narrow window the reason would be cut in its placeholder, so it is said here
        <p data-testid="direct-chat-agent-off" className="w-full m-0 mb-1.5 text-[14px] text-[var(--color-muted)]">
          {withName(t.agentOff, selected.label)}
        </p>
      )}
    </>
  );
}
function ComposerInput({ m }: { m: ChatScreenModel }) {
  const { composer, text, sendError, clearOperationError, setText, cursorAfterNewLine, send, composerOff, t, selected, writeLocked, agentOff, status } = m;
  return (
    <textarea
      ref={composer}
      value={text}
      onChange={(event) => {
        if (sendError.current) clearOperationError();
        setText(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.ctrlKey) {
          event.preventDefault();
          const node = event.currentTarget;
          const next = newLineAt(text, node.selectionStart, node.selectionEnd);
          cursorAfterNewLine.current = next.cursor;
          setText(next.value);
          return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          void send();
        }
      }}
      rows={1}
      maxLength={MAX_MESSAGE_LENGTH}
      disabled={composerOff}
      aria-label={withName(t.writeTo, selected.label)}
      placeholder={
        writeLocked
          ? t.readOnlyInvite
          : agentOff
            ? withName(t.agentOff, selected.label)
            : status.state === "ready" ? withName(t.writeToPlaceholder, selected.label) : t.connectToWrite
      }
      className={`max-h-28 min-h-8 w-full min-w-0 flex-[1_1_16rem] resize-none border-0 bg-transparent px-1 py-1.5 text-[15px] text-[var(--color-base)] outline-none disabled:opacity-50 sm:min-w-48${agentOff && !writeLocked ? " placeholder:text-transparent" : ""}`}
    />
  );
}
function AttachmentButton({ m }: { m: ChatScreenModel }) {
  const { attachHere, t, attachState, composerOff, attaching, attachFile } = m;
  return (
    <>
      {attachHere && (
        <button
          type="button"
          data-testid="direct-chat-attach"
          aria-label={t.attach}
          title={attachState && !attachState.available && attachState.code && attachState.code in t.attachOff ? t.attachOff[attachState.code as keyof typeof t.attachOff] : t.attach}
          disabled={composerOff || attaching || !attachState?.available}
          onClick={() => void attachFile()}
          className="h-8 shrink-0 self-end rounded-md border border-[var(--color-border)] px-2 text-[15px] leading-none text-[var(--color-bright)] disabled:cursor-default disabled:opacity-40"
        >
          {attaching ? t.attaching : "📎"}
        </button>
      )}
    </>
  );
}
function ComposerControls({ m }: { m: ChatScreenModel }) {
  const { text, setText, locale, voiceInputBridge, composerOff, canSend, sending, t } = m;
  return (
    <div
      className="w-full flex flex-wrap items-end gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 focus-within:border-[var(--color-border-glow)]"
      data-testid="direct-chat-composer-row"
    >
      <ComposerInput m={m} />
      <AttachmentButton m={m} />
      <VoiceInputControl
        value={text}
        onChange={setText}
        locale={DICTATION_LOCALE[locale]}
        bridge={voiceInputBridge}
        disabled={composerOff}
        className="w-full max-w-full sm:w-auto"
      />
      <button
        type="submit"
        disabled={!canSend}
        className="h-8 shrink-0 self-end rounded-md bg-[var(--color-green)] px-4 text-[14px] font-bold text-[var(--color-void)] disabled:cursor-default disabled:bg-[var(--color-border)] disabled:text-[var(--color-dim)]"
      >
        {sending ? t.sending : t.send}
      </button>
    </div>
  );
}
export function ChatComposer({ m }: { m: ChatScreenModel }) {
  const { send, t, selected } = m;
  return (
    <form
      className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-panel)] px-4 sm:px-6 py-3"
      data-testid="direct-chat-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <p
        data-testid="direct-chat-destination"
        // Said to a screen reader, not shown: where the text goes is a detail of the transport, not a line the person must read
        className="sr-only"
      >
        {withName(t.destination, selected.label)}
      </p>
      <ReplyPreview m={m} />
      <ComposerNotes m={m} />
      <ComposerControls m={m} />
      <p data-testid="direct-chat-keys" className="w-full m-0 mt-1 text-[14px] text-[var(--color-dim)]">
        {t.keysHint}
      </p>
    </form>
  );
}
export function ReadOnlyInvite({ m }: { m: ChatScreenModel }) {
  const { writeLocked, t, onConnect } = m;
  return (
    <>
      {writeLocked && (
        <p
          role="note"
          data-testid="direct-chat-read-only-invite"
          className="shrink-0 m-0 border-t border-[var(--color-border)] bg-[var(--color-panel)] px-4 sm:px-6 py-2 text-[14px] text-[var(--color-muted)] flex flex-wrap items-center gap-3"
        >
          <span>{t.readOnlyInvite}</span>
          {onConnect && (
            <button
              type="button"
              onClick={onConnect}
              className="shrink-0 rounded border border-[var(--color-border)] px-3 py-1 text-[14px] font-semibold text-[var(--color-bright)]"
            >
              {t.readOnlyConnect}
            </button>
          )}
        </p>
      )}
    </>
  );
}
