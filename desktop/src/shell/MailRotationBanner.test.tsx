import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { describeError } from "../lib/error-catalog";
import { MAIL_SAVED_EVENT, type MailStatus } from "../lib/mail";
import { MailRotationBanner } from "./MailRotationBanner";

const status = (rotationPending: boolean): MailStatus => ({
  configured: true,
  address: "jobs@example.com",
  admission: "allowlist",
  rotationPending,
});

it("shows the warning while the rotation is pending and drops it once a new password is saved", async () => {
  const loadStatus = vi.fn().mockResolvedValueOnce(status(true)).mockResolvedValueOnce(status(false));
  render(<MailRotationBanner loadStatus={loadStatus} />);

  const banner = await screen.findByTestId("mail-rotation-banner");
  const copy = describeError("mail_rotation_pending");
  expect(copy.known).toBe(true);
  expect(banner).toHaveTextContent(copy.text);
  expect(banner).toHaveTextContent(copy.action);

  act(() => {
    window.dispatchEvent(new CustomEvent(MAIL_SAVED_EVENT));
  });
  await waitFor(() => expect(screen.queryByTestId("mail-rotation-banner")).not.toBeInTheDocument());
  expect(loadStatus).toHaveBeenCalledTimes(2);
});

it("leads to the Mail page", async () => {
  const user = userEvent.setup();
  window.location.hash = "#/dashboard";
  render(<MailRotationBanner loadStatus={vi.fn().mockResolvedValue(status(true))} />);
  await user.click(await screen.findByRole("button", { name: "Apri Posta" }));
  expect(window.location.hash).toBe("#/mail");
});

it("shows nothing without a rotation, or without data from the broker", async () => {
  const quiet = vi.fn().mockResolvedValue(status(false));
  const { unmount } = render(<MailRotationBanner loadStatus={quiet} />);
  await waitFor(() => expect(quiet).toHaveBeenCalled());
  expect(screen.queryByTestId("mail-rotation-banner")).not.toBeInTheDocument();
  unmount();

  const noBroker = vi.fn().mockRejectedValue({ code: "mail_unavailable" });
  render(<MailRotationBanner loadStatus={noBroker} />);
  await waitFor(() => expect(noBroker).toHaveBeenCalled());
  expect(screen.queryByTestId("mail-rotation-banner")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("warns in the language of the app", async () => {
  window.location.hash = "#/dashboard";
  render(<MailRotationBanner loadStatus={vi.fn().mockResolvedValue(status(true))} locale="fr" />);
  const banner = await screen.findByTestId("mail-rotation-banner");
  const copy = describeError("mail_rotation_pending", { locale: "fr" });
  expect(copy.text).not.toBe(describeError("mail_rotation_pending", { locale: "it" }).text);
  expect(banner).toHaveTextContent(copy.text);
  expect(screen.getByRole("button", { name: "Ouvrir le courrier" })).toBeInTheDocument();
});
