import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DirectChatScreen from "./DirectChatScreen";
import type { DirectChatClient, DirectChatMessage, DirectChatPage, DirectChatStatus } from "./direct-chat-contract";
import TeamQuietNotice, { QUIET_FACTS_REFRESH_MS, quietSentence } from "./TeamQuietNotice";
import type { QuietFacts } from "./team-quiet";

// 10 January 2024, 22:00 in Rome (21:00 UTC), a Wednesday.
const EVENING = Date.UTC(2024, 0, 10, 21, 0);
const OFFICE: QuietFacts = { hours: { timezone: "Europe/Rome", windows: [{ days: ["mon", "tue", "wed", "thu", "fri"], start: "09:00", end: "18:00" }] } };
const secondsAgo = (seconds: number) => EVENING / 1000 - seconds;
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(EVENING);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
});

describe("the notice of the team's silence", () => {
  it("says when the team starts again, once it has been silent for half an hour", async () => {
    const loadFacts = vi.fn(async () => OFFICE);
    render(<TeamQuietNotice lastAgentAt={secondsAgo(31 * 60)} loadFacts={loadFacts} />);
    await advance(10);
    expect(screen.getByTestId("team-quiet")).toHaveTextContent("Il team non scrive perché ora è fuori dall'orario di lavoro: riprende domani alle 09:00.");
    expect(screen.getByTestId("team-quiet")).toHaveAttribute("data-cause", "outside_hours");
  });

  it("is not there before half an hour, nor when the team never wrote, and does not even ask", async () => {
    const loadFacts = vi.fn(async () => OFFICE);
    const { rerender } = render(<TeamQuietNotice lastAgentAt={secondsAgo(10 * 60)} loadFacts={loadFacts} />);
    await advance(10);
    expect(screen.queryByTestId("team-quiet")).toBeNull();
    rerender(<TeamQuietNotice lastAgentAt={0} loadFacts={loadFacts} />);
    await advance(10);
    expect(screen.queryByTestId("team-quiet")).toBeNull();
    expect(loadFacts).not.toHaveBeenCalled();
  });

  it("comes when the half hour passes while the page is open, and goes when the team writes again", async () => {
    const loadFacts = vi.fn(async () => OFFICE);
    const { rerender } = render(<TeamQuietNotice lastAgentAt={secondsAgo(29 * 60)} loadFacts={loadFacts} />);
    await advance(10);
    expect(screen.queryByTestId("team-quiet")).toBeNull();
    await advance(2 * 60_000);
    expect(screen.getByTestId("team-quiet")).toBeInTheDocument();
    rerender(<TeamQuietNotice lastAgentAt={EVENING / 1000 + 120} loadFacts={loadFacts} />);
    await advance(10);
    expect(screen.queryByTestId("team-quiet")).toBeNull();
  });

  it("says nothing when the team gives no reason: all on the clock, a team that does not answer, a failed read", async () => {
    const onTheClock = { hours: null };
    const loadFacts = vi.fn<() => Promise<QuietFacts | null>>(async () => onTheClock);
    render(<TeamQuietNotice lastAgentAt={secondsAgo(3 * 3600)} loadFacts={loadFacts} />);
    await advance(10);
    expect(screen.queryByTestId("team-quiet")).toBeNull();
    loadFacts.mockResolvedValue(null);
    await advance(QUIET_FACTS_REFRESH_MS);
    expect(screen.queryByTestId("team-quiet")).toBeNull();
    loadFacts.mockRejectedValue({ code: "team_settings_unavailable" });
    await advance(QUIET_FACTS_REFRESH_MS);
    expect(screen.queryByTestId("team-quiet")).toBeNull();
  });

  it("asks again every few minutes while the silence goes on, and the reason follows", async () => {
    const loadFacts = vi.fn<() => Promise<QuietFacts | null>>(async () => ({ hours: null }));
    render(<TeamQuietNotice lastAgentAt={secondsAgo(3 * 3600)} loadFacts={loadFacts} />);
    await advance(10);
    expect(screen.queryByTestId("team-quiet")).toBeNull();
    loadFacts.mockResolvedValue({ hours: null, providerReady: false });
    await advance(QUIET_FACTS_REFRESH_MS);
    expect(loadFacts).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("team-quiet")).toHaveAttribute("data-cause", "provider");
  });
});

