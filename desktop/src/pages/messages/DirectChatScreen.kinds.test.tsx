import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import DirectChatScreen from "./DirectChatScreen";
import { ERROR_CATALOG } from "../../lib/error-catalog";
import type {
  DirectChatAnswerReceipt,
  DirectChatClient,
  DirectChatEvent,
  DirectChatPage,
  DirectChatQuestion,
  DirectChatReceipt,
  DirectChatStatus,
} from "./direct-chat-contract";

// The kinds of the agent's messages, its questions with buttons, and what a receipt says of the
// person's own message. The team's side is faked: what is checked is what the person sees and
// what goes back to the team.

const QUESTION: DirectChatQuestion = {
  id: "q1",
  at: 5,
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
};

function client(page: Partial<DirectChatPage> & Record<string, unknown> = {}, initial: DirectChatStatus = { state: "ready" }) {
  let onEvent: ((event: DirectChatEvent) => void) | undefined;
  const mock: DirectChatClient = {
    subscribe: vi.fn(async ({ onEvent: next }) => {
      onEvent = next;
      return initial;
    }),
    status: vi.fn(async () => initial),
    reconnect: vi.fn(async (): Promise<DirectChatStatus> => ({ state: "ready" })),
    read: vi.fn(async (): Promise<DirectChatPage> => ({
      messages: [{ id: "a1", role: "agent", text: "Messaggio dalla VPS", at: 1 }],
      cursor: "opaque-cursor",
      ...page,
    } as DirectChatPage)),
    send: vi.fn(async ({ clientMessageId }): Promise<DirectChatReceipt> => ({
      clientMessageId,
      accepted: true,
      messageId: "remote-user-1",
      at: 2,
    })),
    answer: vi.fn(async ({ questionId }): Promise<DirectChatAnswerReceipt> => ({ questionId, accepted: true, at: 9 })),
    enter: vi.fn(async ({ messageId }): Promise<DirectChatReceipt> => ({
      clientMessageId: "",
      accepted: true,
      messageId,
      at: 3,
      taken: true,
    })),
    close: vi.fn(),
  };
  return { mock, emit: (event: DirectChatEvent) => onEvent?.(event) };
}

function viewport() {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
}

const questionCard = () => screen.getByTestId("direct-chat-question");

afterEach(() => {
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
  vi.restoreAllMocks();
});

describe("DirectChatScreen: the kind of every message of the agent's", () => {
  it("every agent message has its label; colour only for urgent and blocked; the person's have none", async () => {
    viewport();
    const { mock } = client({
      messages: [
        { id: "a1", role: "agent", text: "Senza tipo", at: 1 },
        { id: "a2", role: "agent", text: "Si è fermato tutto", at: 2, kind: "urgent", subject: "Scout fermo" } as never,
        { id: "a3", role: "agent", text: "Manca il CV", at: 3, kind: "blocked" },
        { id: "a4", role: "agent", text: "Fatto", at: 4, kind: "completed" },
        { id: "a5", role: "agent", text: "Tipo ignoto", at: 5, kind: "panic" as never },
        { id: "u1", role: "user", text: "Mio", at: 6, kind: "urgent" } as never,
      ],
    });
    render(<DirectChatScreen client={mock} />);
    const card = async (text: string) => (await screen.findByText(text)).closest("article")!;
    const label = async (text: string) => within(await card(text)).getByTestId("direct-chat-kind");

    expect(await label("Senza tipo")).toHaveTextContent("comunicazione");
    expect(await label("Si è fermato tutto")).toHaveTextContent("urgente");
    expect(await label("Manca il CV")).toHaveTextContent("bloccato");
    expect(await label("Fatto")).toHaveTextContent("completato");
    expect(await label("Tipo ignoto")).toHaveTextContent("comunicazione");
    expect(within(await card("Mio")).queryByTestId("direct-chat-kind")).toBeNull();

    expect((await label("Si è fermato tutto")).style.color).toBe("var(--color-red)");
    expect((await label("Manca il CV")).style.color).toBe("var(--color-yellow)");
    for (const plain of ["Senza tipo", "Fatto", "Tipo ignoto"]) {
      expect((await label(plain)).style.color).toBe("var(--color-muted)");
    }
    // a message has no subject in this version: what the team may send is not shown
    expect(await card("Si è fermato tutto")).not.toHaveTextContent("Scout fermo");
  });

  it("the label speaks the app's language", async () => {
    viewport();
    document.cookie = "NEXT_LOCALE=en; path=/";
    const { mock } = client({ messages: [{ id: "a1", role: "agent", text: "x", at: 1, kind: "completed" }] });
    render(<DirectChatScreen client={mock} />);
    expect(within((await screen.findByText("x")).closest("article")!).getByTestId("direct-chat-kind")).toHaveTextContent("done");
  });
});

