import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppExitDialog from "./AppExitDialog";
import { APP_EXIT_TEXT } from "./AppExitDialog.i18n";
import { EXIT_EVENT, EXIT_OPEN_EVENT, rememberedExit } from "../lib/app-exit";
import { fill } from "../lib/text-slots";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
  listeners: new Map<string, () => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: native.isTauri }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: () => void) => {
    native.listeners.set(name, handler);
    return () => native.listeners.delete(name);
  },
}));

const T = APP_EXIT_TEXT.it;

interface Team {
  host?: "local" | "vps" | "none";
  /** Containers that are not the team's on its machine, as the native side counts them. */
  others?: unknown;
  /** What each poll answers, in order; the last one repeats. */
  polls?: { ready: boolean; active: number }[];
  failing?: Record<string, string>;
}

/** The native side as a team on `host`. */
function team({ host = "local", others, polls = [{ ready: true, active: 0 }], failing = {} }: Team = {}) {
  let poll = 0;
  native.invoke.mockImplementation(async (command: string) => {
    if (failing[command]) throw { code: failing[command] };
    if (command === "app_exit_state") return others === undefined ? { team: host } : { team: host, otherContainers: others };
    if (command === "app_exit_poll") return polls[Math.min(poll++, polls.length - 1)];
    return undefined;
  });
}
const calls = () => native.invoke.mock.calls.map(([command, args]) => (args ? `${command}:${JSON.stringify(args)}` : command));
const closeButton = () => act(async () => native.listeners.get(EXIT_EVENT)?.());
const navbarButton = () => act(async () => void window.dispatchEvent(new Event(EXIT_OPEN_EVENT)));

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=it; path=/";
  localStorage.clear();
  native.invoke.mockReset();
  native.isTauri.mockReturnValue(true);
  native.listeners.clear();
});
afterEach(cleanup);

