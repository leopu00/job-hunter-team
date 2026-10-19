import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { installApiBridge, notInDesktop, shellApi } from "../../shell/api-bridge";
import { navigate } from "../../shell/router";
import Shell from "../../shell/Shell";
import { profileReply, SYNTHETIC_FIELDS } from "../../test-support/existing-team-profile-fixture";
import { createPermissiveSupabase } from "../../test-support/permissive-supabase";
import { EXISTING_TEAM_PROFILE_TEXT } from "./existing-team-profile.i18n";
import { EXISTING_TEAM_READONLY_TEXT } from "../../lib/existing-team-readonly.i18n";

// «Profilo» on an existing team that is only read: the candidate profile the
// team's VPS holds, drawn by the web's own ProfileView, read again on Aggiorna
// with the time of the read, with everything the core could not read, cut or
// leave out told one by one. Synthetic data only.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createPermissiveSupabase> | null }));

vi.mock("@tauri-apps/api/core", () => native);
vi.mock("../../lib/supabase", () => ({
  get supabase() {
    return fake.current!.client;
  },
  supabaseConfigured: true,
  signOut: vi.fn(),
}));
vi.mock("../map", () => ({ default: () => <h1>Mappa</h1> }));
vi.mock("../office", () => ({ default: () => <h1>Ufficio</h1> }));

const T = EXISTING_TEAM_PROFILE_TEXT.it;
const REASON = EXISTING_TEAM_READONLY_TEXT.it.assistantOff;
const COMMAND = "existing_team_positions_read";

let restoreBridge: () => void;
let answer: () => Promise<unknown>;

