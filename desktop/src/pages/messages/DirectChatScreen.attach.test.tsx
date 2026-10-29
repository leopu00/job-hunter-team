import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DirectChatScreen, { withoutAttachmentPath } from "./DirectChatScreen";
import type { DirectChatClient, DirectChatReceipt } from "./direct-chat-contract";
import { DIRECT_CHAT_TEXT } from "./direct-chat.i18n";

type Attach = NonNullable<DirectChatClient["attach"]>;
type AttachState = NonNullable<DirectChatClient["attachState"]>;

function client(attach?: Attach, state?: AttachState): DirectChatClient {
  return {
    subscribe: vi.fn(async () => ({ state: "ready" as const })),
    status: vi.fn(async () => ({ state: "ready" as const })),
    reconnect: vi.fn(async () => ({ state: "ready" as const })),
    read: vi.fn(async () => ({ messages: [], cursor: "0" })),
    send: vi.fn(),
    close: vi.fn(),
    ...(attach ? { attach } : {}),
    ...(state ? { attachState: state } : {}),
  } as unknown as DirectChatClient;
}

const on: AttachState = vi.fn(async () => ({ available: true }));

afterEach(() => {
  cleanup();
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
});

async function ready(mock: DirectChatClient, props: { locked?: boolean; agent?: "assistente" | "capitano" } = {}) {
  document.cookie = "NEXT_LOCALE=en; path=/";
  render(<DirectChatScreen client={mock} initialAgentId={props.agent ?? "assistente"} writeLocked={props.locked} />);
  await screen.findByTestId("direct-chat-composer");
}

