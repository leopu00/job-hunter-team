import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocalTeamData } from "../../lib/local-team-data";
import { forgetLocalPositionTokens } from "../../lib/local-swipe";
import { localJudgementApi } from "../../lib/local-judgement-api";
import { installApiBridge, notInDesktop, shellApi, type ApiFetch } from "../../shell/api-bridge";
import { navigate } from "../../shell/router";
import Shell from "../../shell/Shell";
import { createPermissiveSupabase } from "../../test-support/permissive-supabase";
import { syntheticStats } from "../../test-support/existing-team-stats-fixture";
import {
  syntheticDetail,
  syntheticFacets,
  syntheticPosition,
} from "../../test-support/existing-team-positions-fixture";
import { positionsApi } from "./positions-api";

// The page of one position of a profile with no cloud account: the team of this computer is read, its controls are
// on, and what the person asks goes to the native command with the token of the position's read. Synthetic data only.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
// The header of the link also asks the app one command of its own (the team's identity); only this one is the pages'.
const POSITIONS = "existing_team_positions_read";
const ACT = "local_team_position_act";
const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createPermissiveSupabase> | null }));

vi.mock("@tauri-apps/api/core", () => native);
vi.mock("../../lib/supabase", () => ({
  get supabase() {
    return fake.current!.client;
  },
  supabaseConfigured: true,
  signOut: vi.fn(),
}));
// The real map and office need WebGL, which jsdom has not; they are not reachable here.
vi.mock("../map", () => ({ default: () => <h1>Mappa</h1> }));
vi.mock("../office", () => ({ default: () => <h1>Ufficio</h1> }));


const TOKEN = "position-token-synthetic";
const DIGEST = "b".repeat(64);
const RICH = {
  ...syntheticDetail,
  position: {
    ...syntheticDetail.position,
    remote_type: "hybrid",
    notes: "Fine fit. NOTE_MISMATCH: [GEO] Hybrid in a far city that needs a long commute every week. NOTE_MISMATCH: [DOMAIN] Works in an unrelated field with no overlap.",
  },
  company: {
    ...syntheticDetail.company,
    about: "Synthetic Co A builds scheduling tools. It sells them to small clinics.",
    verdict: "CAUTIOUS" as const,
    glassdoor_rating: 3.2,
    red_flags: "Synthetic review warning",
    culture_notes: "Synthetic culture note",
  },
  userNote: { body: "synthetic private note" },
};
let detail: unknown = { ...syntheticDetail };
let calls: Array<{ command: string; request: Record<string, unknown> }> = [];

