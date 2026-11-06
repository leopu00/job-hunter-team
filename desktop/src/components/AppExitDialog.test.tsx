import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppExitDialog from "./AppExitDialog";
import { APP_EXIT_TEXT } from "./AppExitDialog.i18n";
import { EXIT_EVENT, EXIT_OPEN_EVENT, rememberedExit } from "../lib/app-exit";
import { fill } from "../lib/text-slots";
import { setSetupExit } from "../lib/setup-exit";

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
  polls?: { ready: boolean; active: number; remaining?: string[] }[];
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
afterEach(() => {
  cleanup();
  setSetupExit(null);
});

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

  it("says the state of the machine is unknown, and not the generic failure, when the native side could not read it", async () => {
    team({ failing: { app_exit_finish: "app_exit_machine_state_unknown" } });
    render(<AppExitDialog />);
    await closeButton();
    await userEvent.click(await screen.findByTestId("app-exit-forced"));
    expect(await screen.findByTestId("app-exit-failed")).toHaveTextContent(T.machineUnknown);
    expect(screen.getByTestId("app-exit-failed")).not.toHaveTextContent(T.failed);
    // the app stays open and the three ways are offered again
    for (const mode of ["ordered", "forced", "detach"]) expect(screen.getByTestId(`app-exit-${mode}`)).toBeInTheDocument();
  });

  it("keeps the generic sentence for any other failure of the stop", async () => {
    team({ failing: { app_exit_finish: "app_exit_machine_not_stopped" } });
    render(<AppExitDialog />);
    await closeButton();
    await userEvent.click(await screen.findByTestId("app-exit-forced"));
    expect(await screen.findByTestId("app-exit-failed")).toHaveTextContent(T.failed);
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

  it("says who has not stopped and, when it takes too long, offers to force", async () => {
    team({ polls: [{ ready: false, active: 2, remaining: ["CAPITANO", "SCOUT-1"] }] });
    const user = userEvent.setup();
    render(<AppExitDialog pollMs={5} slowMs={30} />);
    await closeButton();
    await user.click(await screen.findByTestId("app-exit-ordered"));
    expect(await screen.findByTestId("app-exit-remaining")).toHaveTextContent(fill(T.stillOn, { names: "CAPITANO, SCOUT-1" }));
    expect(await screen.findByTestId("app-exit-force-now")).toBeInTheDocument();
    expect(screen.getByTestId("app-exit-waiting")).toHaveTextContent(T.slow);
  });

  it("an Assistente left up is not waited for: the native side answers «ready» and the stop goes on", async () => {
    // what app_exit_poll answers when only the Assistente is open and the Capitano never wrote its flag
    team({ polls: [{ ready: false, active: 1, remaining: ["SCOUT-1"] }, { ready: true, active: 0, remaining: [] }] });
    const user = userEvent.setup();
    render(<AppExitDialog pollMs={5} slowMs={5000} />);
    await closeButton();
    await user.click(await screen.findByTestId("app-exit-ordered"));
    await waitFor(() => expect(calls()).toContain('app_exit_finish:{"mode":"ordered"}'));
    expect(calls()).not.toContain('app_exit_finish:{"mode":"forced"}');
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

describe("AppExitDialog during the setup, before the team's start", () => {
  const SETUP = { failed: false, step: 2, total: 6, label: "Container" };
  /** The native side during the setup: the machine as found, the team's containers on it, the others. */
  function machine(state: { machine: string; team?: string; teamContainers?: number; others?: number; failing?: Record<string, string> }) {
    native.invoke.mockImplementation(async (command: string) => {
      if (state.failing?.[command]) throw { code: state.failing[command] };
      if (command === "app_exit_state") {
        return { team: state.team ?? "local", otherContainers: state.others ?? 0, machine: state.machine, teamContainers: state.teamContainers ?? 0 };
      }
      return undefined;
    });
  }

  it("says where the setup is and that no team runs, asks the machine's state, and offers no team stop and no «remember»", async () => {
    setSetupExit(SETUP);
    machine({ machine: "on" });
    render(<AppExitDialog />);
    await closeButton();
    const dialog = await screen.findByRole("dialog");
    expect(calls().slice(0, 2)).toEqual(["app_exit_ack", 'app_exit_state:{"setup":true}']);
    expect(screen.getByTestId("app-exit-setup")).toHaveTextContent(fill(T.setupRunning, { step: 2, total: 6, label: "Container" }));
    expect(dialog).toHaveTextContent(T.setupNoTeam);
    expect(dialog).not.toHaveTextContent(T.body);
    expect(screen.getByTestId("app-exit-left-on")).toHaveTextContent(T.leftMachine);
    for (const mode of ["ordered", "forced", "detach", "remember"]) expect(screen.queryByTestId(`app-exit-${mode}`)).toBeNull();
    expect(screen.getByTestId("app-exit-setup-machine")).toHaveFocus();
    await userEvent.click(screen.getByTestId("app-exit-setup-machine"));
    await waitFor(() => expect(calls()).toContain('app_exit_finish:{"mode":"machine"}'));
    expect(calls().some((call) => call.includes('"forced"') || call === "app_exit_order")).toBe(false);
  });

  it("closes leaving the machine on when asked to", async () => {
    setSetupExit(SETUP);
    machine({ machine: "on" });
    render(<AppExitDialog />);
    await closeButton();
    await userEvent.click(await screen.findByTestId("app-exit-setup-detach"));
    await waitFor(() => expect(calls()).toContain('app_exit_finish:{"mode":"detach"}'));
  });

  it("does not apply a choice remembered for the team: it asks", async () => {
    localStorage.setItem("jht.app-exit.choice", "forced");
    setSetupExit({ ...SETUP, failed: true });
    machine({ machine: "on" });
    render(<AppExitDialog />);
    await closeButton();
    expect(await screen.findByTestId("app-exit-setup")).toHaveTextContent(fill(T.setupFailed, { step: 2, total: 6, label: "Container" }));
    expect(calls().some((call) => call.startsWith("app_exit_finish"))).toBe(false);
    expect(rememberedExit()).toBe("forced");
  });

  it.each([
    ["off", {}, "leftNothing"],
    ["on", { others: 2 }, "leftMachine"],
  ] as const)("with the machine %s offers only closing", async (state, extra, left) => {
    setSetupExit(SETUP);
    machine({ machine: state, ...extra });
    render(<AppExitDialog />);
    await closeButton();
    expect(await screen.findByTestId("app-exit-left-on")).toHaveTextContent(T[left]);
    expect(screen.queryByTestId("app-exit-setup-machine")).toBeNull();
    if ("others" in extra) expect(screen.getByTestId("app-exit-others")).toHaveTextContent(fill(T.setupOthers, { count: 2 }));
    expect(screen.getByTestId("app-exit-setup-detach")).toHaveTextContent(T.closeOnly);
  });

  it("names the team's container when the setup has started it, and says when the machine cannot be read", async () => {
    setSetupExit(SETUP);
    machine({ machine: "on", teamContainers: 1 });
    const { unmount } = render(<AppExitDialog />);
    await closeButton();
    expect(await screen.findByTestId("app-exit-left-on")).toHaveTextContent(T.leftMachineAndContainer);
    unmount();
    machine({ machine: "unknown" });
    render(<AppExitDialog />);
    await closeButton();
    expect(await screen.findByTestId("app-exit-left-on")).toHaveTextContent(T.leftUnknown);
    expect(screen.getByTestId("app-exit-setup-machine")).toHaveTextContent(T.tryStopMachine);
  });

  it.each([
    ["app_exit_machine_not_stopped", "setupStopFailed"],
    ["app_exit_machine_state_unknown", "setupMachineUnknown"],
  ] as const)("a machine that did not turn off (%s) is told, and the app stays open with the same choices", async (code, text) => {
    setSetupExit(SETUP);
    machine({ machine: "on", failing: { app_exit_finish: code } });
    render(<AppExitDialog />);
    await closeButton();
    await userEvent.click(await screen.findByTestId("app-exit-setup-machine"));
    expect(await screen.findByTestId("app-exit-failed")).toHaveTextContent(T[text]);
    expect(screen.getByTestId("app-exit-setup-detach")).toBeInTheDocument();
  });

  it("on a computer without a machine, or for a team on a VPS, asks as for a team", async () => {
    setSetupExit(SETUP);
    machine({ machine: "none" });
    const { unmount } = render(<AppExitDialog />);
    await closeButton();
    expect(await screen.findByTestId("app-exit-ordered")).toBeInTheDocument();
    expect(screen.queryByTestId("app-exit-setup")).toBeNull();
    unmount();
    machine({ machine: "on", team: "vps" });
    render(<AppExitDialog />);
    await closeButton();
    await waitFor(() => expect(calls()).toContain('app_exit_finish:{"mode":"detach"}'));
    expect(screen.queryByTestId("app-exit-setup")).toBeNull();
  });
});

describe("«Remember my choice»", () => {
  it("keeps the box and its words on one line, in the dialog's own type, whatever the app's label and input rules say", async () => {
    team();
    render(<AppExitDialog />);
    await navbarButton();
    const box = await screen.findByTestId("app-exit-remember");
    const label = box.closest("label") as HTMLLabelElement;
    expect(label).toHaveTextContent(T.remember);
    expect(label.style.display).toBe("flex");
    expect(label.style.textTransform).toBe("none");
    expect(box).toHaveClass("w-auto");
  });
});
