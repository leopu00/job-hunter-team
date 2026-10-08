import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BrokerLoginViewer, DONE_CLOSE_MS } from "./BrokerLoginViewer";
import type { ConnectionFactory, ScreenConnection } from "./LiveScreenViewer";
import type { BrokerLoginStatus } from "../lib/broker-login";
import { describeError } from "../lib/error-catalog";

class FakeConnection extends EventTarget implements ScreenConnection {
  viewOnly = true;
  scaleViewport = false;
  resizeSession = true;
  background = "";
  focusOnClick = false;
  focus = vi.fn();
  disconnect = vi.fn();
}

const URL_WITH_TOKEN = "ws://127.0.0.1:6081/websockify?token=synthetic-one-time-token";

function setup({
  loadSession = vi.fn().mockResolvedValue({ url: URL_WITH_TOKEN }),
  status = { view: "idle", linkedin: "logged_in", lastReason: "logged_in" } as BrokerLoginStatus,
} = {}) {
  const connections: FakeConnection[] = [];
  const connect = vi.fn<ConnectionFactory>(async () => {
    const connection = new FakeConnection();
    connections.push(connection);
    return connection;
  });
  const loadStatus = vi.fn().mockResolvedValue(status);
  const close = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <BrokerLoginViewer loadSession={loadSession} loadStatus={loadStatus} close={close} connect={connect} />,
  );
  return { connect, connections, loadSession, loadStatus, close, view };
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

it("connects once to the loopback URL with the token, and passes keyboard and mouse", async () => {
  const { connect, connections, loadSession } = setup();
  await flush();

  expect(loadSession).toHaveBeenCalledOnce();
  expect(connect).toHaveBeenCalledOnce();
  const [target, url, options] = connect.mock.calls[0];
  expect(target).toBe(screen.getByTestId("live-screen-canvas"));
  expect(url).toBe(URL_WITH_TOKEN);
  expect(options).toEqual({ shared: true });
  expect(connections[0].viewOnly).toBe(false);
  expect(connections[0].focusOnClick).toBe(true);

  act(() => connections[0].dispatchEvent(new Event("connect")));
  expect(screen.getByRole("status")).toHaveTextContent("Puoi scrivere");
  expect(connections[0].focus).toHaveBeenCalledOnce();
});

it("closes the window by itself after a finished login, and never reconnects", async () => {
  const { connect, connections, close, loadStatus } = setup();
  await flush();
  act(() => connections[0].dispatchEvent(new Event("connect")));
  act(() => connections[0].dispatchEvent(new Event("disconnect")));
  await flush();

  expect(loadStatus).toHaveBeenCalledOnce();
  expect(screen.getByText("Accesso a LinkedIn fatto. La finestra si chiude da sola.")).toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
  await act(async () => {
    vi.advanceTimersByTime(DONE_CLOSE_MS);
  });
  expect(close).toHaveBeenCalledOnce();
  // The token was good for one connection: no second attempt, ever.
  await act(async () => {
    vi.advanceTimersByTime(60_000);
  });
  expect(connect).toHaveBeenCalledOnce();
});

it("tells why the session ended and leaves the closing to the person", async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const { connect, connections, close } = setup({
    status: { view: "idle", linkedin: "login_required", lastReason: "login_timeout" },
  });
  await flush();
  act(() => connections[0].dispatchEvent(new Event("disconnect")));
  await flush();

  const described = describeError("login_timeout");
  expect(screen.getByText(`${described.text} ${described.action}`)).toBeInTheDocument();
  await act(async () => {
    vi.advanceTimersByTime(60_000);
  });
  expect(close).not.toHaveBeenCalled();
  expect(connect).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: "Chiudi" }));
  expect(close).toHaveBeenCalledOnce();
});

it("does not connect when the one-time token is no longer there", async () => {
  const { connect } = setup({ loadSession: vi.fn().mockRejectedValue({ code: "token_expired" }) });
  await flush();

  const described = describeError("token_expired");
  expect(screen.getByText(`${described.text} ${described.action}`)).toBeInTheDocument();
  expect(connect).not.toHaveBeenCalled();
});

it("an unknown failure reads as the screen not being available, never as raw text", async () => {
  const { connect } = setup({ loadSession: vi.fn().mockRejectedValue(new Error("raw backend detail")) });
  await flush();

  const described = describeError("view_unavailable");
  expect(screen.getByText(`${described.text} ${described.action}`)).toBeInTheDocument();
  expect(screen.queryByText(/raw backend detail/)).not.toBeInTheDocument();
  expect(connect).not.toHaveBeenCalled();
});

it("disconnects when the window goes away", async () => {
  const { connections, view, loadStatus } = setup();
  await flush();
  view.unmount();
  expect(connections[0].disconnect).toHaveBeenCalledOnce();
  expect(loadStatus).not.toHaveBeenCalled();
});
