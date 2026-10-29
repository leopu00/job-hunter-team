import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeQuery } from "../../test-support/fake-supabase";
import { registerAuthStorageProbe } from "../../lib/auth-storage-lock";
import { forgetReadsInFlight, PAGE_READ_DEADLINE_MS, READ_IN_FLIGHT_MAX_MS } from "../../lib/read-deadline";
import { SHELL_TEXT } from "../../shell/shell.i18n";
import { PROFILE_PAGE_TEXT } from "./profile-page.i18n";
import { ProfilePage } from ".";
import { loadProfile, openContacts, profileExport } from "./load-profile";
import { getProfileT, languageLevelLabel } from "@/lib/profile-i18n";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => false) }));
vi.mock("@tauri-apps/api/core", () => native);

// What the app reads from the local profile file (profile_progress_read): five of the eight fields there.
const LOCAL_READING = {
  ok: true,
  required: 8,
  done: 5,
  ready: false,
  fields: [
    { key: "name", ok: true, preview: "Persona Di Prova" },
    { key: "email", ok: true },
    { key: "target_role", ok: true, preview: "Sviluppatrice" },
    { key: "location", ok: false },
    { key: "experience_years", ok: true, preview: "6" },
    { key: "seniority_target", ok: false },
    { key: "skills", ok: true, count: 3 },
    { key: "languages", ok: false, count: 0 },
  ],
};

// Profilo sintetico: nessun dato vero.
const PROFILE = {
  user_id: "00000000-0000-4000-8000-000000000001",
  name: "Persona Di Prova",
  headline: "Sviluppatrice",
  skills: { linguaggi: ["TypeScript"] },
  positioning: {
    experience: [{ role: "Ruolo di prova", company: "Azienda Esempio", period: "2020 - present", summary: "Fa cose" }],
    education: [{ degree: "Laurea di prova", institution: "Ateneo Esempio", year: 2019 }],
  },
  updated_at: "2026-09-20T10:00:00Z",
};

function respond(query: FakeQuery) {
  if (query.table === "candidate_profiles") return { data: PROFILE, error: null };
  if (query.table === "candidate_blocks") return { data: [], error: null };
  if (query.table === "candidate_contacts")
    return {
      data: { email: null, phone: "enc:v1:QUJD", linkedin: "https://example.invalid/in/prova", github: null, website: null, address: null },
      error: null,
    };
  return { data: null, error: null };
}

beforeEach(() => forgetReadsInFlight());

afterEach(() => {
  vi.restoreAllMocks();
});

describe("openContacts", () => {
  it("shows the plain values and holds back the ones sealed with the server's key", () => {
    const { contacts, sealed } = openContacts({ phone: "enc:v1:QUJD", linkedin: "https://example.invalid/x" });
    expect(contacts).toMatchObject({ phone: null, linkedin: "https://example.invalid/x" });
    expect(sealed).toEqual(["phone"]);
    expect(openContacts(null)).toEqual({ contacts: null, sealed: [] });
  });
});

describe("loadProfile", () => {
  it("reads the user's own rows, and nothing without a session", async () => {
    const { client, queries } = fakeSupabase(respond);
    const data = await loadProfile(client);
    expect(data?.profile).toMatchObject({ name: "Persona Di Prova" });
    for (const q of queries) expect(q.ops).toContainEqual(["eq", ["user_id", PROFILE.user_id]]);

    const signedOut = fakeSupabase(respond, null);
    expect(await loadProfile(signedOut.client)).toBeNull();
    expect(signedOut.queries).toHaveLength(0);
  });

  it("exports the same file the web route gives", () => {
    const file = profileExport(PROFILE as never, new Date("2026-09-26T12:00:00Z"));
    expect(file.fileName).toBe("profilo-candidato-2026-09-26.json");
    expect(JSON.parse(file.json)).toEqual(PROFILE);
  });
});

describe("ProfilePage", () => {
  it("renders the web's profile view with the user's data, export and no edit", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:profile");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const { client } = fakeSupabase(respond);
    render(<ProfilePage client={client} />);
    expect(await screen.findByText("Ruolo di prova")).toBeInTheDocument();
    expect(screen.getByText("Laurea di prova")).toBeInTheDocument();
    const exportLink = document.querySelector('a[download="profilo-candidato-' + new Date().toISOString().slice(0, 10) + '.json"]');
    expect(exportLink).toHaveAttribute("href", "blob:profile");
    expect(screen.getByText(/è cifrato sul server/)).toHaveTextContent("Un contatto (phone)");
  });
});

