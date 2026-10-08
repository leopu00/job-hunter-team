import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { describeError } from "../../lib/error-catalog";
import { LinkedinLoginCard } from "./LinkedinLoginCard";

it("shows the login state and opens the broker's login view", async () => {
  const user = userEvent.setup();
  const open = vi.fn().mockResolvedValue(undefined);
  const loadStatus = vi.fn().mockResolvedValue({ view: "idle", linkedin: "login_required", lastReason: null });
  render(<LinkedinLoginCard loadStatus={loadStatus} open={open} />);

  expect(await screen.findByText("Stato: accesso da fare")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Accedi a LinkedIn" }));
  expect(open).toHaveBeenCalledOnce();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("tells a busy or blocked view with the catalog, and survives a status it cannot read", async () => {
  const user = userEvent.setup();
  const open = vi.fn()
    .mockRejectedValueOnce({ code: "view_busy" })
    .mockRejectedValueOnce({ code: "chromium_sandbox_unavailable" });
  render(<LinkedinLoginCard loadStatus={vi.fn().mockRejectedValue({ code: "view_unavailable" })} open={open} />);

  expect(await screen.findByText("Stato: non disponibile")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Accedi a LinkedIn" }));
  const busy = describeError("view_busy");
  expect(await screen.findByRole("alert")).toHaveTextContent(`${busy.text} ${busy.action}`);
  await user.click(screen.getByRole("button", { name: "Accedi a LinkedIn" }));
  const sandbox = describeError("chromium_sandbox_unavailable");
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(sandbox.text));
});

it("reads the state again when the app comes back from the login window", async () => {
  const loadStatus = vi.fn()
    .mockResolvedValueOnce({ view: "connected", linkedin: "login_required", lastReason: null })
    .mockResolvedValueOnce({ view: "idle", linkedin: "logged_in", lastReason: "logged_in" });
  render(<LinkedinLoginCard loadStatus={loadStatus} open={vi.fn()} />);
  expect(await screen.findByText("Stato: accesso da fare")).toBeInTheDocument();
  window.dispatchEvent(new Event("focus"));
  expect(await screen.findByText("Stato: accesso fatto")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Accedi di nuovo a LinkedIn" })).toBeInTheDocument();
});
