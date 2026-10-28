import { describe, expect, it } from "vitest";
import { DIRECT_CHAT_TEXT } from "./direct-chat.i18n";
import { TAKEN_REASONS } from "./chat-kinds";

describe("the direct chat's words for a turn that waits and a turn nobody took", () => {
  const locales = Object.keys(DIRECT_CHAT_TEXT) as Array<keyof typeof DIRECT_CHAT_TEXT>;

  it("has all seven languages", () => {
    expect([...locales].sort()).toEqual(["de", "en", "es", "fr", "hu", "it", "pt"]);
  });

  it.each(locales)("%s says «queued» and the not-taken line, and «queued» is not «sent»", (locale) => {
    const t = DIRECT_CHAT_TEXT[locale];
    expect(t.queued.trim()).not.toBe("");
    expect(t.queued).not.toBe(t.sent);
    expect(t.codes.mail_not_taken?.trim()).toBeTruthy();
  });

  it("says the not-taken line in each language, not the backend's English everywhere", () => {
    const english = DIRECT_CHAT_TEXT.en.codes.mail_not_taken;
    for (const locale of locales) {
      if (locale === "en") continue;
      expect(DIRECT_CHAT_TEXT[locale].codes.mail_not_taken).not.toBe(english);
    }
  });
});

describe("the chat's words for the kinds, the questions and the receipts", () => {
  const locales = Object.keys(DIRECT_CHAT_TEXT) as Array<keyof typeof DIRECT_CHAT_TEXT>;

  it.each(locales)("%s has a sentence for every reason of the closed list, and for nothing else", (locale) => {
    const reasons = DIRECT_CHAT_TEXT[locale].takenReasons;
    expect(Object.keys(reasons).sort()).toEqual([...TAKEN_REASONS].sort());
    for (const sentence of Object.values(reasons)) expect(sentence.trim()).not.toBe("");
  });

  it.each(locales)("%s fills every new sentence, and the count goes in the jump label", (locale) => {
    const t = DIRECT_CHAT_TEXT[locale];
    for (const value of [t.sent, t.notSent, t.sendEnterAgain, t.takenUnknown, t.answerSeen, t.answerWaiting, t.answerResolved, t.jumpToLatest, t.answerInWords, t.suggestionsLabel, t.today, t.yesterday, t.replyAction, t.replyingTo, t.replyingToQuestion, t.replyClear, t.quotePrefix, t.answerTextKept]) {
      expect(value.trim()).not.toBe("");
    }
    for (const value of [...Object.values(t.kinds), ...Object.values(t.answerErrors), ...Object.values(t.answerInvalid)]) {
      expect(value.trim()).not.toBe("");
    }
    expect(t.jumpToNew).toContain("{count}");
    expect(t.working).toContain("{name}");
    expect(t.working.replace("{name}", "").trim()).not.toBe("");
    expect(t.sent).not.toBe(t.queued);
  });

  it("says them in each language, not in English everywhere", () => {
    const en = DIRECT_CHAT_TEXT.en;
    for (const locale of locales) {
      if (locale === "en") continue;
      const t = DIRECT_CHAT_TEXT[locale];
      expect(t.takenReasons.menu).not.toBe(en.takenReasons.menu);
      expect(t.notSent).not.toBe(en.notSent);
      expect(t.answerInvalid.empty_answer).not.toBe(en.answerInvalid.empty_answer);
    }
  });
});