describe("DirectChatScreen: the agent's questions, answered with the buttons", () => {
  it("shows the question in the conversation by time, and one click on an option is the answer", async () => {
    viewport();
    const { mock } = client({
      messages: [
        { id: "a1", role: "agent", text: "Prima", at: 1 },
        { id: "a2", role: "agent", text: "Dopo", at: 9 },
      ],
      questions: [QUESTION],
    });
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} />);
    await screen.findByText("Dove cerco prima?");
    const order = within(screen.getByTestId("direct-chat-transcript"))
      .getAllByRole("article")
      .map((card) => (card.textContent ?? "").match(/Prima|Dove cerco prima\?|Dopo/)?.[0]);
    expect(order).toEqual(["Prima", "Dove cerco prima?", "Dopo"]);
    expect(within(questionCard()).getByTestId("direct-chat-kind")).toHaveTextContent("domanda");

    await user.click(within(questionCard()).getByRole("button", { name: "Milano" }));
    expect(mock.answer).toHaveBeenCalledWith({ agentId: "capitano", questionId: "q1", choices: ["mi"], text: null });
    await waitFor(() => expect(questionCard()).toHaveAttribute("data-state", "answered"));
    const options = within(questionCard()).getAllByTestId("direct-chat-option");
    expect(options.map((o) => o.textContent)).toEqual(["Roma", "✓ Milano"]);
    for (const option of options) expect(option).toBeDisabled();
    expect(within(questionCard()).getByTestId("direct-chat-answer-seen")).toHaveTextContent(/non l'ha ancora presa/i);
  });

  it("words are written in the chat's own box: «answer in words» puts the question over it, and Enter answers it", async () => {
    viewport();
    const { mock } = client({ questions: [QUESTION] });
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} />);
    await screen.findByText("Dove cerco prima?");
    // no second box inside the question
    expect(within(questionCard()).queryByRole("textbox")).toBeNull();
    await user.click(within(questionCard()).getByRole("button", { name: "Rispondi a parole" }));
    const line = screen.getByTestId("direct-chat-reply-to");
    expect(line).toHaveTextContent("rispondi alla domanda:");
    expect(line).toHaveTextContent("Quale città?");
    const box = screen.getByRole("textbox", { name: "Scrivi a Capitano" });
    expect(box).toHaveFocus();
    await user.type(box, "Torino, se c'è{Enter}");
    expect(mock.answer).toHaveBeenCalledWith({ agentId: "capitano", questionId: "q1", choices: [], text: "Torino, se c'è" });
    expect(mock.send).not.toHaveBeenCalled();
    await waitFor(() => expect(within(questionCard()).getByTestId("direct-chat-answer-text")).toHaveTextContent("✓ Torino, se c'è"));
    expect(screen.queryByTestId("direct-chat-reply-to")).toBeNull();
    expect(box).toHaveValue("");
  });

  it("an answer in words that the team refuses stays in the box, with the reason", async () => {
    viewport();
    const { mock } = client({ questions: [QUESTION] });
    mock.answer = vi.fn(async () => Promise.reject({ code: "question_closed" }));
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} />);
    await screen.findByText("Dove cerco prima?");
    await user.click(within(questionCard()).getByRole("button", { name: "Rispondi a parole" }));
    const box = screen.getByRole("textbox", { name: "Scrivi a Capitano" });
    await user.type(box, "Torino{Enter}");
    expect(await screen.findByTestId("direct-chat-answer-refused")).toHaveTextContent(/già stata data.*ancora nella casella/i);
    expect(box).toHaveValue("Torino");
    expect(mock.send).not.toHaveBeenCalled();
  });

  it("an answered question read from the team keeps the ✓ and says the agent read it", async () => {
    viewport();
    const { mock } = client({
      questions: [{ ...QUESTION, state: "answered", answer: { choices: ["rm"], at: 6, origin: "user", seenAt: 7 } }],
    });
    render(<DirectChatScreen client={mock} />);
    await screen.findByText("Dove cerco prima?");
    expect(within(questionCard()).getByRole("button", { name: "✓ Roma" })).toHaveAttribute("aria-pressed", "true");
    expect(within(questionCard()).getByTestId("direct-chat-answer-seen")).toHaveTextContent(/presa dallo strumento/i);
    expect(within(questionCard()).getByTestId("direct-chat-answer-seen")).not.toHaveTextContent(/non/i);
  });

  it("a question the system closed ticks no option and says it is resolved, not that the agent read it", async () => {
    viewport();
    const { mock } = client({
      questions: [{ ...QUESTION, state: "answered", answer: { choices: ["rm"], at: 6, origin: "system", seenAt: null } }],
    });
    render(<DirectChatScreen client={mock} />);
    await screen.findByText("Dove cerco prima?");
    expect(within(questionCard()).queryByRole("button", { name: "✓ Roma" })).toBeNull();
    expect(within(questionCard()).getByRole("button", { name: "Roma" })).toHaveAttribute("aria-pressed", "false");
    expect(within(questionCard()).getByTestId("direct-chat-answer-resolved")).toHaveTextContent(/risolta/i);
    expect(within(questionCard()).queryByTestId("direct-chat-answer-seen")).toBeNull();
    for (const option of within(questionCard()).getAllByTestId("direct-chat-option")) expect(option).toBeDisabled();
  });

  it("an expired question says so and offers nothing", async () => {
    viewport();
    const { mock } = client({
      questions: [{ ...QUESTION, state: "expired", answer: { choices: ["rm"], at: 6, origin: "expiry", seenAt: null } }],
    });
    render(<DirectChatScreen client={mock} />);
    await screen.findByText("Dove cerco prima?");
    expect(within(questionCard()).getByTestId("direct-chat-answer-expired")).toBeInTheDocument();
    for (const option of within(questionCard()).getAllByTestId("direct-chat-option")) expect(option).toBeDisabled();
    expect(within(questionCard()).queryByTestId("direct-chat-answer-in-words")).toBeNull();
  });

  it("several choices: the options light up, and «Rispondi» sends them together", async () => {
    viewport();
    const three = { ...QUESTION, multiple: true, options: [...QUESTION.options, { id: "to", label: "Torino" }] };
    const { mock } = client({ questions: [three] });
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} />);
    await screen.findByText("Dove cerco prima?");
    const send = within(questionCard()).getByTestId("direct-chat-answer-choices");
    expect(send).toBeDisabled();
    await user.click(within(questionCard()).getByRole("button", { name: "Roma" }));
    await user.click(within(questionCard()).getByRole("button", { name: "Torino" }));
    await user.click(within(questionCard()).getByRole("button", { name: "Milano" }));
    await user.click(within(questionCard()).getByRole("button", { name: "Milano" }));
    expect(mock.answer).not.toHaveBeenCalled();
    expect(within(questionCard()).getByRole("button", { name: "Roma" })).toHaveAttribute("aria-pressed", "true");
    expect(within(questionCard()).getByRole("button", { name: "Milano" })).toHaveAttribute("aria-pressed", "false");
    await user.click(send);
    expect(mock.answer).toHaveBeenCalledWith({ agentId: "capitano", questionId: "q1", choices: ["rm", "to"], text: null });
    await waitFor(() => expect(questionCard()).toHaveAttribute("data-state", "answered"));
    expect(within(questionCard()).getAllByTestId("direct-chat-option").map((o) => o.textContent)).toEqual(["✓ Roma", "Milano", "✓ Torino"]);
  });

  it("the read-only view and a client that cannot answer only show the question", async () => {
    viewport();
    const locked = client({ questions: [QUESTION] });
    const { unmount } = render(<DirectChatScreen client={locked.mock} writeLocked />);
    await screen.findByText("Dove cerco prima?");
    for (const option of within(questionCard()).getAllByTestId("direct-chat-option")) expect(option).toBeDisabled();
    expect(within(questionCard()).queryByTestId("direct-chat-answer-in-words")).toBeNull();
    unmount();

    const older = client({ questions: [QUESTION] });
    delete older.mock.answer;
    render(<DirectChatScreen client={older.mock} />);
    await screen.findByText("Dove cerco prima?");
    for (const option of within(questionCard()).getAllByTestId("direct-chat-option")) expect(option).toBeDisabled();
  });

  it.each([
    ["question_closed", /già stata data/i],
    ["invalid_choice", /non è fra quelle/i],
    ["mystery_code", /non inviata/i],
  ])("a refused answer (%s) leaves the question open and says why", async (code, sentence) => {
    viewport();
    const { mock } = client({ questions: [QUESTION] });
    mock.answer = vi.fn(async () => Promise.reject({ code }));
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} />);
    await screen.findByText("Dove cerco prima?");
    await user.click(within(questionCard()).getByRole("button", { name: "Roma" }));
    expect(await within(questionCard()).findByRole("alert")).toHaveTextContent(sentence);
    expect(questionCard()).toHaveAttribute("data-state", "open");
    expect(within(questionCard()).getByRole("button", { name: "Roma" })).toBeEnabled();
  });

  it("an answer in flight keeps the question closed through a read that still shows it open", async () => {
    viewport();
    const { mock, emit } = client({ questions: [QUESTION] });
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} />);
    await screen.findByText("Dove cerco prima?");
    await user.click(within(questionCard()).getByRole("button", { name: "Roma" }));
    await waitFor(() => expect(questionCard()).toHaveAttribute("data-state", "answered"));
    // the team has not written it yet: its read still says open
    act(() => emit({ kind: "messages", agentId: "capitano", page: { messages: [], questions: [QUESTION] } as never }));
    await act(async () => undefined);
    expect(questionCard()).toHaveAttribute("data-state", "answered");
    expect(within(questionCard()).getByRole("button", { name: "✓ Roma" })).toBeDisabled();
    expect(mock.answer).toHaveBeenCalledTimes(1);
  });

  it("an image that brings no questions field takes no answer", async () => {
    viewport();
    const { mock, emit } = client();
    render(<DirectChatScreen client={mock} />);
    await screen.findByText("Messaggio dalla VPS");
    expect(screen.queryByTestId("direct-chat-question")).toBeNull();
    // a question that comes by an event of a page with the field is answerable
    act(() => emit({ kind: "messages", agentId: "capitano", page: { messages: [], questions: [QUESTION] } as never }));
    await screen.findByText("Dove cerco prima?");
    expect(within(questionCard()).getByRole("button", { name: "Roma" })).toBeEnabled();
  });

  it("a question that takes no words offers none, and a reply to it is a quoted message", async () => {
    viewport();
    const { mock } = client({ questions: [{ ...QUESTION, free: false }] });
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} />);
    await screen.findByText("Dove cerco prima?");
    expect(within(questionCard()).queryByTestId("direct-chat-answer-in-words")).toBeNull();
    fireEvent.contextMenu(questionCard(), { clientX: 10, clientY: 10 });
    await user.click(screen.getByTestId("direct-chat-menu-reply"));
    expect(screen.getByTestId("direct-chat-reply-to")).toHaveTextContent("rispondi a:");
    await user.type(screen.getByRole("textbox", { name: "Scrivi a Capitano" }), "Ne parliamo dopo{Enter}");
    expect(mock.answer).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mock.send).toHaveBeenCalledWith(expect.objectContaining({ text: '↩ in risposta a: "Quale città?"\nNe parliamo dopo' })),
    );
  });

  it("a later read replaces the questions with the team's account of them", async () => {
    viewport();
    const { mock, emit } = client({ questions: [QUESTION] });
    render(<DirectChatScreen client={mock} />);
    await screen.findByText("Dove cerco prima?");
    act(() =>
      emit({
        kind: "messages",
        agentId: "capitano",
        page: { messages: [], questions: [{ ...QUESTION, state: "answered", answer: { choices: ["mi"], at: 6, origin: "user", seenAt: 8 } }] } as never,
      }),
    );
    await waitFor(() => expect(questionCard()).toHaveAttribute("data-state", "answered"));
    expect(within(questionCard()).getByRole("button", { name: "✓ Milano" })).toBeInTheDocument();
  });
});