describe("the paperclip in the Assistant's chat", () => {
  it("is only there for the Assistant, and only when the bridge can attach", async () => {
    await ready(client(vi.fn() as unknown as Attach, on), { agent: "capitano" });
    expect(screen.queryByTestId("direct-chat-attach")).toBeNull();
    cleanup();
    await ready(client(undefined, undefined));
    expect(screen.queryByTestId("direct-chat-attach")).toBeNull();
  });

  it("asks for a file with the person's language and no path, and leaves no line under the composer: the message is in the conversation", async () => {
    const SENT = "I attached my CV. [attachment for my profile: /jht_user/allegati/cv-20261028-153045.pdf]";
    let attached = false;
    const attach: Attach = vi.fn(async () => {
      attached = true;
      return {
        outcome: "sent" as const,
        files: [{ file: "allegato-20261029-101500.pdf", kind: "pdf", bytes: 1, displayName: "Mario Rossi CV.pdf" }],
        receipt: { clientMessageId: "c", accepted: true as const, messageId: "m", at: 1, taken: true },
      };
    });
    const mock = client(attach, on);
    vi.mocked(mock.read).mockImplementation(async () => ({
      messages: attached ? [{ id: "m", role: "user" as const, text: SENT, at: 1 }] : [],
      cursor: "1",
    }));
    await ready(mock);
    const button = await screen.findByTestId("direct-chat-attach");
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.queryByTestId("direct-chat-attach-note")).toBeNull();
    fireEvent.click(button);
    await waitFor(() => expect(attach).toHaveBeenCalledOnce());
    const args = vi.mocked(attach).mock.calls[0][0];
    expect(Object.keys(args).sort()).toEqual(["clientMessageId", "locale"]);
    expect(args.locale).toBe("en");
    expect(args.clientMessageId).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    // the message that left by itself is a bubble, with its delivery under it, and nothing below the composer
    // the page reads the conversation at its own pace: the bubble comes with the next read
    await screen.findByText("I attached my CV.", {}, { timeout: 8000 });
    expect(await screen.findByTestId("direct-chat-sent")).toBeInTheDocument();
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.queryByTestId("direct-chat-attach-note")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Attached:|Mario Rossi/);
    expect(mock.send).not.toHaveBeenCalled();
  });

  it("says the delivery of the attachment message under it as for any message", async () => {
    const cases: [string, Partial<DirectChatReceipt> | null, string | null][] = [
      ["typed and taken", { taken: true }, "direct-chat-sent"],
      ["typed, no word on taking (an older image)", {}, "direct-chat-sent"],
      ["waiting in the team's queue", { state: "queued", queue: "terminal" }, "direct-chat-queued"],
      ["still in the composer", { taken: false }, "direct-chat-not-sent"],
      ["not known to be taken", { taken: null }, "direct-chat-taken-unknown"],
      ["no receipt at all", null, null],
    ];
    const ALL = ["direct-chat-sent", "direct-chat-queued", "direct-chat-not-sent", "direct-chat-taken-unknown"];
    for (const [label, extra, expected] of cases) {
      const receipt = extra && { clientMessageId: "c", accepted: true as const, messageId: "m", at: 1, ...extra };
      const attach: Attach = vi.fn(async () => ({ outcome: "sent" as const, files: [{ file: "allegato-20261029-101500.pdf", kind: "pdf", bytes: 1, displayName: "cv.pdf" }], ...(receipt ? { receipt } : {}) }));
      const mock = client(attach, on);
      vi.mocked(mock.read).mockResolvedValue({ messages: [{ id: "m", role: "user" as const, text: "I attached my CV. [attachment for my profile: /jht_user/allegati/cv-20261028-153045.pdf]", at: 1 }], cursor: "1" });
      await ready(mock);
      await screen.findByText("I attached my CV.");
      for (const id of ALL) expect(screen.queryByTestId(id), `${label}: before`).toBeNull();
      const button = await screen.findByTestId("direct-chat-attach");
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);
      await waitFor(() => expect(attach).toHaveBeenCalledOnce());
      await waitFor(() => expect(button).toBeEnabled());
      for (const id of ALL) {
        if (id === expected) expect(await screen.findByTestId(id), label).toBeInTheDocument();
        else expect(screen.queryByTestId(id), `${label}: ${id}`).toBeNull();
      }
      expect(screen.queryByTestId("direct-chat-attach-note"), label).toBeNull();
      cleanup();
    }
  });

  it("takes a warning away when the person sends a message, and not before", async () => {
    const attach: Attach = vi.fn(async () => ({ outcome: "saved_not_sent" as const, files: [{ file: "allegato-20261029-101500.pdf", kind: "pdf", bytes: 1, displayName: "cv.pdf" }], code: "agent_busy" }));
    const mock = client(attach, on);
    vi.mocked(mock.send).mockResolvedValue({ clientMessageId: "x", accepted: true as const, messageId: "m2", at: 2 });
    await ready(mock);
    const button = await screen.findByTestId("direct-chat-attach");
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await screen.findByTestId("direct-chat-attach-note");
    // writing is not sending: the line stays
    const composer = screen.getByTestId("direct-chat-composer-row").querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "ciao" } });
    expect(screen.getByTestId("direct-chat-attach-note")).toBeInTheDocument();
    fireEvent.keyDown(composer, { key: "Enter" });
    await waitFor(() => expect(mock.send).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByTestId("direct-chat-attach-note")).toBeNull());
  });

  it("says nothing when the person closes the system's window", async () => {
    const attach: Attach = vi.fn(async () => ({ outcome: "cancelled" as const }));
    await ready(client(attach, on));
    const button = await screen.findByTestId("direct-chat-attach");
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(attach).toHaveBeenCalledOnce());
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.queryByTestId("direct-chat-attach-note")).toBeNull();
  });

  it("is off with the reason when the team is on a server", async () => {
    const attach: Attach = vi.fn();
    await ready(client(attach, vi.fn(async () => ({ available: false, code: "attach_vps" }))));
    const off = await screen.findByTestId("direct-chat-attach-off");
    expect(off).toHaveTextContent("Attachments work with the team on this computer. This team runs on a server.");
    const button = screen.getByTestId("direct-chat-attach");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(attach).not.toHaveBeenCalled();
  });

  it("is off in the read-only view, with the bridge's reason, and when the bridge cannot say", async () => {
    const attach: Attach = vi.fn();
    await ready(client(attach, vi.fn(async () => ({ available: false, code: "attach_read_only" }))), { locked: true });
    expect(screen.getByTestId("direct-chat-attach")).toBeDisabled();
    expect(await screen.findByTestId("direct-chat-attach-off")).toHaveTextContent("Read-only view");
    cleanup();
    await ready(client(attach, vi.fn(async () => { throw new Error("boom"); })));
    await waitFor(() => expect(screen.getByTestId("direct-chat-attach")).toBeDisabled());
    expect(attach).not.toHaveBeenCalled();
  });

  it("says why a file was not attached, in words, and never the code or a path", async () => {
    const attach: Attach = vi.fn(async () => { throw { code: "attachment_too_big" }; });
    await ready(client(attach, on));
    const button = await screen.findByTestId("direct-chat-attach");
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    const note = await screen.findByTestId("direct-chat-attach-note");
    expect(note).toHaveTextContent("The file is over 5 MB.");
    expect(note).toHaveAttribute("role", "alert");
    expect(note.textContent).not.toMatch(/attachment_too_big|\//);
  });

  it("says a generic failure for a code it does not know", async () => {
    const attach: Attach = vi.fn(async () => { throw { code: "something_new" }; });
    await ready(client(attach, on));
    const button = await screen.findByTestId("direct-chat-attach");
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByTestId("direct-chat-attach-note")).toHaveTextContent("The file could not be attached.");
  });

  it("says when the file is in the folder but the Assistant was not told", async () => {
    const attach: Attach = vi.fn(async () => ({ outcome: "saved_not_sent" as const, files: [{ file: "allegato-20261029-101500.pdf", kind: "pdf", bytes: 1, displayName: "cv.pdf" }], code: "agent_busy" }));
    await ready(client(attach, on));
    const button = await screen.findByTestId("direct-chat-attach");
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    const note = await screen.findByTestId("direct-chat-attach-note");
    expect(note).toHaveAttribute("data-kind", "warn");
    expect(note).toHaveTextContent("cv.pdf is in the attachments folder, but the message to the Assistant did not go.");
  });

  it("takes one file at a time: a second click while the first is in hand does nothing", async () => {
    let finish: (value: Awaited<ReturnType<Attach>>) => void = () => undefined;
    const attach: Attach = vi.fn(() => new Promise<Awaited<ReturnType<Attach>>>((resolve) => { finish = resolve; }));
    await ready(client(attach, on));
    const button = await screen.findByTestId("direct-chat-attach");
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    fireEvent.click(button);
    expect(attach).toHaveBeenCalledOnce();
    finish({ outcome: "cancelled" });
    await waitFor(() => expect(button).toBeEnabled());
  });
});

