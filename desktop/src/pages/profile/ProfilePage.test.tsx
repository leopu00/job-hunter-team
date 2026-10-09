import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeQuery } from "../../test-support/fake-supabase";
import { ProfilePage } from ".";
import { loadProfile, openContacts, profileExport } from "./load-profile";
import { getProfileT, languageLevelLabel } from "@/lib/profile-i18n";

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
    expect(screen.getByText(/sono cifrati sul server/)).toHaveTextContent("phone");
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
