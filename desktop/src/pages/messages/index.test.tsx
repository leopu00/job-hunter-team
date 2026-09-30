import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/direct-chat", () => ({
  closeDirectChat: vi.fn(),
  directChatStatus: vi.fn(),
  readDirectChat: vi.fn(),
  reconnectDirectChat: vi.fn(),
  sendDirectChat: vi.fn(),
  subscribeDirectChat: vi.fn(),
}));

import {
  closeDirectChat,
  directChatStatus,
  readDirectChat,
  subscribeDirectChat,
} from "../../lib/direct-chat";
import MessagesPage from ".";

beforeEach(() => {
  vi.mocked(directChatStatus).mockResolvedValue({ state: "ready" });
  vi.mocked(subscribeDirectChat).mockResolvedValue({ state: "ready" });
  vi.mocked(readDirectChat).mockResolvedValue({
    messages: [{ id: "remote-1", role: "agent", text: "Risposta diretta", at: 1 }],
  });
  vi.mocked(closeDirectChat).mockResolvedValue();
});

describe("MessagesPage", () => {
  it("wires the desktop route to the direct VPS transport", async () => {
    const view = render(<MessagesPage params={{}} search={new URLSearchParams()} />);

    expect(await screen.findByText("Risposta diretta")).toBeInTheDocument();
    expect(directChatStatus).toHaveBeenCalledOnce();
    expect(subscribeDirectChat).toHaveBeenCalledWith(expect.any(Function));
    expect(readDirectChat).toHaveBeenCalledWith("capitano", undefined);

    view.unmount();
    await waitFor(() => expect(closeDirectChat).toHaveBeenCalledOnce());
  });
});
