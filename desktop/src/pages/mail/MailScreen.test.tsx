import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { describeError } from "../../lib/error-catalog";
import { MAIL_SAVED_EVENT, type MailStatus } from "../../lib/mail";
import { MailScreen } from "./index";

const PENDING: MailStatus = { configured: true, address: "jobs@example.com", admission: "allowlist", rotationPending: true };

async function fillAndSave(user: ReturnType<typeof userEvent.setup>, password: string) {
  await user.click(screen.getByLabelText(/No: il team legge solo i mittenti ammessi/));
  await user.type(screen.getByLabelText(/Password per app/), password);
  await user.click(screen.getByRole("button", { name: "Salva la password" }));
}

it("shows the mailbox state and saves the new password through the save call only", async () => {
  const user = userEvent.setup();
  const save = vi.fn().mockResolvedValue(undefined);
  const saved = vi.fn();
  window.addEventListener(MAIL_SAVED_EVENT, saved);
  render(<MailScreen loadStatus={vi.fn().mockResolvedValue(PENDING)} save={save} />);

  const state = await screen.findByLabelText("Stato della casella");
  expect(within(state).getByText("configurata")).toBeInTheDocument();
  expect(within(state).getByText("jobs@example.com")).toBeInTheDocument();
  expect(within(state).getByText(/da sostituire/)).toBeInTheDocument();
  expect(screen.getByLabelText(/Indirizzo della casella/)).toHaveValue("jobs@example.com");

  await fillAndSave(user, "abcd efgh ijkl mnop");
  expect(save).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledWith({
    address: "jobs@example.com",
    dedicated: false,
    imapHost: undefined,
    smtpHost: undefined,
    password: "abcd efgh ijkl mnop",
  });
  expect(await screen.findByRole("status")).toHaveTextContent("Password salvata");
  expect(screen.getByLabelText(/Password per app/)).toHaveValue("");
  expect(saved).toHaveBeenCalledOnce();
  window.removeEventListener(MAIL_SAVED_EVENT, saved);
});

it("asks the dedicated question with no default: nothing is saved before an answer", async () => {
  const user = userEvent.setup();
  const save = vi.fn();
  render(<MailScreen loadStatus={vi.fn().mockResolvedValue(PENDING)} save={save} />);
  await screen.findByLabelText("Stato della casella");
  for (const radio of screen.getAllByRole("radio")) expect(radio).not.toBeChecked();
  await user.type(screen.getByLabelText(/Password per app/), "secret");
  expect(screen.getByRole("button", { name: "Salva la password" })).toBeDisabled();
  expect(save).not.toHaveBeenCalled();
});

it("an exposed password is refused with a clear message, and the field is emptied", async () => {
  const user = userEvent.setup();
  const save = vi.fn().mockRejectedValue({ code: "password_not_rotated" });
  render(<MailScreen loadStatus={vi.fn().mockResolvedValue(PENDING)} save={save} />);
  await screen.findByLabelText("Stato della casella");
  await fillAndSave(user, "the old one");

  const exposed = describeError("password_not_rotated");
  expect(exposed.known).toBe(true);
  expect(await screen.findByRole("alert")).toHaveTextContent(`${exposed.text} ${exposed.action}`);
  expect(screen.queryByText(/password_not_rotated/)).not.toBeInTheDocument();
  expect(screen.getByLabelText(/Password per app/)).toHaveValue("");
});

it("a mail service that cannot be reached is said with the catalog, never raw", async () => {
  render(<MailScreen loadStatus={vi.fn().mockRejectedValue(new Error("raw ssh text"))} save={vi.fn()} />);
  const unavailable = describeError("mail_unavailable");
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(unavailable.text));
  expect(screen.queryByText(/raw ssh text/)).not.toBeInTheDocument();
});
