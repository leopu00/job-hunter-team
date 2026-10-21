import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileExclusionControlProvider } from "@/lib/profile-exclusion-control";
import ActiveExclusions from "@/app/(protected)/positions/ActiveExclusions";
import ExclusionProposalCard from "@/app/(protected)/positions/ExclusionProposalCard";

// JHT-T24: the proposal and the active exclusions. Everybody sees them; only the desktop decides and
// withdraws. Synthetic data only.
vi.mock("../../lib/supabase", () => ({ supabase: {}, supabaseConfigured: true, signOut: vi.fn() }));

type Row = { position_legacy_id: number; action: string; reason: string | null; created_at: string };
const rejections = (reason: string, n = 3): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    position_legacy_id: i + 1,
    action: "dislike",
    reason,
    created_at: `2026-10-0${i + 1}T10:00:00Z`,
  }));

let decisions: Array<{ reason: string; status: string; positions_at_decision: number }>;
let feedback: Row[];
let posted: Array<Record<string, unknown>>;

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=it; path=/";
  decisions = [];
  feedback = [];
  posted = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/positions/feedback")) return new Response(JSON.stringify({ feedback }), { status: 200 });
      if (url === "/api/profile-exclusions" && init?.method === "POST") {
        posted.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ exclusion: {} }), { status: 200 });
      }
      if (url === "/api/profile-exclusions") return new Response(JSON.stringify({ exclusions: decisions }), { status: 200 });
      return new Response("{}", { status: 404 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const asDesktop = (ui: ReactElement) => <ProfileExclusionControlProvider value={{ canChange: true }}>{ui}</ProfileExclusionControlProvider>;

describe("the proposal to exclude a kind of position", () => {
  it("on the website is shown and not decided: no button, and it says where", async () => {
    feedback = rejections("company");
    const { container } = render(<ExclusionProposalCard />);
    await waitFor(() => expect(container.querySelector("[data-exclusion-proposal='company']")).not.toBeNull());
    expect(screen.queryByRole("button")).toBeNull();
    expect(container).toHaveTextContent("Questa scelta si fa nell'app desktop.");
  });

  it("in the desktop says what it does for a reason that acts, and decides with the number of positions", async () => {
    feedback = rejections("company");
    const { container } = render(asDesktop(<ExclusionProposalCard />));
    await waitFor(() => expect(container.querySelector("[data-exclusion-proposal='company']")).not.toBeNull());
    expect(container).toHaveTextContent("il team abbassa il punteggio");
    expect(container).not.toHaveTextContent("Per ora salviamo solo");
    fireEvent.click(screen.getByRole("button", { name: "Escludi questo tipo" }));
    await waitFor(() => expect(posted).toEqual([{ reason: "company", status: "accepted", positions: 3 }]));
    expect(await screen.findByText("Esclusione salvata.")).toBeInTheDocument();
  });

  it("says the truth for the seniority: saved, and nothing changes yet", async () => {
    feedback = rejections("too_senior");
    const { container } = render(asDesktop(<ExclusionProposalCard />));
    await waitFor(() => expect(container.querySelector("[data-exclusion-proposal='too_senior']")).not.toBeNull());
    expect(container).toHaveTextContent("Per ora salviamo solo la tua preferenza");
    expect(container).not.toHaveTextContent("il team abbassa il punteggio");
  });

  it("'not now' sends dismissed", async () => {
    feedback = rejections("wrong_stack");
    render(asDesktop(<ExclusionProposalCard />));
    fireEvent.click(await screen.findByRole("button", { name: "Non ora" }));
    await waitFor(() => expect(posted).toEqual([{ reason: "wrong_stack", status: "dismissed", positions: 3 }]));
  });
});

describe("the active exclusions", () => {
  beforeEach(() => {
    decisions = [
      { reason: "company", status: "accepted", positions_at_decision: 3 },
      { reason: "wrong_location", status: "accepted", positions_at_decision: 4 },
      { reason: "too_senior", status: "accepted", positions_at_decision: 3 },
      { reason: "salary_low", status: "dismissed", positions_at_decision: 3 },
    ];
  });

  it("lists the accepted ones with what each does, and on the website only reads them", async () => {
    const { container } = render(<ActiveExclusions />);
    await waitFor(() => expect(container.querySelector("[data-active-exclusions]")).not.toBeNull());
    expect([...container.querySelectorAll("[data-exclusion]")].map((e) => e.getAttribute("data-exclusion"))).toEqual([
      "company",
      "wrong_location",
      "too_senior",
    ]);
    expect(container.querySelector("[data-exclusion='company']")).toHaveTextContent("abbassa il punteggio di 30 punti");
    expect(container.querySelector("[data-exclusion='wrong_location']")).toHaveTextContent("abbassa il punteggio di 15 punti");
    expect(container.querySelector("[data-exclusion='too_senior']")).toHaveTextContent("salvata, per ora non cambia nulla");
    expect(screen.queryByRole("button")).toBeNull();
    expect(container).toHaveTextContent("Si ritirano nell'app desktop.");
  });

  it("in the desktop withdraws one: dismissed, with the number it was decided on, and it leaves the list", async () => {
    const { container } = render(asDesktop(<ActiveExclusions />));
    await waitFor(() => expect(container.querySelectorAll("[data-exclusion]").length).toBe(3));
    fireEvent.click(container.querySelector("[data-exclusion='wrong_location'] button")!);
    await waitFor(() => expect(posted).toEqual([{ reason: "wrong_location", status: "dismissed", positions: 4 }]));
    await waitFor(() => expect(container.querySelector("[data-exclusion='wrong_location']")).toBeNull());
    expect(container.querySelectorAll("[data-exclusion]").length).toBe(2);
  });

  it("shows nothing when nothing is accepted", async () => {
    decisions = [{ reason: "company", status: "dismissed", positions_at_decision: 3 }];
    const { container } = render(<ActiveExclusions />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.querySelector("[data-active-exclusions]")).toBeNull();
  });
});
