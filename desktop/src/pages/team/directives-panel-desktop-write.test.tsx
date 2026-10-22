import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopWriteProvider } from "@/lib/desktop-write";
import { ReadOnlyActionsProvider } from "@/lib/read-only-actions";
import DirectivesPanel from "@/app/(protected)/team/DirectivesPanel";

// The standing orders to the captain are written from the desktop and, through the single door (phase 4,
// migration 101), from the website too. Read only in an informative embed and in the desktop's read-only
// view of an existing team. Creating asks for the confirmation the database answers.
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
  it("on the website shows the orders and can write them, through the door", async () => {
    render(<DirectivesPanel />);
    expect(await screen.findByText("synthetic standing order")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aggiungi" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Modifica" })).toBeInTheDocument();
  });

  it("the desktop's read-only view of an existing team cannot write", async () => {
    render(
      <ReadOnlyActionsProvider value={{ readOnly: true, reason: "synthetic" }}>
        <DirectivesPanel />
      </ReadOnlyActionsProvider>,
    );
    expect(await screen.findByText("synthetic standing order")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Modifica" })).toBeNull();
  });

  it("a new order waits for the confirmation, which sends only its id, never the text again", async () => {
    const CONFIRM = "0b9c2a52-3f7e-4d0e-9a51-6f2b8c1d4e77";
    const sent: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (!init || !init.method || init.method === "GET") {
          return new Response(JSON.stringify({ directives: [DIRECTIVE] }), { status: 200 });
        }
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        sent.push(body);
        if (!body.confirm_id) {
          return new Response(
            JSON.stringify({
              ok: true,
              state: "awaiting_confirm",
              confirm_id: CONFIRM,
              summary: "order: synthetic new order",
              expires_at: "2026-10-22T12:02:00Z",
              request_id: body.request_id,
              action: "created",
            }),
            { status: 202 },
          );
        }
        return new Response(
          JSON.stringify({
            ok: true,
            id: "8",
            source: "cloud",
            request_id: body.request_id,
            action: "created",
            captain_event: { ok: true, status: "queued" },
          }),
          { status: 200 },
        );
      }),
    );
    render(<DirectivesPanel />);
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "synthetic new order" } });
    fireEvent.click(screen.getByRole("button", { name: "Aggiungi" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("order: synthetic new order")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Conferma" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ body: "synthetic new order", kind: "order" });
    expect(sent[1]).toEqual({ confirm_id: CONFIRM, request_id: sent[0].request_id });
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
  });

  it("a read-only embed stays read-only even in the desktop", async () => {
    render(
      <DesktopWriteProvider value={{ canChange: true }}>
        <DirectivesPanel readOnly />
      </DesktopWriteProvider>,
    );
    await waitFor(() => expect(screen.getByText("synthetic standing order")).toBeInTheDocument());
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
