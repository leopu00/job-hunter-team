import { describe, expect, it } from "vitest";
import {
  asksAnswer,
  calendarDays,
  dayKey,
  dayLabel,
  excerpt,
  quoteLine,
  sortQuestions,
  suggestionsOf,
  wordQuestions,
  answerableHere,
  answerProblem,
  outcomeOf,
  settleQueued,
  TAKEN_REASONS,
  cleanMessage,
  cleanQuestion,
  KIND_COLOR,
  messageKind,
  questionKind,
  questionsOf,
  transcript,
} from "./chat-kinds";
import type { DirectChatMessage } from "./direct-chat-contract";

const question = (over: Record<string, unknown> = {}) => ({
  id: "q1",
  at: 100,
  kind: "question",
  subject: "Quale città?",
  text: "Dove cerco prima?",
  options: [
    { id: "rm", label: "Roma" },
    { id: "mi", label: "Milano" },
  ],
  multiple: false,
  free: true,
  expiresAt: null,
  state: "open",
  ...over,
});

describe("the kinds, read from what the team sends", () => {
  it("a message takes one of four kinds; question, nothing or anything else is info", () => {
    expect(["urgent", "blocked", "completed", "info"].map(messageKind)).toEqual(["urgent", "blocked", "completed", "info"]);
    for (const v of ["question", undefined, null, "URGENT", "urgente", 3, {}]) expect(messageKind(v)).toBe("info");
  });

  it("a question takes one of five kinds; anything else is info, as the team reads it", () => {
    expect(questionKind("blocked")).toBe("blocked");
    expect(questionKind("question")).toBe("question");
    expect(questionKind("domanda")).toBe("info");
    expect(questionKind(undefined)).toBe("info");
  });

  it("only urgent and blocked have a colour", () => {
    expect(Object.keys(KIND_COLOR).sort()).toEqual(["blocked", "urgent"]);
  });

  it("an agent's message gets its kind and no subject; the person's and the system's get neither", () => {
    const agent = cleanMessage({ id: "a", role: "agent", text: "t", at: 1, kind: "question" as never, subject: "oggetto" } as DirectChatMessage);
    expect(agent).toEqual({ id: "a", role: "agent", text: "t", at: 1, kind: "info" });
    const user = cleanMessage({ id: "u", role: "user", text: "t", at: 1, kind: "urgent", subject: "s" } as DirectChatMessage);
    expect(user).toEqual({ id: "u", role: "user", text: "t", at: 1 });
  });
});

describe("a question, read defensively", () => {
  it("keeps a good one as it is", () => {
    expect(cleanQuestion(question())).toEqual({
      id: "q1",
      at: 100,
      kind: "question",
      subject: "Quale città?",
      text: "Dove cerco prima?",
      options: [
        { id: "rm", label: "Roma" },
        { id: "mi", label: "Milano" },
      ],
      multiple: false,
      free: true,
      expiresAt: null,
      state: "open",
    });
  });

  it("is not a question without an id, a time or a text", () => {
    for (const bad of [null, "x", question({ id: "" }), question({ at: "ieri" }), question({ at: -1 }), question({ text: "  " })]) {
      expect(cleanQuestion(bad)).toBeNull();
    }
  });

  it("drops broken and repeated options, cuts long labels, shows at most eight", () => {
    const options = [
      { id: "a", label: "A" },
      { id: "a", label: "again" },
      { id: "", label: "no id" },
      { id: "b", label: "   " },
      "c",
      { id: "long", label: "L".repeat(90) },
      ...Array.from({ length: 10 }, (_, i) => ({ id: `o${i}`, label: `O${i}` })),
    ];
    const q = cleanQuestion(question({ options }))!;
    expect(q.options).toHaveLength(8);
    expect(q.options[0]).toEqual({ id: "a", label: "A" });
    expect(q.options[1].id).toBe("long");
    expect(q.options[1].label).toHaveLength(60);
  });

  it("without options it is not a question: the team always asks with options", () => {
    expect(cleanQuestion(question({ options: [] }))).toBeNull();
    expect(cleanQuestion(question({ options: [{ id: "", label: "x" }] }))).toBeNull();
    expect(cleanQuestion(question({ free: "yes" }))!.free).toBe(false);
  });

  it("an answer from the team closes it, with only the choices among its options", () => {
    const q = cleanQuestion(question({ state: "open", answer: { choices: ["rm", "xx", 4], at: 150, origin: "user", seenAt: 160 } }))!;
    expect(q.state).toBe("answered");
    expect(q.answer).toEqual({ choices: ["rm"], at: 150, origin: "user", seenAt: 160 });
  });

  it("an answer taken at the expiry makes it expired; an empty answer is no answer", () => {
    expect(cleanQuestion(question({ answer: { choices: ["mi"], at: 150, origin: "expiry", seenAt: null } }))!.state).toBe("expired");
    const empty = cleanQuestion(question({ state: "open", answer: { choices: [], text: "  ", at: 150 } }))!;
    expect(empty.answer).toBeUndefined();
    expect(empty.state).toBe("open");
  });

  it("an unknown state is open; the kind comes from the list", () => {
    const q = cleanQuestion(question({ state: "dismissed", kind: "nonsense" }))!;
    expect(q.state).toBe("open");
    expect(q.kind).toBe("info");
  });

  it("an origin the app does not know is unknown, never the person's", () => {
    for (const origin of ["unknown", "utente", "scadenza", undefined, 1]) {
      const q = cleanQuestion(question({ answer: { choices: ["rm"], at: 150, origin, seenAt: null } }))!;
      expect(q.answer!.origin).toBe("unknown");
      expect(q.state).toBe("answered");
    }
  });
});

