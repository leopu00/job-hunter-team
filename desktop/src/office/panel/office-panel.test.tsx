import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { OfficeLayout } from "../contract";
import { fakeSupabase } from "../../test-support/fake-supabase";
import OfficePanel from "./OfficePanel";

const layout = { departments: [{ id: "scout", name: "Research", tagline: "Finds relevant opportunities for you." }] } as unknown as OfficeLayout;
const position = { id: "p1", legacy_id: 1, title: "Dev", company: "Acme", status: "new", location: "Roma", remote_type: null, found_at: "2026-09-27T10:00:00Z", found_by: "scout-1", jd_summary: "JD" };

function open(onNavigate = vi.fn()) {
  const { client } = fakeSupabase((q) => ({ data: q.table === "positions" ? [position] : [], error: null }));
  render(
    <OfficePanel
      target={{ kind: "pile", dept: "scout" }}
      layout={layout}
      snapshot={null}
      statuses={null}
      client={client}
      onClose={vi.fn()}
      onOpen={vi.fn()}
      onNavigate={onNavigate}
    />,
  );
  return screen.getByRole("complementary", { name: "Dettagli dell'ufficio" });
}

describe("the office's panel with a keyboard (D08)", () => {
  it("takes the focus when it opens", () => {
    expect(open()).toHaveFocus();
  });

  it("every control shows where the keyboard focus is", async () => {
    const panel = open();
    await within(panel).findByText("Dev · Acme");
    await userEvent.setup().click(within(panel).getByRole("button", { name: /Dev · Acme/ }));
    const buttons = within(panel).getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    for (const b of buttons) expect(b.className, b.textContent ?? "").toMatch(/focus-visible:outline-2/);
  });

  it("a position's detail opens in place and its link is the only way out", async () => {
    const onNavigate = vi.fn();
    const panel = open(onNavigate);
    const user = userEvent.setup();
    await user.click(await within(panel).findByRole("button", { name: /Dev · Acme/ }));
    expect(within(panel).getByText("Roma")).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "Apri la posizione" }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("/positions/p1"));
  });
});
