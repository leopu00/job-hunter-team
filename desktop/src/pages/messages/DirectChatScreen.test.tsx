import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import DirectChatScreen from "./DirectChatScreen";
import type {
  DirectChatClient,
  DirectChatEvent,
  DirectChatPage,
  DirectChatReceipt,
  DirectChatStatus,
} from "./direct-chat-contract";

function client(initial: DirectChatStatus = { state: "ready" }) {
  let onEvent: ((event: DirectChatEvent) => void) | undefined;
  const mock: DirectChatClient = {
    subscribe: vi.fn(async ({ onEvent: next }) => {
      onEvent = next;
      return initial;
    }),
    status: vi.fn(async () => initial),
    reconnect: vi.fn(async (): Promise<DirectChatStatus> => ({ state: "ready" })),
    read: vi.fn(async (): Promise<DirectChatPage> => ({
      messages: [
        { id: "a1", role: "agent", text: "Messaggio dalla VPS", at: 1 },
      ],
      cursor: "opaque-cursor",
    })),
    send: vi.fn(async ({ clientMessageId }): Promise<DirectChatReceipt> => ({
      clientMessageId,
      accepted: true,
      messageId: "remote-user-1",
      at: 2,
    })),
    close: vi.fn(),
  };
  return { mock, emit: (event: DirectChatEvent) => onEvent?.(event) };
}

function viewport(width: number, height: number, zoom = "1.15") {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
  document.documentElement.style.setProperty("--zoom", zoom);
}

afterEach(() => {
  document.documentElement.style.removeProperty("--zoom");
});

describe("DirectChatScreen", () => {
  it.each([
    [1440, 900, "1"],
    [900, 420, "1"],
    [1000, 480, "1.4"],
  ])(
    "confines the chat at %sx%s with zoom %s and only scrolls the transcript",
    async (width, height, zoom) => {
      viewport(Number(width), Number(height), String(zoom));
      const { mock } = client();
      render(<DirectChatScreen client={mock} />);
      await screen.findByText("Messaggio dalla VPS");

      const shell = screen.getByTestId("direct-chat-shell");
      const transcript = screen.getByTestId("direct-chat-transcript");
      const composer = screen.getByTestId("direct-chat-composer");
      const conversation = screen.getByRole("region", { name: "Conversazione con Capitano" });
      expect(shell).toHaveStyle({ height: "calc(100svh / var(--zoom, 1) - 3.5rem)" });
      expect(shell.className).toMatch(/min-h-0/);
      expect(shell.className).toMatch(/overflow-hidden/);
      expect(conversation.className).toMatch(/min-h-0/);
      expect(conversation.className).toMatch(/overflow-hidden/);
      expect(transcript.className).toMatch(/flex-1/);
      expect(transcript.className).toMatch(/min-h-0/);
      expect(transcript.className).toMatch(/overflow-y-auto/);
      expect(shell.querySelectorAll(".overflow-y-auto")).toHaveLength(1);
      expect(composer.className).toMatch(/shrink-0/);
      expect(composer.className).not.toMatch(/absolute|fixed|sticky/);
    },
  );

  it("selects an agent, reads its direct history and sends through the typed client", async () => {
    viewport(1280, 800);
    const { mock, emit } = client();
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} />);
    await screen.findByText("Messaggio dalla VPS");

    await user.click(screen.getByRole("button", { name: "Scout" }));
    await waitFor(() => expect(mock.read).toHaveBeenCalledWith({ agentId: "scout" }));
    expect(screen.getByRole("region", { name: "Conversazione con Scout" })).toBeInTheDocument();

    const input = screen.getByRole("textbox", { name: "Scrivi a Scout" });
    await user.type(input, "Controlla le nuove posizioni{Enter}");
    await waitFor(() =>
      expect(mock.send).toHaveBeenCalledWith({
        agentId: "scout",
        text: "Controlla le nuove posizioni",
        clientMessageId: expect.any(String),
      }),
    );
    expect(await screen.findByText("Controlla le nuove posizioni")).toBeInTheDocument();

    emit({
      kind: "messages",
      agentId: "scout",
      page: { messages: [{ id: "a2", role: "agent", text: "Ne ho trovate tre.", at: 3 }] },
    });
    expect(await screen.findByText("Ne ho trovate tre.")).toBeInTheDocument();
  });

  it("shows a safe tunnel error and retries without exposing raw transport output", async () => {
    viewport(1000, 500);
    const { mock } = client({ state: "error", code: "/private/key user@host" });
    const user = userEvent.setup();
    render(<DirectChatScreen client={mock} />);

    const status = await screen.findByTestId("direct-chat-status");
    expect(status).toHaveTextContent("Tunnel VPS non disponibile.");
    expect(status).not.toHaveTextContent("/private/key");
    await user.click(within(status).getByRole("button", { name: "Riprova" }));
    expect(mock.reconnect).toHaveBeenCalledOnce();
    await waitFor(() => expect(status).toHaveTextContent("Tunnel VPS collegato"));
  });

  it("closes the direct channel when the page unmounts", async () => {
    const { mock } = client();
    const view = render(<DirectChatScreen client={mock} />);
    await screen.findByText("Messaggio dalla VPS");
    view.unmount();
    expect(mock.close).toHaveBeenCalledOnce();
  });
});