describe("DirectChatScreen: whether the agent's CLI took the person's message", () => {
  async function sendWith(receipt: Partial<DirectChatReceipt>, setup?: (mock: DirectChatClient) => void) {
    viewport();
    const { mock } = client();
    mock.send = vi.fn(async ({ clientMessageId }): Promise<DirectChatReceipt> => ({
      clientMessageId,
      accepted: true,
      messageId: "remote-7",
      at: 3,
      ...receipt,
    }));
    setup?.(mock);
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} />);
    await screen.findByText("Messaggio dalla VPS");
    await user.type(screen.getByRole("textbox", { name: "Scrivi a Capitano" }), "Ci sei?{Enter}");
    const mine = () => screen.getByText("Ci sei?").closest("article")!;
    await screen.findByText("Ci sei?");
    return { mock, user, mine };
  }

  it("taken: «Inviato», never «Consegnato» while the delivery cannot prove it", async () => {
    const { mine } = await sendWith({ taken: true });
    await waitFor(() => expect(within(mine()).getByTestId("direct-chat-sent")).toHaveTextContent("Inviato"));
    expect(mine()).not.toHaveTextContent(/consegnato|preso/i);
  });

  it("not taken: «incollato ma non inviato», and the button presses Enter once, never the text again", async () => {
    const { mock, user, mine } = await sendWith({ taken: false });
    await waitFor(() => expect(within(mine()).getByTestId("direct-chat-not-sent")).toHaveTextContent("Incollato ma non inviato"));
    expect(within(mine()).queryByTestId("direct-chat-sent")).toBeNull();
    await user.click(within(mine()).getByRole("button", { name: "Invia di nuovo (Invio)" }));
    expect(mock.enter).toHaveBeenCalledTimes(1);
    expect(mock.enter).toHaveBeenCalledWith({ agentId: "capitano", messageId: "remote-7" });
    expect(mock.send).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(within(mine()).getByTestId("direct-chat-sent")).toHaveTextContent("Inviato"));
    expect(within(mine()).queryByTestId("direct-chat-not-sent")).toBeNull();
  });

  it("Enter again is offered three times at most", async () => {
    const { mock, user, mine } = await sendWith({ taken: false }, (m) => {
      m.enter = vi.fn(async ({ messageId }): Promise<DirectChatReceipt> => ({ clientMessageId: "", accepted: true, messageId, at: 4, taken: false }));
    });
    for (let i = 0; i < 3; i += 1) {
      await user.click(await within(mine()).findByRole("button", { name: "Invia di nuovo (Invio)" }));
    }
    await waitFor(() => expect(mock.enter).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(within(mine()).queryByTestId("direct-chat-enter-again")).toBeNull());
    expect(within(mine()).getByTestId("direct-chat-not-sent")).toHaveTextContent("Incollato ma non inviato");
  });

  it("not known: says so with the reason in the person's language, and offers no button", async () => {
    const { mock, mine } = await sendWith({ taken: null, reason: "permission" });
    await waitFor(() => expect(within(mine()).getByTestId("direct-chat-taken-unknown")).toHaveTextContent("Non so se è stato preso"));
    expect(within(mine()).getByTestId("direct-chat-taken-reason")).toHaveTextContent("c'è una domanda di permesso");
    expect(mine()).not.toHaveTextContent("permission");
    expect(within(mine()).queryByRole("button")).toBeNull();
    expect(within(mine()).queryByTestId("direct-chat-sent")).toBeNull();
    expect(mock.enter).not.toHaveBeenCalled();
  });

  it("out of the box but with no proof: «not known» with what to do, and no button", async () => {
    const { mine } = await sendWith({ taken: null, reason: "unconfirmed" });
    await waitFor(() => expect(within(mine()).getByTestId("direct-chat-taken-reason")).toHaveTextContent(/guarda il suo terminale prima di riscrivere/));
    expect(within(mine()).queryByRole("button")).toBeNull();
    expect(within(mine()).queryByTestId("direct-chat-sent")).toBeNull();
  });

  it.each(["agent_busy", "<b>premi Invio</b> adesso", "__proto__"])("a reason outside the closed list (%s) is not shown", async (reason) => {
    const { mine } = await sendWith({ taken: null, reason });
    await waitFor(() => expect(within(mine()).getByTestId("direct-chat-taken-unknown")).toBeInTheDocument());
    expect(within(mine()).queryByTestId("direct-chat-taken-reason")).toBeNull();
    expect(mine()).not.toHaveTextContent(reason);
  });

  it("an older bridge without Enter: the sentence stays, no button", async () => {
    const { mine } = await sendWith({ taken: false }, (m) => {
      delete m.enter;
    });
    await waitFor(() => expect(within(mine()).getByTestId("direct-chat-not-sent")).toBeInTheDocument());
    expect(within(mine()).queryByRole("button")).toBeNull();
  });

  it("taken wins over a queued state", async () => {
    const { mine } = await sendWith({ taken: true, state: "queued" });
    await waitFor(() => expect(within(mine()).getByTestId("direct-chat-sent")).toBeInTheDocument());
  });
});

