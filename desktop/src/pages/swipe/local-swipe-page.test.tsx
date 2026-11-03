import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetLocalDeck } from "../../lib/local-swipe";
import { localJudgementApi } from "../../lib/local-judgement-api";
import { localSummaryApi } from "../../lib/local-summary-api";
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
/** What the team answers to the read of a position's detail: the card's description comes from it. */
let detailAnswer: (request: unknown) => unknown | Promise<unknown>;
const withSummary = (summary: string | null, text: string | null = null) => () => ({ ok: true, data: { position: { id: "101", jd_summary: summary, jd_text: text } } });
let network: ReturnType<typeof vi.fn>;

beforeEach(() => {
  judged = [];
  detailAnswer = withSummary("Costruisce strumenti per le cliniche.");
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
    if (command === "existing_team_positions_read") return detailAnswer(args?.request);
    throw new Error(`unexpected native command ${command}`);
  });
  network = vi.fn(async () => new Response("", { status: 503 }));
  vi.stubGlobal("fetch", network);
  restoreBridge = installApiBridge(shellApi(localSummaryApi(localJudgementApi(notInDesktop))));
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
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual(["local_swipe_deck_read", "existing_team_positions_read"]);
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

  it("reads the card's description from the team on this computer, not from the cloud", async () => {
    const { client, queries } = fakeSupabase(() => ({ data: null, error: { message: "cloud must not be asked" } }));
    render(<SwipePage client={client} />);
    expect(await screen.findByText("Costruisce strumenti per le cliniche.")).toBeInTheDocument();
    expect(queries).toEqual([]);
    expect(native.invoke).toHaveBeenCalledWith("existing_team_positions_read", { request: { op: "detail", id: "101" } });
    expect(network.mock.calls.filter(([url]) => String(url).includes("/summary"))).toEqual([]);
  });

  it("says so when the position has no description", async () => {
    detailAnswer = withSummary(null, null);
    const { client } = fakeSupabase(() => ({ data: null, error: null }));
    render(<SwipePage client={client} />);
    await screen.findByText("Sviluppatrice di prova");
    expect(await screen.findByText("Nessuna descrizione disponibile per questa posizione.")).toBeInTheDocument();
    expect(document.querySelector("[data-swipe-summary-failed]")).toBeNull();
  });

  it("leaves the loading shapes after a few seconds with a clear message and a retry, whether the team does not answer or refuses", async () => {
    detailAnswer = () => new Promise(() => {});
    const { client } = fakeSupabase(() => ({ data: null, error: null }));
    render(<SwipePage client={client} />);
    await screen.findByText("Sviluppatrice di prova");
    expect(document.querySelector("[data-swipe-summary-failed]")).toBeNull();
    const failed = await screen.findByText("Non riesco a leggere la descrizione adesso.", {}, { timeout: 9000 });
    expect(failed).toBeInTheDocument();
    // «Riprova» asks again, and the description comes in when the team answers
    detailAnswer = withSummary("Ora si legge.");
    await userEvent.setup().click(screen.getByRole("button", { name: "Riprova" }));
    expect(await screen.findByText("Ora si legge.")).toBeInTheDocument();
    expect(document.querySelector("[data-swipe-summary-failed]")).toBeNull();
  }, 20_000);

  it("shows the message at once when the team refuses the read", async () => {
    detailAnswer = () => ({ ok: false, error: "local_team_not_running" });
    const { client } = fakeSupabase(() => ({ data: null, error: null }));
    render(<SwipePage client={client} />);
    await screen.findByText("Sviluppatrice di prova");
    expect(await screen.findByText("Non riesco a leggere la descrizione adesso.")).toBeInTheDocument();
  });
});
