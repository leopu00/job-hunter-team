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
let calls: Array<{ command: string; request: Record<string, unknown> }> = [];

let restoreBridge: () => void;
beforeEach(() => {
  fake.current = createPermissiveSupabase();
  document.cookie = "NEXT_LOCALE=it; path=/";
  calls = [];
  native.isTauri.mockReturnValue(true);
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (command: string, args?: { request: Record<string, unknown> }) => {
    if (command === POSITIONS) {
      const request = args!.request as { op: string; id?: string };
      if (request.op === "detail") return { ok: true, data: request.id === "101" ? { ...syntheticDetail, token: TOKEN } : null };
      if (request.op === "facets") return { ok: true, data: { items: syntheticFacets } };
      if (request.op === "stats") return { ok: true, data: syntheticStats() };
      return { ok: true, data: { items: [syntheticPosition], total: 1 } };
    }
    if (command === ACT) {
      calls.push({ command, request: args!.request });
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
});