describe("the words of the paperclip", () => {
  it("are in every language, with the same codes", () => {
    const base = DIRECT_CHAT_TEXT.it;
    for (const [locale, text] of Object.entries(DIRECT_CHAT_TEXT)) {
      expect(Object.keys(text.attachErrors).sort(), locale).toEqual(Object.keys(base.attachErrors).sort());
      expect(Object.keys(text.attachOff).sort(), locale).toEqual(Object.keys(base.attachOff).sort());
      for (const words of [...Object.values(text.attachErrors), ...Object.values(text.attachOff), text.attach, text.attachSavedNotSent]) {
        expect(words.trim().length, locale).toBeGreaterThan(5);
      }
      expect(text.attachSavedNotSent, locale).toContain("{name}");
    }
  });
});

describe("the attachment in the conversation", () => {
  const PATH = "/jht_user/allegati/cv-20261028-153045.pdf";

  it("shows the sentence only: the bracket with the path of the copy is the Assistant's", () => {
    expect(withoutAttachmentPath(`Ho allegato il mio CV. [attachment for my profile: ${PATH}]`)).toBe("Ho allegato il mio CV.");
    expect(withoutAttachmentPath(`I attached my CV. [attachment for my profile: /jht_user/allegati/cv-20261028-153045-2.docx]`)).toBe("I attached my CV.");
  });

  it("takes off only that exact shape at the very end, never what someone wrote", () => {
    const kept = [
      "Ho allegato il mio CV.",
      `Guarda [attachment for my profile: ${PATH}] e dimmi`,
      `ciao [attachment for my profile: /jht_user/allegati/../etc/passwd]`,
      `ciao [attachment for my profile: /jht_user/altro/cv-20261028-153045.pdf]`,
      `ciao [attachment for my profile: /jht_user/allegati/Mario Rossi.pdf]`,
      `ciao [attachment for my profile: ${PATH}] ancora`,
      `[attachment for my profile: ${PATH}]`,
    ];
    for (const text of kept) expect(withoutAttachmentPath(text), text).toBe(text);
  });

  it("is hidden from the person's own bubble and from a quote of it, but not from the Assistant's words", async () => {
    document.cookie = "NEXT_LOCALE=it; path=/";
    const mock = client(vi.fn() as unknown as Attach, on);
    vi.mocked(mock.read).mockResolvedValue({
      messages: [
        { id: "1", role: "user", text: `Ho allegato il mio CV. [attachment for my profile: ${PATH}]`, at: 1 },
        { id: "2", role: "agent", text: `Ho letto ${PATH}`, at: 2 },
      ],
      cursor: "2",
    });
    render(<DirectChatScreen client={mock} initialAgentId="assistente" />);
    await screen.findByText("Ho allegato il mio CV.");
    expect(document.body.textContent).not.toContain("[attachment for my profile");
    // what the Assistant wrote about its file is its own text
    expect(document.body.textContent).toContain(`Ho letto ${PATH}`);
  });
});