describe("language levels", () => {
  it("tells a stored level in the app's language, not as the English word the CV gave", async () => {
    const withLanguages = { ...PROFILE, languages: [{ language: "Italiano", level: "native" }, { language: "Inglese", level: "c1" }] };
    const { client } = fakeSupabase((query) =>
      query.table === "candidate_profiles" ? { data: withLanguages, error: null } : respond(query),
    );
    render(<ProfilePage client={client} />);
    expect(await screen.findByText("madrelingua")).toBeInTheDocument();
    expect(screen.queryByText("native")).toBeNull();
    expect(screen.getByText("C1")).toBeInTheDocument();
  });

  it("knows the levels in English and Italian in every language, and leaves an unknown one as stored", () => {
    for (const locale of ["it", "en", "de", "es", "fr", "hu", "pt"] as const) {
      const t = getProfileT(locale);
      for (const [stored, key] of [["Native", "lvl_native"], ["madrelingua", "lvl_native"], ["fluent", "lvl_fluent"], ["Avanzato", "lvl_advanced"], ["intermediate", "lvl_intermediate"], ["base", "lvl_basic"]]) {
        expect(languageLevelLabel(stored, t)).toBe(t(key));
        expect(t(key)).not.toBe(key);
      }
      expect(languageLevelLabel("Professionale", t)).toBe("Professionale");
      expect(languageLevelLabel(undefined, t)).toBe("");
    }
  });
});

describe("ProfilePage, a session that never answers", () => {
  it("says it could not read the profile after the deadline, and the button reads it again", async () => {
    vi.useFakeTimers();
    try {
      const { client } = fakeSupabase(respond);
      const getSession = vi.fn(client.auth.getSession.bind(client.auth));
      getSession.mockReturnValueOnce(new Promise(() => undefined) as never);
      (client.auth as { getSession: unknown }).getSession = getSession;
      render(<ProfilePage client={client} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(PAGE_READ_DEADLINE_MS); });
      expect(screen.getByRole("alert")).toHaveTextContent("Non riesco a leggere il profilo");
      // the read that never answered is not waited for beyond the window: the button starts a new one
      await act(async () => { await vi.advanceTimersByTimeAsync(READ_IN_FLIGHT_MAX_MS - PAGE_READ_DEADLINE_MS); });
      await act(async () => { screen.getByRole("button", { name: "Riprova" }).click(); });
      await act(async () => undefined);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(getSession).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ProfilePage, with no cloud session", () => {
  afterEach(() => {
    registerAuthStorageProbe(() => true);
    native.isTauri.mockReturnValue(false);
  });

  it("shows a local profile its own profile, the fields and the bar, and never asks it to sign in", async () => {
    registerAuthStorageProbe(() => false);
    native.isTauri.mockReturnValue(true);
    native.invoke.mockResolvedValue(LOCAL_READING);
    const { client, queries } = fakeSupabase(respond, null);
    render(<ProfilePage client={client} />);
    expect(await screen.findByTestId("profile-progress-bar")).toBeInTheDocument();
    expect(screen.getByTestId("profile-progress")).toHaveAttribute("data-state", "ready");
    expect(screen.getByTestId("profile-progress-counter")).toHaveTextContent("5");
    expect(screen.getByText("Persona Di Prova")).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByText(/Questi dati arrivano dal cloud/)).not.toBeInTheDocument();
    expect(screen.queryByText(getProfileT("it")("session_expired"))).not.toBeInTheDocument();
    expect(queries).toHaveLength(0);
  });

  it("a local profile the team has not written yet is told in a line, still without a sign-in notice", async () => {
    registerAuthStorageProbe(() => false);
    native.isTauri.mockReturnValue(true);
    native.invoke.mockResolvedValue({ ok: false, error: "profile_unavailable" });
    const { client } = fakeSupabase(respond, null);
    render(<ProfilePage client={client} />);
    expect(await screen.findByTestId("profile-progress-unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("still says the session expired to someone who had one", async () => {
    registerAuthStorageProbe(() => true);
    const { client } = fakeSupabase(respond, null);
    render(<ProfilePage client={client} />);
    expect(await screen.findByText(getProfileT("it")("session_expired"))).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});

describe("the profile's read failure", () => {
  it("is said in every language, each with its own refresh word", () => {
    for (const locale of Object.keys(PROFILE_PAGE_TEXT) as Array<keyof typeof PROFILE_PAGE_TEXT>) {
      const refresh = SHELL_TEXT[locale].refresh;
      const text = PROFILE_PAGE_TEXT[locale].readFailed(refresh);
      expect(text, locale).toContain(refresh);
      if (locale !== "it") expect(text, `${locale} is not Italian`).not.toBe(PROFILE_PAGE_TEXT.it.readFailed(refresh));
    }
  });
});
