import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebActionLogClient } from "@/lib/web-action-log";
import ActionLogPanel from "@/app/components/ActionLogPanel";
import ActionLogSection, { appLogClient } from "./ActionLogSection";

const app = vi.hoisted(() => ({ configured: true, session: null as { user: { id: string } } | null, client: { from: () => ({}) } }));
vi.mock("../../lib/supabase", () => ({
  get supabaseConfigured() {
    return app.configured;
  },
  supabase: {
    get from() {
      return app.client.from;
    },
    auth: { getSession: async () => ({ data: { session: app.session }, error: null }) },
  },
}));

// «Registro delle azioni» in the agents panel, against a stand-in client of the
// log's table. Synthetic rows only.
afterEach(cleanup);

/** U+202E, the right-to-left override: built here, so the source holds no hidden character. */
const RLO = String.fromCharCode(0x202e);

type Answer = { data?: unknown; error?: { code?: string; message?: string } | null };

function row(over: Record<string, unknown> = {}) {
  return {
    id: "r1",
    action: "team_restart",
    target: null,
    summary: "Restart of the team",
    level: "L2",
    status: "done",
    created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    confirmed_at: null,
    result: null,
    ...over,
  };
}

/** A client whose reads answer from `answers`, in turn (the last one repeats); `reads` counts them. */
function client(...answers: (Answer | Promise<Answer>)[]) {
  const state = { reads: 0 };
  const stand: WebActionLogClient = {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: async () => {
            const answer = answers[Math.min(state.reads, answers.length - 1)];
            state.reads += 1;
            const done = await answer;
            return { data: done.data ?? null, error: done.error ?? null };
          },
        }),
      }),
    }),
  };
  return { stand, state };
}

function open() {
  const details = screen.getByTestId("panel-action-log") as HTMLDetailsElement;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  return details;
}

