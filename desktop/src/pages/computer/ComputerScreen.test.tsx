import { readFileSync } from "node:fs";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { describeError } from "../../lib/error-catalog";
import { LOCAL_RUNTIME_REMOVED_EVENT } from "../../lib/local-uninstall";
import { locales } from "@/i18n/config";
import { COMPUTER_TEXT } from "./computer.i18n";
import { ComputerScreen } from "./index";

it("says there is nothing to remove where the removal cannot run, and offers no button", async () => {
  render(<ComputerScreen available={vi.fn().mockResolvedValue(false)} uninstall={vi.fn()} />);
  expect(await screen.findByText(/non c’è niente da rimuovere/)).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("lists what is deleted and what stays, and removes only after an explicit confirmation", async () => {
  const user = userEvent.setup();
  const uninstall = vi.fn().mockResolvedValue({ complete: true, left: [] });
  render(<ComputerScreen available={vi.fn().mockResolvedValue(true)} uninstall={uninstall} />);

  const deleted = (await screen.findByRole("heading", { name: "Si cancella" })).parentElement!;
  expect(deleted).toHaveTextContent(/macchina Podman di JHT in WSL, con il suo disco/);
  expect(deleted).toHaveTextContent(/segreti del broker/);
  const kept = screen.getByRole("heading", { name: "Resta" }).parentElement!;
  expect(kept).toHaveTextContent("~/.jht");
  expect(kept).toHaveTextContent("Documenti › Job Hunter Team");
  expect(kept).toHaveTextContent(/Podman e Docker Compose: si disinstallano da Impostazioni/);

  const button = screen.getByRole("button", { name: "Rimuovi JHT da questo computer" });
  expect(button).toBeDisabled();
  await user.click(button);
  expect(uninstall).not.toHaveBeenCalled();

  await user.click(screen.getByRole("checkbox", { name: /confermo la rimozione/ }));
  await user.click(button);
  expect(uninstall).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("JHT è stato rimosso da questo computer.")).toBeInTheDocument();

  const removed = vi.fn();
  window.addEventListener(LOCAL_RUNTIME_REMOVED_EVENT, removed);
  await user.click(screen.getByRole("button", { name: "Torna al primo avvio" }));
  expect(removed).toHaveBeenCalledTimes(1);
  window.removeEventListener(LOCAL_RUNTIME_REMOVED_EVENT, removed);
});

it("shows each phase while it runs, and says what is left when the removal is incomplete", async () => {
  const user = userEvent.setup();
  let finish!: (value: { complete: boolean; left: Array<"machine" | "runtime" | "commands"> }) => void;
  const uninstall = vi.fn((onPhase: (text: string) => void) => {
    onPhase("Rimuovo la macchina Podman di JHT");
    return new Promise<{ complete: boolean; left: Array<"machine" | "runtime" | "commands"> }>((done) => { finish = done; });
  });
  render(<ComputerScreen available={vi.fn().mockResolvedValue(true)} uninstall={uninstall} />);
  await user.click(await screen.findByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Rimuovi JHT da questo computer" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Rimuovo la macchina Podman di JHT");
  expect(screen.getByRole("button", { name: "Rimozione in corso…" })).toBeDisabled();

  finish({ complete: false, left: ["machine", "commands"] });
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("La rimozione non è completa.");
  expect(alert).toHaveTextContent("È rimasto: la macchina Podman di JHT, i comandi di JHT.");
  expect(screen.getByRole("button", { name: "Riprova" })).toBeEnabled();
});

it("tells a failure with the catalog, in the page's language", async () => {
  const user = userEvent.setup();
  render(<ComputerScreen locale="en" available={vi.fn().mockResolvedValue(true)} uninstall={vi.fn().mockRejectedValue({ code: "timeout" })} />);
  await user.click(await screen.findByRole("checkbox", { name: /I confirm the removal/ }));
  await user.click(screen.getByRole("button", { name: "Remove JHT from this computer" }));
  const described = describeError("timeout", { locale: "en" });
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(described.text);
  expect(within(alert).queryByText(/Riprova/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

it.each(locales)("%s: lists among what is deleted the scheduled task the removal unregisters, by its name in the script", (locale) => {
  const wrapper = readFileSync("../scripts/jht-wrapper.ps1", "utf8");
  const task = /function Remove-JhtStartupTask \{\s*param\(\[string\]\$TaskName = '([^']+)'\)/.exec(wrapper)?.[1];
  expect(task, "Remove-JhtStartupTask and its task name in jht-wrapper.ps1").toBe("Job Hunter Team - Start runtime");
  // The removal calls it: the function is not just defined.
  expect(wrapper.split("Remove-JhtStartupTask").length - 1).toBeGreaterThan(1);
  expect(COMPUTER_TEXT[locale].removes.filter((item) => item.includes(task!))).toHaveLength(1);
});

