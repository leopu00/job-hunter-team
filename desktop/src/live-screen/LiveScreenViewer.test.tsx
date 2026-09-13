import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, vi } from "vitest";
import {
  LiveScreenViewer,
  RETRY_DELAY_MS,
  type ConnectionFactory,
  type ScreenConnection,
} from "./LiveScreenViewer";

class FakeConnection extends EventTarget implements ScreenConnection {
  viewOnly = false;
  scaleViewport = false;
  resizeSession = true;
  background = "";
  disconnect = vi.fn();
}

const session = { url: "ws://127.0.0.1:6080/websockify", password: "Ab3dE6gH" };

function setup(loadSession = vi.fn().mockResolvedValue(session)) {
  const connections: FakeConnection[] = [];
  const connect = vi.fn<ConnectionFactory>(async () => {
    const connection = new FakeConnection();
    connections.push(connection);
    return connection;
  });
  const view = render(<LiveScreenViewer loadSession={loadSession} connect={connect} />);
  return { connect, connections, loadSession, view };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

it("connects to the loopback stream with the session password, view-only", async () => {
  const { connect, connections } = setup();
  await flush();

  expect(connect).toHaveBeenCalledTimes(1);
  const [target, url, options] = connect.mock.calls[0];
  expect(target).toBe(screen.getByTestId("live-screen-canvas"));
  expect(url).toBe("ws://127.0.0.1:6080/websockify");
  expect(options).toEqual({ credentials: { password: "Ab3dE6gH" }, shared: true });

  // Input bloccato anche lato client, e lo schermo si adatta alla finestra
  // invece di chiedere al container di cambiare risoluzione.
  expect(connections[0].viewOnly).toBe(true);
  expect(connections[0].scaleViewport).toBe(true);
  expect(connections[0].resizeSession).toBe(false);

  act(() => {
    connections[0].dispatchEvent(new Event("connect"));
  });
  expect(screen.getByRole("status")).toHaveTextContent("In diretta · sola visione");
});

it("waits for a stopped screen and connects by itself once it is up", async () => {
  const loadSession = vi
    .fn()
    .mockRejectedValueOnce({ code: "screen_not_running" })
    .mockResolvedValue(session);
  const { connect } = setup(loadSession);
  await flush();

  expect(screen.getByText(/non è acceso/)).toBeInTheDocument();
  expect(connect).not.toHaveBeenCalled();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
  });
  await flush();
  expect(loadSession).toHaveBeenCalledTimes(2);
  expect(connect).toHaveBeenCalledTimes(1);
});

it("rereads the session after a rejected password, because a restart rotates it", async () => {
  const loadSession = vi
    .fn()
    .mockResolvedValueOnce({ ...session, password: "OldPass1" })
    .mockResolvedValue(session);
  const { connect, connections } = setup(loadSession);
  await flush();

  act(() => {
    connections[0].dispatchEvent(new Event("securityfailure"));
    connections[0].dispatchEvent(new Event("disconnect"));
  });
  expect(screen.getByText(/nuova chiave/)).toBeInTheDocument();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
  });
  await flush();
  expect(loadSession).toHaveBeenCalledTimes(2);
  expect(connect.mock.calls[1][2]).toEqual({ credentials: { password: "Ab3dE6gH" }, shared: true });
});

it("stops on a configuration error and retries only when asked", async () => {
  const loadSession = vi
    .fn()
    .mockRejectedValueOnce({ code: "invalid_port" })
    .mockResolvedValue(session);
  const { connect } = setup(loadSession);
  await flush();

  expect(screen.getByText(/JHT_LIVE_SCREEN_PORT/)).toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 3);
  });
  expect(loadSession).toHaveBeenCalledTimes(1);

  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await user.click(screen.getByRole("button", { name: "Riprova" }));
  await flush();
  expect(connect).toHaveBeenCalledTimes(1);
});

it("closes the stream when the window goes away", async () => {
  const { connections, view } = setup();
  await flush();
  view.unmount();
  expect(connections[0].disconnect).toHaveBeenCalled();
});