describe("the action log in the agents panel", () => {
  it("is closed, with its title, and reads nothing until it is opened", () => {
    const loadClient = vi.fn(async () => null);
    render(<ActionLogSection locale="it" loadClient={loadClient} />);
    expect(screen.getByText("Registro delle azioni")).toBeInTheDocument();
    expect((screen.getByTestId("panel-action-log") as HTMLDetailsElement).open).toBe(false);
    expect(loadClient).not.toHaveBeenCalled();
  });

  it("opens onto the person's rows, newest first, each with its action, its state in words and its level", async () => {
    const { stand } = client({
      data: [
        row({ id: "old", action: "apply_request", level: "L3", status: "queued", created_at: new Date(Date.now() - 3 * 3600_000).toISOString() }),
        row({ id: "new", action: "team_stop", level: "L2", status: "error", result: "box unreachable" }),
      ],
    });
    render(<ActionLogSection locale="it" loadClient={async () => stand} />);
    open();
    const list = await screen.findByTestId("action-log-list");
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.getAttribute("data-testid"))).toEqual(["action-log-row-new", "action-log-row-old"]);
    expect(items[0]).toHaveTextContent("Arresto della squadra");
    expect(items[0]).toHaveTextContent("Non riuscita");
    expect(items[0]).toHaveTextContent("Esito: box unreachable");
    expect(items[0]).toHaveTextContent("Comando alla squadra");
    expect(items[1]).toHaveTextContent("Candidatura autorizzata");
    expect(items[1]).toHaveTextContent("In coda");
    expect(items[1]).toHaveTextContent("Verso l’esterno");
  });

  it("reads again on Aggiorna, and a second opening does not ask for the client again", async () => {
    const loadClient = vi.fn();
    const { stand, state } = client({ data: [row()] });
    loadClient.mockResolvedValue(stand);
    render(<ActionLogSection locale="it" loadClient={loadClient} />);
    const details = open();
    await screen.findByTestId("action-log-list");
    expect(state.reads).toBe(1);
    details.open = false;
    fireEvent(details, new Event("toggle"));
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(loadClient).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Aggiorna" }));
    await waitFor(() => expect(state.reads).toBe(2));
  });

  it("does not let a slow read, answered late, overwrite the rows of a newer client", async () => {
    let release!: (answer: Answer) => void;
    const slow = new Promise<Answer>((resolve) => (release = resolve));
    const first = client(slow).stand;
    const second = client({ data: [row({ id: "fresh", action: "team_start" })] }).stand;
    const view = render(<ActionLogPanel client={first} locale="it" />);
    expect(screen.getByText("Leggo il registro…")).toBeInTheDocument();
    view.rerender(<ActionLogPanel client={second} locale="it" />);
    await screen.findByTestId("action-log-row-fresh");
    release({ data: [row({ id: "stale", action: "team_stop" })] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId("action-log-row-stale")).toBeNull();
    expect(screen.getByTestId("action-log-row-fresh")).toBeInTheDocument();
  });

  it("shows markup, hidden characters and a code it does not know as plain, readable text", async () => {
    const { stand } = client({
      data: [row({ summary: `<img src=x onerror=alert(1)>${RLO}evil`, action: "make_coffee", status: "teleported" })],
    });
    const { container } = render(<ActionLogSection locale="it" loadClient={async () => stand} />);
    open();
    const item = await screen.findByTestId("action-log-row-r1");
    expect(container.querySelector("img")).toBeNull();
    expect(item).toHaveTextContent("<img src=x onerror=alert(1)> evil");
    expect(item.textContent).not.toContain(RLO);
    expect(item).toHaveTextContent("Altra azione (make_coffee)");
    expect(item).toHaveTextContent("Stato non noto");
    expect(item).toHaveAttribute("data-status", "unknown");
  });

  it("says there is nothing yet, not an empty box", async () => {
    const { stand } = client({ data: [] });
    render(<ActionLogSection locale="it" loadClient={async () => stand} />);
    open();
    expect(await screen.findByTestId("action-log-empty")).toHaveTextContent("Dal sito non è stata chiesta nessuna azione, per ora.");
  });

  it.each([
    ["42P01", "not_active", /non è ancora attivo su questo account/],
    ["42501", "signed_out", /Accedi con il tuo account/],
    ["57014", "unavailable", /Non riesco a leggere il registro/],
  ])("says why it cannot show rows: %s is %s", async (code, reason, sentence) => {
    const { stand } = client({ error: { code, message: "internal detail that must not show" } });
    render(<ActionLogSection locale="it" loadClient={async () => stand} />);
    open();
    const note = await screen.findByTestId("action-log-reason");
    expect(note).toHaveAttribute("data-reason", reason);
    expect(note).toHaveTextContent(sentence);
    expect(document.body.textContent).not.toContain("internal detail");
  });

  it("tells a person with no account to sign in, instead of an empty list that reads as «nothing asked»", async () => {
    render(<ActionLogSection locale="it" loadClient={async () => null} />);
    open();
    expect(await screen.findByTestId("action-log-no-account")).toHaveTextContent("Accedi con il tuo account per vedere il registro.");
    expect(screen.queryByTestId("action-log-list")).toBeNull();
  });

  it("tells the same when the session cannot be read", async () => {
    render(<ActionLogSection locale="it" loadClient={() => Promise.reject(new Error("no storage"))} />);
    open();
    expect(await screen.findByTestId("action-log-no-account")).toBeInTheDocument();
  });

  it("speaks the person's language", async () => {
    const { stand } = client({ data: [row({ action: "directive_create", status: "awaiting_confirm", level: "L2" })] });
    render(<ActionLogSection locale="de" loadClient={async () => stand} />);
    expect(screen.getByText("Aktionsprotokoll")).toBeInTheDocument();
    open();
    const item = await screen.findByTestId("action-log-row-r1");
    expect(item).toHaveTextContent("Neue Dauerweisung");
    expect(item).toHaveTextContent("Wartet auf Bestätigung");
  });
});

describe("the log is read-only on every screen", () => {
  const files = [
    "../web/lib/web-action-log.ts",
    "../web/app/components/ActionLogList.tsx",
    "../web/app/components/ActionLogPanel.tsx",
    "../web/app/(protected)/action-log/page.tsx",
    "src/pages/agents/ActionLogSection.tsx",
  ];

  it.each(files)("%s has no way to write: no insert, update, upsert, delete, rpc, fetch or form", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
    expect(source).not.toMatch(/\bfetch\s*\(|<form\b|method:\s*["'](POST|PUT|PATCH|DELETE)/);
  });

  it("is mounted in the agents panel, and the web's menu offers it only on the site", () => {
    expect(readFileSync("src/pages/agents/AgentsPanel.tsx", "utf8")).toContain("<ActionLogSection />");
    const menu = readFileSync("../web/app/components/UserMenu.tsx", "utf8");
    expect(menu).toMatch(/isCloud === true && \(\s*<Link\s+href="\/action-log"/);
  });
});

describe("what the section reads the log with", () => {
  it("is the app's session when there is one", async () => {
    app.configured = true;
    app.session = { user: { id: "u1" } };
    const client = await appLogClient();
    expect(client).not.toBeNull();
    expect(client!.from).toBe(app.client.from);
  });

  it("is nothing when nobody is signed in with an account", async () => {
    app.configured = true;
    app.session = null;
    expect(await appLogClient()).toBeNull();
  });

  it("is nothing when the app has no account service configured", async () => {
    app.configured = false;
    app.session = { user: { id: "u1" } };
    expect(await appLogClient()).toBeNull();
  });
});