describe("the page and the conversation", () => {
  it("an older image without questions has none; the valid ones come by time", () => {
    expect(questionsOf({ messages: [] })).toEqual([]);
    expect(questionsOf({ messages: [], questions: "x" as never })).toEqual([]);
    const page = { messages: [], questions: [question({ id: "late", at: 300 }), { broken: true }, question({ id: "early", at: 50 })] };
    expect(questionsOf(page as never).map((q) => q.id)).toEqual(["early", "late"]);
  });

  it("messages and questions in one line by time; a question after a message of the same instant", () => {
    const messages: DirectChatMessage[] = [
      { id: "m1", role: "agent", text: "a", at: 10 },
      { id: "m2", role: "user", text: "b", at: 100 },
    ];
    const items = transcript(messages, questionsOf({ messages: [], questions: [question({ at: 100 }), question({ id: "q0", at: 5 })] } as never));
    expect(items.map((i) => i.key)).toEqual(["q:q0", "m:m1", "m:m2", "q:q1"]);
  });

  it("says before sending what the team would refuse", () => {
    const q = cleanQuestion(question({ free: false }))!;
    expect(answerProblem(q, ["rm"], "")).toBeNull();
    expect(answerProblem(q, [], "  ")).toBe("empty_answer");
    expect(answerProblem(q, ["xx"], "")).toBe("choice_unknown");
    expect(answerProblem(q, ["rm", "mi"], "")).toBe("single_choice_only");
    expect(answerProblem(q, [], "Torino")).toBe("free_text_not_allowed");
    const free = cleanQuestion(question())!;
    expect(answerProblem(free, [], "Torino")).toBeNull();
    expect(answerProblem(free, [], "x".repeat(1001))).toBe("text_too_long");
    expect(answerProblem({ ...free, multiple: true }, ["rm", "mi"], "")).toBeNull();
  });

  it("is answered here while it is open, with one choice or several", () => {
    expect(answerableHere(cleanQuestion(question())!)).toBe(true);
    expect(answerableHere(cleanQuestion(question({ multiple: true }))!)).toBe(true);
    expect(answerableHere(cleanQuestion(question({ answer: { choices: ["rm"], at: 120 } }))!)).toBe(false);
  });
});

describe("what a receipt says of the person's message", () => {
  it("sent, never taken; in the mailbox; pasted but not sent; not known", () => {
    expect(outcomeOf({ taken: true }, 0)).toEqual({ kind: "sent" });
    expect(outcomeOf({}, 0)).toEqual({ kind: "sent" });
    expect(outcomeOf({ state: "queued" }, 0)).toEqual({ kind: "queued" });
    expect(outcomeOf({ state: "queued", taken: true }, 0)).toEqual({ kind: "sent" });
    expect(outcomeOf({ taken: false }, 2)).toEqual({ kind: "notSent", presses: 2 });
    expect(outcomeOf({ taken: null }, 0)).toEqual({ kind: "unknown" });
  });

  it("a turn queued by the team is watched; a mailbox turn is not; only a queue the page lists settles it", () => {
    const watched = outcomeOf({ state: "queued", queue: "terminal" }, 0);
    expect(watched).toEqual({ kind: "queued", watched: true });
    expect(outcomeOf({ state: "queued", queue: "mailbox" }, 0)).toEqual({ kind: "queued" });
    expect(outcomeOf({ queue: "terminal" }, 0)).toEqual({ kind: "sent" });
    const outcomes = new Map<string, ReturnType<typeof outcomeOf>>([["m1", watched], ["m2", watched], ["m3", { kind: "queued" }]]);
    expect(settleQueued(outcomes, undefined)).toBe(outcomes);
    expect(settleQueued(outcomes, ["m1", "m2"])).toBe(outcomes);
    const settled = settleQueued(outcomes, ["m2"]);
    expect([...settled.entries()]).toEqual([["m1", { kind: "sent" }], ["m2", watched], ["m3", { kind: "queued" }]]);
    expect(settleQueued(outcomes, [])?.get("m3")).toEqual({ kind: "queued" });
  });

  it("the reason is kept only from the closed list", () => {
    for (const reason of TAKEN_REASONS) expect(outcomeOf({ taken: null, reason }, 0)).toEqual({ kind: "unknown", reason });
    for (const reason of ["agent_busy", "MENU", "menu ", "__proto__", 3, null]) {
      expect(outcomeOf({ taken: null, reason }, 0)).toEqual({ kind: "unknown" });
    }
    // a reason beside a taken that is not null says nothing
    expect(outcomeOf({ taken: false, reason: "menu" }, 0)).toEqual({ kind: "notSent", presses: 0 });
  });
});

