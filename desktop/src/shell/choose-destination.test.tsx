import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChooseDestination } from "../lib/choose-destination";
import { installApiBridge, notInDesktop, shellApi } from "./api-bridge";
import { navigate } from "./router";
import Shell from "./Shell";

vi.mock("../lib/supabase", () => ({ supabase: { from: vi.fn() }, supabaseConfigured: true, signOut: vi.fn() }));
// The chat has its own tests: here only that the shell hands its pages the way back to choosing the destination.
vi.mock("../pages/messages", () => ({
  default: function Chat() {
    const choose = useChooseDestination();
    return choose ? <button type="button" onClick={choose}>Scegli</button> : <p>nessuna scelta</p>;
  },
}));

let restore: () => void;
beforeEach(() => {
  restore = installApiBridge(shellApi(notInDesktop));
});
afterEach(() => restore());

describe("the way back to choosing where the team runs", () => {
  it("is handed to the pages of the full shell when the dashboard can open the setup there", async () => {
    const choose = vi.fn();
    navigate("/messages", { replace: true });
    render(<Shell onChooseDestination={choose} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Scegli" }));
    expect(choose).toHaveBeenCalledOnce();
  });

  it("is not there when the dashboard cannot", async () => {
    navigate("/messages", { replace: true });
    render(<Shell />);
    expect(await screen.findByText("nessuna scelta")).toBeInTheDocument();
  });
});