describe("DirectChatScreen: reply to a message, days, suggestions", () => {
  it("right-click on a message → Reply: the line over the box, the quote in what goes, the × takes it away", async () => {
    viewport();
    const { mock } = client();
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} />);
    const card = (await screen.findByText("Messaggio dalla VPS")).closest("article")!;
    fireEvent.contextMenu(card, { clientX: 20, clientY: 30 });
    const menu = screen.getByTestId("direct-chat-menu");
    expect(menu).toHaveStyle({ left: "20px", top: "30px" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("direct-chat-menu")).toBeNull();

    fireEvent.contextMenu(card, { clientX: 20, clientY: 30 });
    await user.click(screen.getByRole("menuitem", { name: "↩ Rispondi" }));
    expect(screen.getByTestId("direct-chat-reply-to")).toHaveTextContent("rispondi a:Messaggio dalla VPS");
    expect(card).toHaveAttribute("data-quoted", "true");
    await user.click(screen.getByRole("button", { name: "Scrivi un messaggio normale" }));
    expect(screen.queryByTestId("direct-chat-reply-to")).toBeNull();

    fireEvent.contextMenu(card, { clientX: 20, clientY: 30 });
    await user.click(screen.getByTestId("direct-chat-menu-reply"));
    await user.type(screen.getByRole("textbox", { name: "Scrivi a Capitano" }), "Va bene{Enter}");
    await waitFor(() =>
      expect(mock.send).toHaveBeenCalledWith(expect.objectContaining({ text: '↩ in risposta a: "Messaggio dalla VPS"\nVa bene' })),
    );
    expect(screen.queryByTestId("direct-chat-reply-to")).toBeNull();
  });

  it("the read-only view has no reply menu", async () => {
    viewport();
    const { mock } = client();
    render(<DirectChatScreen client={mock} writeLocked />);
    const card = (await screen.findByText("Messaggio dalla VPS")).closest("article")!;
    fireEvent.contextMenu(card, { clientX: 1, clientY: 1 });
    expect(screen.queryByTestId("direct-chat-menu")).toBeNull();
  });

  it("a separator opens each day: today, yesterday, then the date", async () => {
    viewport();
    const now = new Date();
    const at = (daysAgo: number, hour: number) =>
      new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, 0, 0).getTime() / 1000;
    const { mock } = client({
      messages: [
        { id: "m1", role: "agent", text: "tre giorni fa", at: at(3, 9) },
        { id: "m2", role: "agent", text: "ieri mattina", at: at(1, 9) },
        { id: "m3", role: "agent", text: "ieri sera", at: at(1, 21) },
        { id: "m4", role: "agent", text: "oggi", at: at(0, 1) },
      ],
    });
    render(<DirectChatScreen client={mock} />);
    await screen.findByText("ieri sera");
    const days = screen.getAllByTestId("direct-chat-day").map((d) => d.textContent);
    const date = new Date(at(3, 9) * 1000).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
    expect(days).toEqual([date, "ieri", "oggi"]);
  });

  it("a reply the agent suggests is sent with one click, and what was typed stays in the box", async () => {
    viewport();
    const { mock } = client({
      messages: [{ id: "a1", role: "agent", text: "Procedo?", at: 1, suggestions: ["Sì, vai", "Aspetta"] }],
    });
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} />);
    await screen.findByText("Procedo?");
    const box = screen.getByRole("textbox", { name: "Scrivi a Capitano" });
    await user.type(box, "bozza");
    await user.click(screen.getByRole("button", { name: "Sì, vai" }));
    await waitFor(() => expect(mock.send).toHaveBeenCalledWith(expect.objectContaining({ text: "Sì, vai" })));
    expect(box).toHaveValue("bozza");
  });

  it("suggestions that are not 2 to 5 short lines are not shown", async () => {
    viewport();
    const { mock } = client({
      messages: [
        { id: "a1", role: "agent", text: "una sola", at: 1, suggestions: ["Sì"] },
        { id: "a2", role: "agent", text: "due righe", at: 2, suggestions: ["Sì\nNo", "Forse"] },
      ],
    });
    render(<DirectChatScreen client={mock} />);
    await screen.findByText("due righe");
    expect(screen.queryByTestId("direct-chat-suggestion")).toBeNull();
  });

  it("a message too long to be shown is said in the person's language", async () => {
    viewport();
    const { mock } = client({ messages: [{ id: "s1", role: "system", text: "message too long", at: 1, code: "message_too_long" }] });
    render(<DirectChatScreen client={mock} />);
    expect(await screen.findByText("Un messaggio dell'agente era troppo lungo per essere mostrato qui.")).toBeInTheDocument();
  });

  it("urgent and blocked are a bar on the left, not the whole border", async () => {
    viewport();
    const { mock } = client({ messages: [{ id: "a1", role: "agent", text: "Fermo", at: 1, kind: "urgent" }] });
    render(<DirectChatScreen client={mock} />);
    const card = (await screen.findByText("Fermo")).closest("article")!;
    expect(card.style.boxShadow).toBe("inset 3px 0 0 var(--color-red)");
    expect(card.style.border).toBe("1px solid var(--color-border)");
  });

  it("an error of the chat on an answer goes to the status bar with the app's sentence", async () => {
    viewport();
    const { mock } = client({ questions: [QUESTION] });
    mock.answer = vi.fn(async () => Promise.reject({ code: "read_only_link" }));
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} />);
    await screen.findByText("Dove cerco prima?");
    await user.click(within(questionCard()).getByRole("button", { name: "Roma" }));
    expect(await within(questionCard()).findByRole("alert")).toHaveTextContent(/non inviata/i);
    const status = screen.getByTestId("direct-chat-status");
    expect(status).toHaveTextContent(ERROR_CATALOG.read_only_link.text.it);
    expect(status).not.toHaveTextContent("read_only_link");
  });
});
