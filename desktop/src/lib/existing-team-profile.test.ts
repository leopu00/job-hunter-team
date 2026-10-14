import { describe, expect, it, vi } from "vitest";
import { profileReply, SYNTHETIC_FIELDS } from "../test-support/existing-team-profile-fixture";
import { buildProfileView, missingCoreFields, pickProfileRead, readExistingTeamProfile } from "./existing-team-profile";

const data = (overrides?: Parameters<typeof profileReply>[0]) => profileReply(overrides).data;

describe("pickProfileRead", () => {
  it("takes the file, the fields and the summaries of a whole reply", () => {
    const picked = pickProfileRead(data())!;
    expect(picked.file).toMatchObject({ state: "ok", parse: "ok", kept: 10, dropped: 0, bytes: 900 });
    expect(picked.file.fields).toEqual(SYNTHETIC_FIELDS);
    expect(picked.summaries.items).toEqual([
      { name: "about", state: "ok", bytes: 24, text: "A synthetic narrative about the persona." },
    ]);
  });

  it("keeps no text for a summary that was not read, and no field for a file that was not parsed", () => {
    const picked = pickProfileRead(
      data({ fields: null, file: { parse: "invalid_yaml" }, summaries: [{ name: "big", state: "too_large", bytes: 40000, text: "must not survive" }] }),
    )!;
    expect(picked.file.fields).toBeNull();
    expect(picked.summaries.items[0]).toEqual({ name: "big", state: "too_large", bytes: 40000, text: null });
    expect(pickProfileRead({ profile: { state: "absent" }, summaries: { state: "absent", items: [], included: 0, of: 0 }, ...{} })).toBeNull();
  });

  it("refuses a reply that is not whole instead of reading the gap as an empty profile", () => {
    const good = data();
    const broken: unknown[] = [
      null,
      "x",
      {},
      { ...good, profile: null },
      { ...good, summaries: null },
      { ...good, profile: { ...good.profile, state: "mystery" } },
      { ...good, profile: { ...good.profile, parse: "mystery" } },
      { ...good, profile: { ...good.profile, fields: null } },
      { ...good, profile: { ...good.profile, kept: -1 } },
      { ...good, profile: { ...good.profile, dropped: "2" } },
      { ...good, summaries: { ...good.summaries, state: "mystery" } },
      { ...good, summaries: { ...good.summaries, items: {} } },
      { ...good, summaries: { ...good.summaries, included: null } },
      { ...good, summaries: { ...good.summaries, items: [{ name: "x", state: "ok" }] } },
      { ...good, summaries: { ...good.summaries, items: [{ name: 1, state: "ok", text: "t" }] } },
      { ...good, summaries: { ...good.summaries, items: [{ name: "x", state: "mystery", text: "t" }] } },
    ];
    for (const value of broken) expect(pickProfileRead(value), JSON.stringify(value)).toBeNull();
  });
});

describe("readExistingTeamProfile", () => {
  it("reads through the call it is given, with the moment of the read", async () => {
    const read = vi.fn().mockResolvedValue(profileReply());
    const reading = await readExistingTeamProfile(read, () => 1_000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(reading).toMatchObject({ kind: "read", at: 1_000 });
  });

  it("answers the core's real error code, a name for what carries none, and a bad reply as such", async () => {
    expect(await readExistingTeamProfile(vi.fn().mockResolvedValue({ ok: false, error: "positions_unavailable" }), () => 1)).toEqual({
      kind: "error", at: 1, code: "positions_unavailable",
    });
    expect(await readExistingTeamProfile(vi.fn().mockRejectedValue(new Error("boom")), () => 2)).toEqual({
      kind: "error", at: 2, code: "desktop_transport_unavailable",
    });
    for (const bad of [null, "x", { ok: true }, { ok: true, data: {} }, { ok: "yes" }]) {
      expect(await readExistingTeamProfile(vi.fn().mockResolvedValue(bad), () => 3)).toEqual({ kind: "error", at: 3, code: "desktop_bad_reply" });
    }
  });

  it("reads again every time: nothing is kept between two reads", async () => {
    const read = vi.fn().mockResolvedValueOnce(profileReply()).mockResolvedValueOnce(profileReply({ fields: { name: "Other" } }));
    const first = await readExistingTeamProfile(read, () => 1);
    const second = await readExistingTeamProfile(read, () => 2);
    expect(first).toMatchObject({ read: { file: { fields: { name: "Synthetic Persona" } } } });
    expect(second).toMatchObject({ read: { file: { fields: { name: "Other" } } } });
  });
});

describe("missingCoreFields", () => {
  it("names the base fields the file lacks, looking in the legacy sections too", () => {
    expect(missingCoreFields({ ...SYNTHETIC_FIELDS })).toEqual([]);
    expect(missingCoreFields({ name: "x" })).toEqual(["target_role", "location", "experience_years", "has_degree", "seniority_target", "skills", "languages"]);
    expect(missingCoreFields({ candidate: { name: "x", target_role: "y" }, personal: { location: "z" } })).toEqual([
      "experience_years", "has_degree", "seniority_target", "skills", "languages",
    ]);
    expect(missingCoreFields({ name: null, skills: undefined })).toContain("name");
  });
});

describe("buildProfileView", () => {
  it("draws the profile as the cloud mapper does: row, blocks from the summaries, contacts", () => {
    const view = buildProfileView(pickProfileRead(data())!)!;
    expect(view.profile).toMatchObject({ name: "Synthetic Persona", target_role: "Synthetic Role", experience_years: 7, has_degree: true });
    expect(view.profile.skills).toEqual({ primary: ["Alpha Skill", "Beta Skill"], secondary: ["Gamma Skill"] });
    expect(view.blocks).toEqual([expect.objectContaining({ key: "about", kind: "narrative", content: "A synthetic narrative about the persona." })]);
    expect(view.contacts).toMatchObject({ phone: "000 000 0000" });
  });

  it("uses no summary that was not read, and draws nothing from a file that gave no field", () => {
    const view = buildProfileView(
      pickProfileRead(data({ summaries: [{ name: "about", state: "too_large", bytes: 99999 }, { name: "goals", state: "ok", text: "kept" }] }))!,
    )!;
    expect(view.blocks.map((block) => block.key)).toEqual(["goals"]);
    expect(buildProfileView(pickProfileRead(data({ fields: null, file: { parse: "invalid_yaml" } }))!)).toBeNull();
  });

  it("does not carry a key the whitelist does not know, even if the reply had one", () => {
    const view = buildProfileView(pickProfileRead(data({ fields: { ...SYNTHETIC_FIELDS, provider_token: "synthetic-secret-value" } }))!)!;
    expect(JSON.stringify(view)).not.toContain("synthetic-secret-value");
  });
});
