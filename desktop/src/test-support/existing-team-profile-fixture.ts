// A synthetic profile reply shaped as the core's `profile` op returns it after
// the native side has parsed the file: the whitelisted fields, the summaries,
// and what was read, cut or dropped. Nothing here is a real person's data.
export const SYNTHETIC_FIELDS = {
  name: "Synthetic Persona",
  target_role: "Synthetic Role",
  location: "Synthetic City",
  experience_years: 7,
  has_degree: true,
  seniority_target: "senior",
  skills: { primary: ["Alpha Skill", "Beta Skill"], secondary: ["Gamma Skill"] },
  languages: [{ language: "Synthetic Language", level: "C1" }],
  experience: [
    { company: "Synthetic Company", role: "Synthetic Engineer", period: "Sep 2019 - Feb 2023", summary: "Built synthetic things — 日本語 Ünïcode." },
  ],
  candidate: { contacts: { phone: "000 000 0000" } },
} as const;

export function profileReply(overrides: {
  fields?: Record<string, unknown> | null;
  file?: Record<string, unknown>;
  summaries?: Array<Record<string, unknown>>;
  summariesPart?: Record<string, unknown>;
} = {}) {
  const fields = overrides.fields === undefined ? { ...SYNTHETIC_FIELDS } : overrides.fields;
  const items = overrides.summaries ?? [
    { name: "about", state: "ok", bytes: 24, sha256: "a".repeat(64), text: "A synthetic narrative about the persona." },
  ];
  return {
    ok: true,
    data: {
      profile: {
        state: "ok",
        bytes: 900,
        sha256: "b".repeat(64),
        parse: "ok",
        fields,
        kept: fields ? Object.keys(fields).length : 0,
        dropped: 0,
        ...overrides.file,
      },
      summaries: { state: "ok", items, included: items.length, of: items.length, ...overrides.summariesPart },
    },
  };
}
