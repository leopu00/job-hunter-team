import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetLocalDeck } from "../../lib/local-swipe";
import { localJudgementApi } from "../../lib/local-judgement-api";
import { setLocalTeamData } from "../../lib/local-team-data";
import { installApiBridge, notInDesktop, shellApi } from "../../shell/api-bridge";
import { fakeSupabase } from "../../test-support/fake-supabase";
import { SwipePage } from ".";

// The Swipe of a local profile (no cloud account): the deck comes from the team on this computer, a verdict goes
// to the native command with the token of that deck, and the cloud is asked for nothing. Synthetic data only.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);

const TOKEN = "deck-token-one";
const row = (id: number, title: string) => ({
  id, status: "scored", title, company: "Azienda Esempio", location: "Città Esempio", remote_type: "hybrid",
  salary_declared_min: 40000, salary_declared_max: 50000, salary_declared_currency: "EUR",
  salary_estimated_min: null, salary_estimated_max: null, salary_estimated_currency: null,
  url: null, source: "example", found_at: "2026-09-01T10:00:00Z", role_family: "engineering", loc_country: "IT", loc_city: "Città Esempio", score: 82,
});

let restoreBridge: () => void;
let judged: unknown[];
let network: ReturnType<typeof vi.fn>;

beforeEach(() => {
  judged = [];
  localStorage.setItem("jht-lang", "it");
  native.isTauri.mockReturnValue(true);
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (command: string, args?: { request?: unknown }) => {
    if (command === "local_swipe_deck_read") {
      return { ok: true, token: TOKEN, pending: [row(101, "Sviluppatrice di prova")], reviewed: [{ row: row(102, "Posizione già vista"), action: "like", fbScore: 5 }] };
    }
    if (command === "local_team_position_judge") {
      judged.push(args?.request);
      return { ok: true, op: "feedback", value: "star" };
    }
    throw new Error(`unexpected native command ${command}`);
  });
  network = vi.fn(async () => new Response("", { status: 503 }));
  vi.stubGlobal("fetch", network);
  restoreBridge = installApiBridge(shellApi(localJudgementApi(notInDesktop)));
  setLocalTeamData("local:abc");
});
afterEach(() => {
  cleanup();
  restoreBridge();
  forgetLocalDeck();
  setLocalTeamData(null);
  localStorage.removeItem("jht-lang");
  vi.unstubAllGlobals();
});

describe("SwipePage of a local profile", () => {
  it("shows the deck of the team on this computer, with no cloud notice, and asks the cloud for nothing", async () => {
    const { client, queries } = fakeSupabase(() => ({ data: null, error: { message: "cloud must not be asked" } }));
    render(<SwipePage client={client} />);
    expect(await screen.findByText("Sviluppatrice di prova")).toBeInTheDocument();
    expect(queries).toEqual([]);
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual(["local_swipe_deck_read"]);
    expect(screen.queryByTestId("cloud-data-notice")).toBeNull();
  });

  it("sends the person's verdict to the native command with the id of the position and the token of the deck, and the card is judged", async () => {
    const { client } = fakeSupabase(() => ({ data: null, error: null }));
    render(<SwipePage client={client} />);
    await screen.findByText("Sviluppatrice di prova");
    const page = screen.getByTestId("desktop-swipe-page");
    const star = page.querySelector('[data-swipe-verdict="top"] button') as HTMLButtonElement;
    await userEvent.setup().click(star);
    await waitFor(() => expect(judged).toHaveLength(1));
    expect(judged[0]).toMatchObject({ op: "feedback", id: "101", token: TOKEN });
    expect(Object.keys(judged[0] as object).sort()).toEqual(expect.arrayContaining(["op", "id", "token", "value"]));
    // no call left the app for the verdict: it went to the native command, not to the network
    expect(network.mock.calls.filter(([url]) => String(url).includes("/api/"))).toEqual([]);
  });

  it("says the deck cannot be read, with the stopped team's reason left to the bar, when the native read refuses", async () => {
    native.invoke.mockResolvedValue({ ok: false, error: "local_team_not_running" });
    const { client } = fakeSupabase(() => ({ data: null, error: null }));
    render(<SwipePage client={client} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Non riesco a leggere");
  });
});