describe("the sentence", () => {
  const budget = (minutes: number, full: boolean) => ({ kind: "budget" as const, full, usagePct: 93.7, minutes });
  it("says the minutes, or the hours and minutes, the window opens again", () => {
    expect(quietSentence(budget(25, true), "it")).toBe("Il team non scrive: ha esaurito la finestra di lavoro del provider. Riprende tra 25 min.");
    expect(quietSentence(budget(125, true), "en")).toBe("The team is not writing: it has used up the provider's work window. It starts again in 2 h 05 min.");
    expect(quietSentence(budget(30, false), "en")).toBe("The provider's work window is at 93%: the team slows down and it reopens in 30 min.");
  });

  it("says the day of the week in the person's language when the team is away for more than a day", () => {
    const cause = { kind: "outside_hours" as const, opens: { time: "09:00", daysAhead: 2, weekday: "mon" as const } };
    expect(quietSentence(cause, "it")).toContain("riprende lunedì alle 09:00");
    expect(quietSentence(cause, "en")).toContain("starts again Monday at 09:00");
    expect(quietSentence(cause, "de")).toContain("am Montag um 09:00 Uhr");
    expect(quietSentence({ ...cause, opens: { ...cause.opens, daysAhead: 0 } }, "fr")).toContain("reprend à 09:00");
  });

  it("has a sentence for every cause in every language, with no placeholder left", () => {
    const causes = [
      { kind: "containment" as const }, { kind: "provider" as const }, budget(5, true), budget(70, false),
      { kind: "outside_hours" as const, opens: { time: "09:00", daysAhead: 0, weekday: "mon" as const } },
      { kind: "outside_hours" as const, opens: { time: "09:00", daysAhead: 1, weekday: "tue" as const } },
      { kind: "outside_hours" as const, opens: { time: "09:00", daysAhead: 3, weekday: "thu" as const } },
    ];
    for (const locale of ["it", "en", "de", "fr", "es", "pt", "hu"] as const) {
      for (const cause of causes) expect(quietSentence(cause, locale)).not.toMatch(/\{[a-z]+\}/);
    }
  });
});

describe("the notice in the chat", () => {
  const initial: DirectChatStatus = { state: "ready" };
  const client = (messages: DirectChatMessage[]): DirectChatClient => ({
    subscribe: vi.fn(async () => initial),
    status: vi.fn(async () => initial),
    reconnect: vi.fn(async (): Promise<DirectChatStatus> => initial),
    read: vi.fn(async (): Promise<DirectChatPage> => ({ messages })),
    send: vi.fn(),
    close: vi.fn(),
  });
  const written = (hoursAgo: number): DirectChatMessage[] => [
    { id: "u1", role: "user", text: "Ci sei?", at: secondsAgo(hoursAgo * 3600 + 60) },
    { id: "a1", role: "agent", text: "Sì", at: secondsAgo(hoursAgo * 3600) },
  ];

  it("shows under the status of the chat when the agents have not written for a long time, and only when the page is given the facts", async () => {
    const loadQuietFacts = vi.fn(async () => OFFICE);
    const { unmount } = render(<DirectChatScreen client={client(written(3))} loadQuietFacts={loadQuietFacts} />);
    await advance(100);
    expect(screen.getByTestId("team-quiet")).toHaveTextContent("riprende domani alle 09:00");
    unmount();

    render(<DirectChatScreen client={client(written(3))} />);
    await advance(100);
    expect(screen.queryByTestId("team-quiet")).toBeNull();
  });

  it("is not shown when an agent wrote a moment ago", async () => {
    const loadQuietFacts = vi.fn(async () => OFFICE);
    render(<DirectChatScreen client={client(written(0.1))} loadQuietFacts={loadQuietFacts} />);
    await advance(100);
    expect(screen.queryByTestId("team-quiet")).toBeNull();
    expect(loadQuietFacts).not.toHaveBeenCalled();
  });
});