let restoreBridge: () => void;
beforeEach(() => {
  fake.current = createPermissiveSupabase();
  document.cookie = "NEXT_LOCALE=it; path=/";
  calls = [];
  detail = { ...syntheticDetail };
  native.isTauri.mockReturnValue(true);
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (command: string, args?: { request: Record<string, unknown> }) => {
    if (command === POSITIONS) {
      const request = args!.request as { op: string; id?: string };
      if (request.op === "detail") return { ok: true, data: request.id === "101" ? { ...(detail as object), token: TOKEN } : null };
      if (request.op === "facets") return { ok: true, data: { items: syntheticFacets } };
      if (request.op === "stats") return { ok: true, data: syntheticStats() };
      return { ok: true, data: { items: [syntheticPosition], total: 1 } };
    }
    if (command === ACT) {
      calls.push({ command, request: args!.request });
      if (args!.request.op === "apply_preview") return { ok: true, op: "apply-preview", summary: "Synthetic role A @ Synthetic Co A · jobs.example.com", confirm: DIGEST, destination: "web:jobs.example.com" };
      if (args!.request.op === "apply_request") return { ok: true, op: "apply-request", apply_requested: args!.request.on === true };
      return { ok: true };
    }
    return null;
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
  restoreBridge = installApiBridge(shellApi(localJudgementApi(positionsApi(notInDesktop))));
  setLocalTeamData("local:abc");
});
afterEach(() => {
  cleanup();
  restoreBridge();
  setLocalTeamData(null);
  forgetLocalPositionTokens();
  vi.unstubAllGlobals();
});

describe("the page of a position of the team on this computer", () => {
  it("keeps «Feedback e richieste» right under the judgements, once, with the controls on", async () => {
    const user = userEvent.setup();
    navigate("/positions/101", { replace: true });
    render(<Shell />);
    expect((await screen.findAllByText("Synthetic role A")).length).toBeGreaterThan(0);

    const sheet = screen.getByRole("button", { name: /feedback e richieste/i });
    expect(sheet).toBeEnabled();
    // after the judgements and the «applied myself» button in the document, and only one such trigger
    const applied = screen.getByRole("button", { name: /mi sono candidato/i });
    expect(applied.compareDocumentPosition(sheet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /feedback e richieste/i })).toHaveLength(1);
    // the judgements are not repeated in the panel
    await user.click(sheet);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryAllByRole("button", { pressed: false })).toHaveLength(0);
    // the ad's own page: one «Annuncio originale», at the end of the description
    expect(screen.getAllByTestId("original-listing")).toHaveLength(1);
  }, 20_000);

  it("sends a verdict to the native command with the token the position's read brought", async () => {
    const user = userEvent.setup();
    navigate("/positions/101", { replace: true });
    render(<Shell />);
    await screen.findAllByText("Synthetic role A");
    const verdicts = screen.getAllByRole("button").filter((button) => button.hasAttribute("aria-pressed") && button !== screen.getByRole("button", { name: /mi sono candidato/i }));
    expect(verdicts.length).toBe(4);
    for (const button of verdicts) expect(button).toBeEnabled();
    await user.click(verdicts[2]);
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].request).toMatchObject({ op: "feedback", id: "101", token: TOKEN });
    expect(fake.current!.calls).toEqual([]);
  }, 20_000);

  it("keeps the company's reviews and reputation under a closed entry, with the two sentences on top, and orders the right column Company, Location, Team analysis", async () => {
    detail = RICH;
    navigate("/positions/101", { replace: true });
    render(<Shell />);
    await screen.findAllByText("Synthetic role A");

    const about = await screen.findByTestId("company-about");
    expect(about).toHaveTextContent("builds scheduling tools");
    const reputation = screen.getByTestId("company-reputation") as HTMLDetailsElement;
    expect(reputation.open).toBe(false);
    // all of it is inside the closed entry, and nothing of it outside
    for (const text of ["CAUTIOUS", "Glassdoor: 3.2/5", "Synthetic review warning"]) {
      expect(reputation).toHaveTextContent(text);
    }
    expect(about.closest("details")).toBeNull();
    const labels = [...document.querySelectorAll(".section-label")].map((node) => node.textContent);
    const at = (name: RegExp) => labels.findIndex((label) => name.test(label ?? ""));
    expect(at(/^azienda$/i)).toBeGreaterThan(-1);
    expect(at(/^azienda$/i)).toBeLessThan(at(/località/i));
    expect(at(/località/i)).toBeLessThan(at(/analisi/i));
  }, 20_000);

  it("shows each mismatch as a block: the badge in a header row, the text under it on the full width", async () => {
    detail = RICH;
    navigate("/positions/101", { replace: true });
    render(<Shell />);
    await screen.findAllByText("Synthetic role A");
    const blocks = await screen.findAllByTestId("mismatch");
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      const head = within(block).getByTestId("mismatch-head");
      const text = block.querySelector("p") as HTMLElement;
      expect(head.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(head.contains(text)).toBe(false);
      expect(text.className).toContain("w-full");
    }
    expect(within(blocks[0]).getByTestId("mismatch-head")).toHaveTextContent("GEO");
    expect(within(blocks[1]).getByTestId("mismatch-head")).toHaveTextContent("DOMAIN");
  }, 20_000);

  it("keeps the private notes closed, with a sign when there are some, opens to read them all and closes again; the empty box has no sideways scroll", async () => {
    const user = userEvent.setup();
    detail = RICH;
    navigate("/positions/101", { replace: true });
    render(<Shell />);
    await screen.findAllByText("Synthetic role A");
    const toggle = await screen.findByRole("button", { name: /note private/i, expanded: false });
    expect(screen.getByTestId("user-note-sign")).toBeInTheDocument();
    const box = document.getElementById(toggle.getAttribute("aria-controls")!) as HTMLElement;
    expect(box.hidden).toBe(true);
    await user.click(toggle);
    expect(box.hidden).toBe(false);
    expect(within(box).getByRole("textbox")).toHaveValue("synthetic private note");
    await user.click(screen.getByRole("button", { name: /note private/i, expanded: true }));
    expect(box.hidden).toBe(true);
    expect(within(box).getByRole("textbox", { hidden: true }).className).toContain("overflow-x-hidden");
  }, 20_000);

  it("gives the four judgements four different colours of the chosen theme", async () => {
    navigate("/positions/101", { replace: true });
    render(<Shell />);
    await screen.findAllByText("Synthetic role A");
    const colours = [...document.querySelectorAll<HTMLElement>("[data-verdict]")].map((node) => node.style.color);
    expect(colours).toHaveLength(4);
    expect(new Set(colours).size).toBe(4);
    for (const colour of colours) expect(colour).toMatch(/^var\(--color-(red|orange|blue|purple|yellow|green)\)$/);
  }, 20_000);

  it("authorises an application in two steps: the preview shows the summary and where it goes, nothing is authorised until the click, and the click sends the digest and the destination back", async () => {
    const user = userEvent.setup();
    detail = { ...syntheticDetail, position: { ...syntheticDetail.position, status: "ready" } };
    navigate("/positions/101", { replace: true });
    render(<Shell />);
    await screen.findAllByText("Synthetic role A");

    await user.click(await screen.findByRole("button", { name: /^candidati$/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Synthetic role A @ Synthetic Co A · jobs\.example\.com/)).toBeInTheDocument();
    expect(within(dialog).getByTestId("apply-destination")).toHaveTextContent("web:jobs.example.com");
    // the first step only reads: the host was asked for a preview and for nothing else
    expect(calls.map((call) => call.request.op)).toEqual(["apply_preview"]);
    expect(calls[0].request).toEqual({ op: "apply_preview", id: "101", token: TOKEN });

    // dismissing writes nothing
    await user.click(within(dialog).getByRole("button", { name: /no|annulla/i }));
    expect(calls.map((call) => call.request.op)).toEqual(["apply_preview"]);

    await user.click(screen.getByRole("button", { name: /^candidati$/i }));
    await user.click(await within(await screen.findByRole("alertdialog")).findByRole("button", { name: /sì, invia/i }));
    await waitFor(() => expect(calls.at(-1)?.request.op).toBe("apply_request"));
    expect(calls.at(-1)?.request).toEqual({ op: "apply_request", id: "101", on: true, confirmed: true, confirm: DIGEST, destination: "web:jobs.example.com", token: TOKEN });
    expect(fake.current!.calls).toEqual([]);
  }, 30_000);

  it("shows a refusal of the host as a sentence and never leaves the authorisation half done", async () => {
    const user = userEvent.setup();
    detail = { ...syntheticDetail, position: { ...syntheticDetail.position, status: "ready" } };
    native.invoke.mockImplementation(async (command: string, args?: { request: Record<string, unknown> }) => {
      if (command === ACT) return { ok: false, error: "consent_disabled" };
      if (command === POSITIONS) {
        const request = args!.request as { op: string; id?: string };
        if (request.op === "detail") return { ok: true, data: request.id === "101" ? { ...(detail as object), token: TOKEN } : null };
        if (request.op === "facets") return { ok: true, data: { items: syntheticFacets } };
        if (request.op === "stats") return { ok: true, data: syntheticStats() };
        return { ok: true, data: { items: [syntheticPosition], total: 1 } };
      }
      return null;
    });
    navigate("/positions/101", { replace: true });
    render(<Shell />);
    await screen.findAllByText("Synthetic role A");
    await user.click(await screen.findByRole("button", { name: /^candidati$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/consenso/i);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  }, 30_000);
});