beforeEach(() => {
  fake.current = createPermissiveSupabase();
  document.cookie = "NEXT_LOCALE=it; path=/";
  native.isTauri.mockReturnValue(true);
  native.invoke.mockReset();
  answer = async () => profileReply();
  native.invoke.mockImplementation(async (command: string) => {
    if (command === COMMAND) return answer();
    throw new Error(`unexpected native command ${command}`);
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:synthetic"), revokeObjectURL: vi.fn() }));
  restoreBridge = installApiBridge(shellApi(notInDesktop));
  enterExistingTeamReadOnly(false, { at: Date.UTC(2026, 9, 14, 9, 30, 0), captainRunning: true, assistantRunning: false });
});
afterEach(() => {
  cleanup();
  restoreBridge();
  leaveExistingTeamReadOnly();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const reads = () => native.invoke.mock.calls.filter(([command]) => command === COMMAND);
const open = async () => {
  navigate("/profile", { replace: true });
  render(<Shell />);
};
const navbarRefresh = () => within(screen.getByRole("banner")).getByRole("button", { name: "Aggiorna" });
const pageRefresh = () => within(screen.getByRole("main")).getByRole("button", { name: T.refresh });
const noticeIds = () =>
  [...screen.queryAllByTestId(/^profile-notice-/)].map((element) => element.getAttribute("data-testid")!.replace("profile-notice-", ""));

describe("Profilo on an existing team read only", () => {
  it("is in the navigation, asks the core for the profile once and draws it with the web's own view", async () => {
    await open();
    const nav = screen.getByRole("navigation", { name: "Navigazione app" });
    expect(within(nav).getByRole("link", { name: "Profilo" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByTestId("profile-view")).toBeInTheDocument();
    expect(reads()).toHaveLength(1);
    expect(native.invoke).toHaveBeenCalledWith(COMMAND, { request: { op: "profile" } });
    const view = screen.getByTestId("profile-view");
    expect(view).toHaveTextContent("Synthetic Persona");
    expect(view).toHaveTextContent("Synthetic Role");
    expect(view).toHaveTextContent("Alpha Skill");
    expect(view).toHaveTextContent("Synthetic Company");
    expect(view).toHaveTextContent("日本語 Ünïcode");
    // the summary the assistant wrote is a block of the profile
    expect(view).toHaveTextContent("A synthetic narrative about the persona.");
    expect(screen.getByTestId("profile-time").textContent).toContain(T.readAt.replace("{time}", ""));
    expect(noticeIds()).toEqual([]);
  });

  it("tells the assistant's summary section in the app's language, not in the Italian it is stored in", async () => {
    document.cookie = "NEXT_LOCALE=en; path=/";
    await open();
    const view = await screen.findByTestId("profile-view");
    expect(within(view).getByText("About me")).toBeInTheDocument();
    expect(view).not.toHaveTextContent(/Chi sono/i);
  });

  it("shows editing disabled with the reason, and no control that changes anything", async () => {
    await open();
    await screen.findByTestId("profile-view");
    const edit = screen.getByTestId("profile-edit");
    expect(edit).toBeDisabled();
    expect(edit).toHaveAttribute("title", REASON);
    expect(screen.getByTestId("profile-edit-reason")).toHaveTextContent(REASON);
    // the web's own edit button (it asks the assistant) is not drawn: the only «Modifica» is the disabled one
    const edits = screen.getAllByRole("button", { name: /modific/i });
    expect(edits).toHaveLength(1);
    expect(edits[0]).toBe(edit);
    // The read command, and the header's read of which team this is (a local file, no SSH): nothing else.
    expect(
      native.invoke.mock.calls.map(([command]) => command).filter((c) => c !== COMMAND && c !== "existing_team_link_identity"),
    ).toEqual([]);
    expect(fake.current!.calls).toEqual([]);
  });

  it("says the CV and the original documents are not downloaded from here", async () => {
    await open();
    await screen.findByTestId("profile-view");
    expect(screen.getByTestId("profile-limits")).toHaveTextContent(T.limits);
  });

  it("reads again on Aggiorna through the core, with a new time, and the navbar's Aggiorna too", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await open();
    await screen.findByTestId("profile-view");
    const first = screen.getByTestId("profile-time").textContent;

    vi.setSystemTime(new Date("2026-10-14T12:05:30Z"));
    answer = async () => profileReply({ fields: { ...SYNTHETIC_FIELDS, name: "Renamed Persona" } });
    await user.click(pageRefresh());
    await waitFor(() => expect(screen.getByTestId("profile-view")).toHaveTextContent("Renamed Persona"));
    expect(screen.getByTestId("profile-time").textContent).not.toBe(first);
    expect(reads()).toHaveLength(2);

    answer = async () => profileReply({ fields: { ...SYNTHETIC_FIELDS, name: "Third Persona" } });
    await user.click(navbarRefresh());
    await waitFor(() => expect(screen.getByTestId("profile-view")).toHaveTextContent("Third Persona"));
    expect(reads()).toHaveLength(3);
  });

  it("shows nothing as the profile until a read succeeds", async () => {
    answer = () => new Promise(() => undefined);
    await open();
    expect(screen.queryByTestId("profile-view")).not.toBeInTheDocument();
    expect(screen.queryByText("Synthetic Persona")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: T.refreshing })).toBeDisabled();
  });

  it("tells the unread state once a read is not running", async () => {
    answer = async () => {
      throw { code: "snapshot_failed" };
    };
    await open();
    expect(await screen.findByTestId("profile-error")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-unknown")).not.toBeInTheDocument();
  });

  it("shows the real code of a failed read and never an older profile as the present", async () => {
    const user = userEvent.setup();
    await open();
    await screen.findByTestId("profile-view");
    answer = async () => ({ ok: false, error: "positions_unavailable" });
    await user.click(pageRefresh());
    const alert = await screen.findByTestId("profile-error");
    expect(alert).toHaveTextContent("(positions_unavailable)");
    expect(alert).toHaveTextContent(T.failed);
    expect(screen.queryByTestId("profile-view")).not.toBeInTheDocument();
    expect(screen.queryByText("Synthetic Persona")).not.toBeInTheDocument();
    answer = async () => profileReply();
    await user.click(pageRefresh());
    expect(await screen.findByTestId("profile-view")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-error")).not.toBeInTheDocument();
  });

  it("calls a reply that is not whole a bad reply, not an empty profile", async () => {
    answer = async () => ({ ok: true, data: { profile: { state: "ok" } } });
    await open();
    expect(await screen.findByTestId("profile-error")).toHaveTextContent("(desktop_bad_reply)");
    expect(screen.queryByTestId("profile-view")).not.toBeInTheDocument();
  });

  it("marks the previous data as such while it reads again", async () => {
    const user = userEvent.setup();
    await open();
    await screen.findByTestId("profile-view");
    let release!: (value: unknown) => void;
    answer = () => new Promise((resolve) => { release = resolve; });
    await user.click(pageRefresh());
    await waitFor(() => expect(screen.getByTestId("profile-time").textContent).toContain("aggiornamento in corso"));
    expect(screen.getByTestId("profile-view")).toHaveAttribute("aria-busy", "true");
    release(profileReply());
    await waitFor(() => expect(screen.getByTestId("profile-time").textContent).not.toContain("aggiornamento in corso"));
  });

  it("never lets a slow older read overwrite a newer one", async () => {
    const user = userEvent.setup();
    let releaseOld!: (value: unknown) => void;
    let call = 0;
    answer = () => {
      call += 1;
      if (call === 1) return new Promise((resolve) => { releaseOld = resolve; });
      return Promise.resolve(profileReply({ fields: { ...SYNTHETIC_FIELDS, name: "Newer Persona" } }));
    };
    await open();
    await waitFor(() => expect(reads()).toHaveLength(1));
    await user.click(navbarRefresh());
    await waitFor(() => expect(screen.getByTestId("profile-view")).toHaveTextContent("Newer Persona"));
    releaseOld(profileReply({ fields: { ...SYNTHETIC_FIELDS, name: "Older Persona" } }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByTestId("profile-view")).toHaveTextContent("Newer Persona");
    expect(screen.queryByText("Older Persona")).not.toBeInTheDocument();
  });
});

describe("what the core could not read, cut or leave out is told", () => {
  it("a team with no profile file: says so and draws no profile", async () => {
    answer = async () =>
      profileReply({ fields: null, file: { state: "absent", parse: "none", bytes: undefined, sha256: undefined }, summaries: [], summariesPart: { state: "absent" } });
    await open();
    expect(await screen.findByTestId("profile-notice-file-absent")).toHaveTextContent(T.fileAbsent);
    expect(screen.queryByTestId("profile-view")).not.toBeInTheDocument();
  });

  it("a file over the cap: says its size and the cap", async () => {
    answer = async () => profileReply({ fields: null, file: { state: "too_large", parse: "none", bytes: 70000 }, summaries: [] });
    await open();
    const notice = await screen.findByTestId("profile-notice-file-too-large");
    expect(notice).toHaveTextContent("70000");
    expect(notice).toHaveTextContent("65536");
    expect(screen.queryByTestId("profile-view")).not.toBeInTheDocument();
  });

  it.each([
    ["unreadable", { state: "unreadable", parse: "none" }, "file-unreadable", "fileUnreadable"],
    ["not text", { state: "not_utf8", parse: "none", bytes: 6 }, "file-not-text", "fileNotText"],
    ["invalid yaml", { parse: "invalid_yaml" }, "parse-invalid", "parseInvalid"],
    ["not a mapping", { parse: "not_a_mapping" }, "parse-not-mapping", "parseNotMapping"],
    ["aliases", { parse: "aliases_unsupported" }, "parse-aliases", "parseAliases"],
  ] as const)("a file that is %s: says why and draws no field", async (_name, file, id, key) => {
    answer = async () => profileReply({ fields: null, file, summaries: [] });
    await open();
    expect(await screen.findByTestId(`profile-notice-${id}`)).toHaveTextContent(T[key]);
    expect(screen.queryByTestId("profile-view")).not.toBeInTheDocument();
    expect(screen.queryByText("Synthetic Persona")).not.toBeInTheDocument();
  });

  it("fields dropped by the whitelist are counted, and the base fields the file lacks are named", async () => {
    answer = async () => profileReply({ fields: { name: "Sparse Persona" }, file: { kept: 1, dropped: 3 }, summaries: [] });
    await open();
    expect(await screen.findByTestId("profile-notice-dropped")).toHaveTextContent(T.dropped.replace("{n}", "3"));
    expect(screen.getByTestId("profile-notice-missing-core")).toHaveTextContent(
      T.missingCore.replace("{list}", "target_role, location, experience_years, has_degree, seniority_target, skills, languages"),
    );
    // what it does have is drawn
    expect(screen.getByTestId("profile-view")).toHaveTextContent("Sparse Persona");
  });

  it("a summary that was not read is named with the reason, its text is not shown, the others are", async () => {
    answer = async () =>
      profileReply({
        summaries: [
          { name: "about", state: "ok", bytes: 10, text: "Readable synthetic summary." },
          { name: "huge", state: "too_large", bytes: 40000 },
          { name: "odd", state: "not_utf8", bytes: 5 },
          { name: "heavy", state: "over_budget", bytes: 30000, text: "SYNTHETIC-OMITTED-TEXT" },
        ],
      });
    await open();
    expect(await screen.findByTestId("profile-notice-summary-huge")).toHaveTextContent("«huge»");
    expect(screen.getByTestId("profile-notice-summary-huge")).toHaveTextContent(T.summaryTooLarge);
    expect(screen.getByTestId("profile-notice-summary-odd")).toHaveTextContent(T.summaryNotText);
    expect(screen.getByTestId("profile-notice-summary-heavy")).toHaveTextContent(T.summaryOverBudget);
    expect(screen.getByTestId("profile-view")).toHaveTextContent("Readable synthetic summary.");
    expect(document.body.textContent).not.toContain("SYNTHETIC-OMITTED-TEXT");
  });

  it("reading fewer summaries than there are is told", async () => {
    answer = async () => profileReply({ summariesPart: { included: 1, of: 40 } });
    await open();
    expect(await screen.findByTestId("profile-notice-summaries-cut")).toHaveTextContent(T.summariesCut.replace("{included}", "1").replace("{of}", "40"));
  });

  it("an unreadable summaries folder is told, and the profile itself is still drawn", async () => {
    answer = async () => profileReply({ summaries: [], summariesPart: { state: "unreadable" } });
    await open();
    expect(await screen.findByTestId("profile-notice-summaries-unreadable")).toHaveTextContent(T.summariesUnreadable);
    expect(screen.getByTestId("profile-view")).toHaveTextContent("Synthetic Persona");
  });

  it("a profile the mapper refuses is told, not drawn in part", async () => {
    answer = async () => profileReply({ fields: { ...SYNTHETIC_FIELDS, target_role_category_id: "not-a-category" } });
    await open();
    expect(await screen.findByTestId("profile-notice-map-failed")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-view")).not.toBeInTheDocument();
  });

  it("shows nothing the whitelist does not name, even if the reply carried it", async () => {
    answer = async () => profileReply({ fields: { ...SYNTHETIC_FIELDS, provider_token: "synthetic-secret-value", jht_config: { key: "synthetic-config-value" } } });
    await open();
    await screen.findByTestId("profile-view");
    expect(document.body.textContent).not.toContain("synthetic-secret-value");
    expect(document.body.textContent).not.toContain("synthetic-config-value");
  });
});
