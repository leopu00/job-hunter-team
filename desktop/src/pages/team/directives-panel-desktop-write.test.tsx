import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopWriteProvider } from "@/lib/desktop-write";
import DirectivesPanel from "@/app/(protected)/team/DirectivesPanel";

// JHT-T46: the standing orders to the captain are written from the desktop. The website shows the
// board and says where to write; the desktop (outside the read-only view of an existing team) writes.
// Synthetic data only.
vi.mock("../../lib/supabase", () => ({ supabase: {}, supabaseConfigured: true, signOut: vi.fn() }));

const DIRECTIVE = {
  id: 7,
  body: "synthetic standing order",
  kind: "order",
  status: "active",
  sort_order: 1,
  created_by: "user",
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
};

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=it; path=/";
  localStorage.setItem("jht-lang", "it");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ directives: [DIRECTIVE] }), { status: 200 })));
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("the board of standing orders", () => {
  it("on the website shows the orders and no way to write, and says where", async () => {
    render(<DirectivesPanel />);
    expect(await screen.findByText("synthetic standing order")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Aggiungi" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Modifica" })).toBeNull();
    expect(screen.getByText(/si scrivono dall'app desktop/)).toBeInTheDocument();
  });

  it("in the desktop can write", async () => {
    render(
      <DesktopWriteProvider value={{ canChange: true }}>
        <DirectivesPanel />
      </DesktopWriteProvider>,
    );
    await waitFor(() => expect(screen.getByText("synthetic standing order")).toBeInTheDocument());
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aggiungi" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Modifica" })).toBeInTheDocument();
    expect(screen.queryByText(/si scrivono dall'app desktop/)).toBeNull();
  });

  it("a read-only embed stays read-only even in the desktop, without the website's note", async () => {
    render(
      <DesktopWriteProvider value={{ canChange: true }}>
        <DirectivesPanel readOnly />
      </DesktopWriteProvider>,
    );
    await waitFor(() => expect(screen.getByText("synthetic standing order")).toBeInTheDocument());
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(/si scrivono dall'app desktop/)).toBeNull();
  });
});
