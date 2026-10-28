import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DirectChatScreen from "./DirectChatScreen";
import type { DirectChatClient } from "./direct-chat-contract";
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

  it("asks for a file with the person's language and no path, and says what was attached by the person's own name", async () => {
    const attach: Attach = vi.fn(async () => ({ outcome: "sent" as const, displayName: "Mario Rossi CV.pdf" }));
    const mock = client(attach, on);
    await ready(mock);
    const button = await screen.findByTestId("direct-chat-attach");
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(attach).toHaveBeenCalledOnce());
    const args = vi.mocked(attach).mock.calls[0][0];
    expect(Object.keys(args).sort()).toEqual(["clientMessageId", "locale"]);
    expect(args.locale).toBe("en");
    expect(args.clientMessageId).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    const note = await screen.findByTestId("direct-chat-attach-note");
    expect(note).toHaveTextContent("Attached: Mario Rossi CV.pdf. The Assistant will use it for your profile.");
    expect(note).toHaveAttribute("data-kind", "ok");
    expect(mock.send).not.toHaveBeenCalled();
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
    expect(note).toHaveTextContent("The file is over 10 MB.");
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
    const attach: Attach = vi.fn(async () => ({ outcome: "saved_not_sent" as const, displayName: "cv.pdf", code: "agent_busy" }));
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
      for (const words of [...Object.values(text.attachErrors), ...Object.values(text.attachOff), text.attach, text.attachSent, text.attachSavedNotSent]) {
        expect(words.trim().length, locale).toBeGreaterThan(5);
      }
      expect(text.attachSent, locale).toContain("{name}");
      expect(text.attachSavedNotSent, locale).toContain("{name}");
    }
  });
});