describe("the open questions: who asks an answer, their order, the ones the box answers", () => {
  it("urgent, blocked and question ask an answer; completed and info do not", () => {
    expect((["urgent", "blocked", "question", "completed", "info"] as const).filter(asksAnswer)).toEqual(["urgent", "blocked", "question"]);
  });

  it("by urgency (urgent, blocked, question), then age, the oldest first, then the id", () => {
    const q = (id: string, kind: string, at: number) => cleanQuestion(question({ id, kind, at }))!;
    const sorted = sortQuestions([q("d-new", "question", 300), q("b", "blocked", 400), q("d-old", "question", 100), q("u", "urgent", 500), q("d-same-b", "question", 100)]);
    expect(sorted.map((x) => x.id)).toEqual(["u", "b", "d-old", "d-same-b", "d-new"]);
  });

  it("the chat's box answers the open questions that take words, the oldest first", () => {
    const qs = [
      cleanQuestion(question({ id: "late", at: 300 }))!,
      cleanQuestion(question({ id: "nowords", at: 50, free: false }))!,
      cleanQuestion(question({ id: "closed", at: 60, answer: { choices: ["rm"], at: 70, origin: "user" } }))!,
      cleanQuestion(question({ id: "early", at: 100 }))!,
    ];
    expect(wordQuestions(qs).map((x) => x.id)).toEqual(["early", "late"]);
  });
});

describe("days and quotes", () => {
  it("counts calendar days, not 24-hour spans", () => {
    expect(calendarDays(new Date(2026, 9, 22, 23, 50), new Date(2026, 9, 23, 0, 10))).toBe(1);
    expect(calendarDays(new Date(2026, 9, 23, 0, 10), new Date(2026, 9, 23, 23, 50))).toBe(0);
    expect(calendarDays(new Date(2026, 9, 20, 12), new Date(2026, 9, 23, 12))).toBe(3);
    // across the change of the clock (last Sunday of October in Europe)
    expect(calendarDays(new Date(2026, 9, 24, 12), new Date(2026, 9, 26, 12))).toBe(2);
  });

  it("the separators' key is the local day of a time in seconds", () => {
    const a = new Date(2026, 9, 23, 0, 5).getTime() / 1000;
    const b = new Date(2026, 9, 23, 23, 55).getTime() / 1000;
    const c = new Date(2026, 9, 24, 0, 5).getTime() / 1000;
    expect(dayKey(a)).toBe(dayKey(b));
    expect(dayKey(b)).not.toBe(dayKey(c));
  });

  it("today, yesterday, then the full date in the person's language", () => {
    const now = new Date(2026, 9, 23, 15);
    const words = { today: "oggi", yesterday: "ieri" };
    expect(dayLabel(new Date(2026, 9, 23, 8).getTime() / 1000, words, "it-IT", now)).toBe("oggi");
    expect(dayLabel(new Date(2026, 9, 22, 23).getTime() / 1000, words, "it-IT", now)).toBe("ieri");
    expect(dayLabel(new Date(2026, 9, 20, 9).getTime() / 1000, words, "it-IT", now)).toBe("20/10/2026");
    expect(dayLabel(new Date(2026, 9, 20, 9).getTime() / 1000, { today: "today", yesterday: "yesterday" }, "en-US", now)).toBe("10/20/2026");
  });

  it("a quote is an excerpt on one line, 120 characters at most", () => {
    expect(excerpt("  due\n\nrighe   qui ")).toBe("due righe qui");
    const long = excerpt("x".repeat(300));
    expect(long).toHaveLength(120);
    expect(long.endsWith("…")).toBe(true);
    expect(quoteLine("in risposta a", "Quale\ncittà?")).toBe('↩ in risposta a: "Quale città?"');
  });
});

describe("the replies an agent suggests", () => {
  it("2 to 5 distinct lines of at most 240 characters, trimmed; anything else is none at all", () => {
    expect(suggestionsOf(["Sì", " No ", "Sì"])).toEqual(["Sì", "No"]);
    expect(suggestionsOf(["a", "b", "c", "d", "e"])).toHaveLength(5);
    for (const bad of [undefined, "Sì", [], ["Sì"], ["a", "b", "c", "d", "e", "f"], ["a", 2], ["a", "b\nc"], ["a", "  "], ["a", "x".repeat(241)], ["Sì", "Sì"]]) {
      expect(suggestionsOf(bad)).toBeUndefined();
    }
  });

  it("only an agent's message keeps them", () => {
    const agent = cleanMessage({ id: "a", role: "agent", text: "t", at: 1, suggestions: ["Sì", "No"] });
    expect(agent.suggestions).toEqual(["Sì", "No"]);
    const user = cleanMessage({ id: "u", role: "user", text: "t", at: 1, suggestions: ["Sì", "No"] });
    expect(user.suggestions).toBeUndefined();
  });
});
