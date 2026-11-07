import type { ChatScreenModel } from "./use-direct-chat-screen-model";
import { Fragment } from "react";
import { dayLabel } from "./chat-kinds";
import { DICTATION_LOCALE, withName } from "./direct-chat.i18n";
import ChatQuestion from "./ChatQuestion";
import { ChatMessageRow } from "./ChatMessageRow";
import { JumpToLatest } from "./stick-to-bottom";
function MessageRow({ m, item }: { m: ChatScreenModel; item: ChatScreenModel["items"][number] }) {
  const { t, selected, dateLocale, replyTo, inFlight, outcomes, enterAvailable, pressing, suggestionsOff, answeredIds, unansweredIds, onMenu, onSend, onEnterAgain } = m;
  if (item.type !== "message") return null;
  return (
    <ChatMessageRow
      message={item.message}
      repeated={item.repeated}
      t={t}
      agentLabel={selected.label}
      dateLocale={dateLocale}
      quoted={replyTo?.kind === "message" && replyTo.id === item.message.id}
      inFlight={item.message.id === inFlight}
      outcome={item.message.role === "user" ? outcomes.get(item.message.id) : undefined}
      enterAvailable={enterAvailable}
      pressingThis={pressing === item.message.id}
      pressingAny={pressing !== null}
      suggestionsOff={item.message.suggestions ? suggestionsOff : false}
      answered={item.message.role === "user" && answeredIds.has(item.message.id)}
      unanswered={item.message.role === "user" && unansweredIds.has(item.message.id)}
      onMenu={onMenu}
      onSend={onSend}
      onEnterAgain={onEnterAgain}
    />
  );
}
function QuestionRow({ m, item }: { m: ChatScreenModel; item: ChatScreenModel["items"][number] }) {
  const { selected, t, locale, canAnswer, replyTo, answer, writeLocked, replyFromMenu, openMenu } = m;
  if (item.type !== "question") return null;
  return (
    <ChatQuestion
      question={item.question}
      agentName={selected.label}
      t={t}
      dateLocale={DICTATION_LOCALE[locale]}
      canAnswer={canAnswer}
      quoted={replyTo?.kind === "question" && replyTo.id === item.question.id}
      onAnswer={(choices, words) => answer(item.question.id, choices, words)}
      onAnswerInWords={writeLocked ? undefined : () => replyFromMenu("question", item.question.id)}
      onMenu={writeLocked ? undefined : (event) => openMenu("question", item.question.id, event)}
    />
  );
}
function TranscriptItem({ m, item, newDay }: { m: ChatScreenModel; item: ChatScreenModel["items"][number]; newDay: boolean }) {
  const { t, locale } = m;
  return (
    <Fragment key={item.key}>
      {newDay && (
        <div
          role="separator"
          data-testid="direct-chat-day"
          className="self-center py-1 text-[14px] font-semibold uppercase tracking-wider text-[var(--color-dim)]"
        >
          {dayLabel(item.at, t, DICTATION_LOCALE[locale])}
        </div>
      )}
      {item.type === "question" ? (
        <QuestionRow m={m} item={item} />
      ) : (
        <MessageRow m={m} item={item} />
      )}
    </Fragment>
  );
}
function WorkingIndicator({ m }: { m: ChatScreenModel }) {
  const { sight, status, t, selected } = m;
  return (
    <>
      {sight.working && status.state === "ready" && (
        <div role="status" data-testid="direct-chat-working" className="flex items-center gap-2 text-[14px] text-[var(--color-muted)]">
          <span aria-hidden="true" className="inline-flex items-center gap-1">
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                className="h-1.5 w-1.5 rounded-full bg-[var(--color-muted)] animate-pulse motion-reduce:animate-none"
                style={{ animationDelay: `${dot * 200}ms` }}
              />
            ))}
          </span>
          <span>{withName(t.working, selected.label)}</span>
        </div>
      )}
    </>
  );
}
export function ChatTranscript({ m }: { m: ChatScreenModel }) {
  const { bottom, t, selected, loading, items, newDays } = m;
  return (
    <div
      ref={bottom.ref}
      onScroll={bottom.onScroll}
      role="log"
      aria-label={withName(t.messagesWith, selected.label)}
      aria-live="polite"
      className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-6 py-5"
      data-testid="direct-chat-transcript"
    >
      <div className="w-full flex flex-col gap-3">
        {loading && items.length === 0 && (
          <p role="status" className="m-0 py-8 text-center text-[14px] text-[var(--color-muted)]">{t.loadingConversation}</p>
        )}
        {!loading && items.length === 0 && (
          <p className="m-0 py-8 text-center text-[14px] text-[var(--color-muted)]">{t.empty}</p>
        )}
        {items.map((item, index) => <TranscriptItem key={item.key} m={m} item={item} newDay={newDays[index]} />)}
        <WorkingIndicator m={m} />
      </div>
      <JumpToLatest
        atBottom={bottom.atBottom}
        unseen={bottom.unseen}
        label={bottom.unseen > 0 ? t.jumpToNew.replace("{count}", String(bottom.unseen)) : t.jumpToLatest}
        onClick={bottom.jump}
      />
    </div>
  );
}
export function ChatReplyMenu({ m }: { m: ChatScreenModel }) {
  const { menu, t, replyFromMenu } = m;
  return (
    <>
      {menu && (
        <div
          role="menu"
          aria-label={t.replyAction}
          data-testid="direct-chat-menu"
          className="fixed z-50 min-w-32 rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] py-1 shadow-lg"
          style={{ left: menu.x, top: menu.y }}
          // a pointerdown inside the menu must not close it before the click
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            autoFocus
            data-testid="direct-chat-menu-reply"
            onClick={() => replyFromMenu(menu.kind, menu.id)}
            className="block w-full px-3 py-1.5 text-left text-[14px] text-[var(--color-bright)] hover:bg-[var(--color-card)]"
          >
            {t.replyAction}
          </button>
        </div>
      )}
    </>
  );
}
