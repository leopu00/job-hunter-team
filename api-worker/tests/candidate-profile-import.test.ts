import { describe, expect, it } from "vitest";

import { importCandidateProfile2026 } from "../src/index.js";
import { loadFixture } from "./helpers.js";

describe("2026 candidate profile import", () => {
  it("maps the external profile without retaining identity fields", async () => {
    const raw = (await loadFixture(
      "candidate-profile-2026.synthetic.json",
    )) as Record<string, unknown>;
    const imported = importCandidateProfile2026(raw);

    expect(imported.profile).toMatchObject({
      profileVersion: "1",
      targets: {
        roles: [
          "Agentic AI Engineer / Forward Deployed Engineer",
          "AI Solutions Engineer",
          "Python Developer",
        ],
        locations: ["Remote EU", "Remote Worldwide", "Remote (EU-wide)"],
        workModes: ["remote"],
      },
      experienceYears: 4,
      relocation: true,
      search: { postedWithinDays: 30, maxCandidates: 5 },
    });
    expect(imported.profile.skills).toContain("AI agent orchestration");
    expect(imported.writerEvidence.experienceHighlights).toHaveLength(2);
    expect(JSON.stringify(imported)).not.toContain(String(raw["email"]));
    expect(imported).not.toHaveProperty("name");
  });
});