describe("the paperclip takes any file, several at once, and says which one was refused by its place", () => {
  it("says the reason and the place of the file in the choice, never its name, when nothing was copied", async () => {
    const attach: Attach = vi.fn(async () => ({ outcome: "refused" as const, code: "attachment_executable", position: 2 }));
    await ready(client(attach, on));
    const button = await screen.findByTestId("direct-chat-attach");
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    const note = await screen.findByTestId("direct-chat-attach-note");
    expect(note.textContent).toBe("File 3: A program or a script cannot be attached.");
    expect(note).toHaveAttribute("data-kind", "error");
  });

  it("has a sentence for every refusal the native side can give, in the seven languages", () => {
    const codes = ["attachment_empty", "attachment_executable", "attachment_archive", "attachments_too_many", "attachments_too_big_together", "attachment_type", "attachment_too_big"] as const;
    for (const [locale, text] of Object.entries(DIRECT_CHAT_TEXT)) {
      for (const code of codes) expect(text.attachErrors[code], `${locale} ${code}`).toMatch(/\S/);
      expect(text.attachFilePosition, locale).toContain("{n}");
    }
    expect(DIRECT_CHAT_TEXT.it.attachErrors.attachments_too_many).toBe("Al massimo 5 file per volta.");
    expect(DIRECT_CHAT_TEXT.it.attachErrors.attachments_too_big_together).toBe("I file insieme superano i 15 MB.");
  });

  it("names the files that were saved but not told to the Assistant, as the person named them", async () => {
    const attach: Attach = vi.fn(async () => ({
      outcome: "saved_not_sent" as const,
      code: "agent_busy",
      files: [
        { file: "allegato-20261029-101500.pdf", kind: "pdf", bytes: 1, displayName: "Alpha.pdf" },
        { file: "allegato-20261029-101500.png", kind: "image", bytes: 2, displayName: null },
        { file: "allegato-20261029-101500.txt", kind: "text", bytes: 3, displayName: "Beta.txt" },
      ],
    }));
    await ready(client(attach, on));
    const button = await screen.findByTestId("direct-chat-attach");
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    const note = await screen.findByTestId("direct-chat-attach-note");
    expect(note.textContent).toContain("Alpha.pdf, Beta.txt");
  });

  it("always says, beside the paperclip, who reads the file and where its contents go, in the person's language", async () => {
    await ready(client(vi.fn(async () => ({ outcome: "cancelled" as const })), on));
    const line = await screen.findByTestId("direct-chat-attach-privacy");
    expect(line.textContent).toBe(DIRECT_CHAT_TEXT.en.attachPrivacy);
    for (const [locale, text] of Object.entries(DIRECT_CHAT_TEXT)) {
      expect(text.attachPrivacy, locale).toMatch(/\S/);
      expect(text.attachPrivacy, locale).not.toMatch(/[{}]/);
    }
    expect(DIRECT_CHAT_TEXT.it.attachPrivacy).toBe("Gli agenti della tua squadra leggono il file e il suo contenuto passa al fornitore AI che hai scelto.");
  });

  it("shows no such line where there is no paperclip", async () => {
    await ready(client(vi.fn(async () => ({ outcome: "cancelled" as const })), on), { agent: "capitano" });
    expect(screen.queryByTestId("direct-chat-attach-privacy")).toBeNull();
  });
});