describe("AppExitDialog", () => {
  it("answers the close button by saying the page is there, and asks where the team is, before showing anything", async () => {
    team();
    render(<AppExitDialog />);
    await closeButton();
    expect(await screen.findByRole("dialog")).toHaveTextContent(T.title);
    expect(calls().slice(0, 2)).toEqual(["app_exit_ack", "app_exit_state"]);
    expect(calls().some((call) => call.startsWith("app_exit_finish"))).toBe(false);
  });

  it.each([
    ["ordered", "app_exit_order"],
    ["forced", 'app_exit_finish:{"mode":"forced"}'],
    ["detach", 'app_exit_finish:{"mode":"detach"}'],
  ])("sends nothing but the acknowledgement and the state while the question shows; «%s» is sent only after the click", async (mode, expected) => {
    team();
    render(<AppExitDialog />);
    await closeButton();
    await screen.findByRole("dialog");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
    // the exit's other native commands (order, poll, finish) wait for the person's choice
    expect(calls()).toEqual(["app_exit_ack", "app_exit_state"]);
    await userEvent.click(await screen.findByTestId(`app-exit-${mode}`));
    await waitFor(() => expect(calls()).toContain(expected));
  });

  it("says before the choice that the machine stays on when other containers use it", async () => {
    team({ others: 2 });
    render(<AppExitDialog />);
    await closeButton();
    expect(await screen.findByTestId("app-exit-others")).toHaveTextContent(fill(T.othersKept, { count: 2 }));
    // the three ways are still offered, and the note is not an obstacle
    for (const mode of ["ordered", "forced", "detach"]) expect(screen.getByTestId(`app-exit-${mode}`)).toBeInTheDocument();
  });

  it.each([[0], [undefined], ["2"], [-1], [1.5]])("says nothing about other containers when the native side says %s", async (others) => {
    team({ others });
    render(<AppExitDialog />);
    await closeButton();
    await screen.findByTestId("app-exit-ordered");
    expect(screen.queryByTestId("app-exit-others")).toBeNull();
  });

  it("offers the three ways for a team on this computer", async () => {
    team();
    render(<AppExitDialog />);
    await closeButton();
    for (const mode of ["ordered", "forced", "detach"]) expect(await screen.findByTestId(`app-exit-${mode}`)).toBeInTheDocument();
  });

  it.each(["vps", "none"] as const)("just closes the window when the team is %s: nothing of it is stopped and nothing is asked", async (host) => {
    team({ host });
    render(<AppExitDialog />);
    await closeButton();
    await waitFor(() => expect(calls()).toContain('app_exit_finish:{"mode":"detach"}'));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls().filter((call) => /order|poll/.test(call))).toEqual([]);
  });

  it("closes the window when it cannot tell where the team is", async () => {
    native.invoke.mockImplementation(async (command: string) => {
      if (command === "app_exit_state") throw { code: "account_scope_inactive" };
      return undefined;
    });
    render(<AppExitDialog />);
    await closeButton();
    await waitFor(() => expect(calls()).toContain('app_exit_finish:{"mode":"detach"}'));
  });

  it("«Lascia lavorare» closes only the window", async () => {
    team();
    const user = userEvent.setup();
    render(<AppExitDialog />);
    await closeButton();
    await user.click(await screen.findByTestId("app-exit-detach"));
    await waitFor(() => expect(calls()).toContain('app_exit_finish:{"mode":"detach"}'));
    expect(calls().filter((call) => /order|poll/.test(call))).toEqual([]);
  });

  it("«Ferma subito» stops without giving the Capitano an order", async () => {
    team();
    const user = userEvent.setup();
    render(<AppExitDialog />);
    await closeButton();
    await user.click(await screen.findByTestId("app-exit-forced"));
    await waitFor(() => expect(calls()).toContain('app_exit_finish:{"mode":"forced"}'));
    expect(calls()).not.toContain("app_exit_order");
  });

  it("«Fermali in ordine» gives the order, waits for the Capitano's flag and only then stops", async () => {
    team({ polls: [{ ready: false, active: 5 }, { ready: false, active: 2 }, { ready: true, active: 0 }] });
    const user = userEvent.setup();
    // slow enough that the first look has not answered yet when the «waiting» text is read
    render(<AppExitDialog pollMs={100} />);
    await closeButton();
    await user.click(await screen.findByTestId("app-exit-ordered"));
    expect(await screen.findByTestId("app-exit-waiting")).toHaveTextContent(fill(T.waiting, { count: 0 }));
    await waitFor(() => expect(calls()).toContain('app_exit_finish:{"mode":"ordered"}'));
    const order = calls();
    expect(order.indexOf("app_exit_order")).toBeLessThan(order.indexOf("app_exit_poll"));
    expect(order.filter((call) => call === "app_exit_poll")).toHaveLength(3);
    expect(order.indexOf('app_exit_finish:{"mode":"ordered"}')).toBeGreaterThan(order.lastIndexOf("app_exit_poll"));
  });

  it("does not take «no session open» for «done»: only the flag ends the wait", async () => {
    team({ polls: [{ ready: false, active: 0 }] });
    const user = userEvent.setup();
    render(<AppExitDialog pollMs={5} slowMs={30} />);
    await closeButton();
    await user.click(await screen.findByTestId("app-exit-ordered"));
    expect(await screen.findByTestId("app-exit-force-now")).toBeInTheDocument();
    expect(calls().some((call) => call.startsWith("app_exit_finish"))).toBe(false);
  });

  it("after a slow wait the person can force the stop", async () => {
    team({ polls: [{ ready: false, active: 3 }] });
    const user = userEvent.setup();
    render(<AppExitDialog pollMs={5} slowMs={30} />);
    await closeButton();
    await user.click(await screen.findByTestId("app-exit-ordered"));
    await user.click(await screen.findByTestId("app-exit-force-now"));
    await waitFor(() => expect(calls()).toContain('app_exit_finish:{"mode":"forced"}'));
    // the ordered wait does not go on polling behind the forced stop
    const polled = calls().filter((call) => call === "app_exit_poll").length;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(calls().filter((call) => call === "app_exit_poll").length).toBe(polled);
  });

  it("an order the Capitano did not get leaves the app open and says so", async () => {
    team({ failing: { app_exit_order: "app_exit_order_not_sent" } });
    const user = userEvent.setup();
    render(<AppExitDialog pollMs={5} />);
    await closeButton();
    await user.click(await screen.findByTestId("app-exit-ordered"));
    expect(await screen.findByTestId("app-exit-failed")).toHaveTextContent(T.failed);
    expect(calls().some((call) => call.startsWith("app_exit_finish"))).toBe(false);
    expect(screen.getByTestId("app-exit-forced")).toBeInTheDocument();
  });

  it("a stop that failed leaves the app open and offers the three ways again", async () => {
    team({ failing: { app_exit_finish: "app_exit_down_failed" } });
    const user = userEvent.setup();
    render(<AppExitDialog />);
    await closeButton();
    await user.click(await screen.findByTestId("app-exit-forced"));
    expect(await screen.findByTestId("app-exit-failed")).toBeInTheDocument();
    for (const mode of ["ordered", "forced", "detach"]) expect(screen.getByTestId(`app-exit-${mode}`)).toBeInTheDocument();
  });

  it("«Resta nell'app» tells the native side, and Escape does the same", async () => {
    team();
    const user = userEvent.setup();
    render(<AppExitDialog />);
    await closeButton();
    await user.click(await screen.findByTestId("app-exit-stay"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls()).toContain("app_exit_cancel");
    await closeButton();
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls().filter((call) => call === "app_exit_cancel")).toHaveLength(2);
  });

  it("staying while the agents are still being waited for ends the wait", async () => {
    team({ polls: [{ ready: false, active: 3 }] });
    const user = userEvent.setup();
    render(<AppExitDialog pollMs={5} />);
    await closeButton();
    await user.click(await screen.findByTestId("app-exit-ordered"));
    await screen.findByTestId("app-exit-waiting");
    await user.click(screen.getByTestId("app-exit-stay"));
    const polled = calls().filter((call) => call === "app_exit_poll").length;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(calls().filter((call) => call === "app_exit_poll").length).toBe(polled);
    expect(calls().some((call) => call.startsWith("app_exit_finish"))).toBe(false);
  });

  it("a second close while the agents are being waited for neither gives the order again nor ends the wait", async () => {
    localStorage.setItem("jht.app-exit.choice", "ordered");
    team({ polls: [{ ready: false, active: 3 }, { ready: false, active: 3 }, { ready: true, active: 0 }] });
    render(<AppExitDialog pollMs={5} />);
    await closeButton();
    await screen.findByTestId("app-exit-waiting");
    await closeButton();
    await closeButton();
    await waitFor(() => expect(calls()).toContain('app_exit_finish:{"mode":"ordered"}'));
    expect(calls().filter((call) => call === "app_exit_order")).toHaveLength(1);
  });

  it("remembers the choice only when asked, and the close button then applies it without asking", async () => {
    team();
    const user = userEvent.setup();
    const { unmount } = render(<AppExitDialog />);
    await closeButton();
    await user.click(await screen.findByTestId("app-exit-remember"));
    await user.click(screen.getByTestId("app-exit-forced"));
    await waitFor(() => expect(rememberedExit()).toBe("forced"));
    unmount();
    native.invoke.mockClear();
    team();
    render(<AppExitDialog />);
    await closeButton();
    await waitFor(() => expect(calls()).toContain('app_exit_finish:{"mode":"forced"}'));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a choice not marked to remember is not kept", async () => {
    team();
    const user = userEvent.setup();
    render(<AppExitDialog />);
    await closeButton();
    await user.click(await screen.findByTestId("app-exit-detach"));
    await waitFor(() => expect(calls()).toContain('app_exit_finish:{"mode":"detach"}'));
    expect(rememberedExit()).toBeNull();
  });

  it("the navbar button always asks, shows the remembered choice as ticked, and unticking forgets it", async () => {
    localStorage.setItem("jht.app-exit.choice", "forced");
    team();
    const user = userEvent.setup();
    render(<AppExitDialog />);
    await navbarButton();
    const remember = await screen.findByTestId("app-exit-remember");
    expect(remember).toBeChecked();
    expect(calls().some((call) => call.startsWith("app_exit_finish"))).toBe(false);
    await user.click(remember);
    await user.click(screen.getByTestId("app-exit-detach"));
    await waitFor(() => expect(calls()).toContain('app_exit_finish:{"mode":"detach"}'));
    expect(rememberedExit()).toBeNull();
  });

  it("a remembered word that is not a way is ignored", () => {
    localStorage.setItem("jht.app-exit.choice", "hibernate");
    expect(rememberedExit()).toBeNull();
  });

  it("says its words in the app's language", async () => {
    document.cookie = "NEXT_LOCALE=en; path=/";
    team();
    render(<AppExitDialog />);
    await closeButton();
    expect(await screen.findByRole("dialog")).toHaveTextContent(APP_EXIT_TEXT.en.title);
  });

  it("stops listening when it is unmounted", async () => {
    team();
    const { unmount } = render(<AppExitDialog />);
    await waitFor(() => expect(native.listeners.has(EXIT_EVENT)).toBe(true));
    unmount();
    expect(native.listeners.has(EXIT_EVENT)).toBe(false);
  });
});
