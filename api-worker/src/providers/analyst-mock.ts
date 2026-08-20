import {
  AnalystProposalSchema,
  type AnalystProposal,
} from "../analyst-contract.js";
import { WorkerFault } from "../errors.js";
import type {
  AnalystProviderAdapter,
  AnalystProviderContext,
  AnalystProviderExecution,
} from "./analyst-provider.js";

export class MockAnalystProvider implements AnalystProviderAdapter {
  async run(
    context: AnalystProviderContext,
  ): Promise<AnalystProviderExecution> {
    if (context.signal.aborted) throw timeoutFault();
    const reservation = context.guard.beforeProviderStep(
      `${context.systemPrompt}\n${context.prompt}`,
    );
    await context.recordRequestStarted(reservation);

    const output = buildSyntheticAnalysis(context);
    await context.recordStep({
      reservation,
      usage: { inputTokens: 420, outputTokens: 260, totalTokens: 680 },
      finishReason: "stop",
    });
    return { output, rawStopReason: "stop" };
  }
}

function buildSyntheticAnalysis(
  context: AnalystProviderContext,
): AnalystProposal {
  const { position, candidate, activeRoleFamilies } = context.input;
  const haystack = `${position.title}\n${position.jdText}\n${position.requirements.join("\n")}`;
  const experience = haystack.match(/\b(\d{1,2})\+?\s+years?\b/i);
  const seniority = inferSeniority(position.title, haystack);
  const languagesRequired = ["English", "Italian", "German", "French"]
    .filter((language) => new RegExp(`\\b${language}\\b`, "i").test(haystack))
    .map((language) => `${language} (level not specified)`);
  const mismatchTags: AnalystProposal["mismatchTags"] = [];
  const requiredYears = experience ? Number(experience[1]) : null;
  if (
    requiredYears !== null &&
    candidate.experienceYears !== undefined &&
    requiredYears > candidate.experienceYears
  ) {
    mismatchTags.push("SENIORITY");
  }
  const location = inferLocation(position.location, position.remoteType);
  const roleFamily = reconcileRoleFamily(
    inferRoleFamily(position.title),
    activeRoleFamilies,
  );

  return AnalystProposalSchema.parse({
    sourceId: position.sourceId,
    url: position.url,
    decision: "checked",
    structuredRequirements: {
      experienceRequiredYears: requiredYears,
      experienceType: requiredYears === null ? "not_specified" : "mandatory",
      degree: inferDegree(haystack),
      languagesRequired,
      seniority,
    },
    mismatchTags,
    teamNote:
      mismatchTags.length > 0
        ? "The role remains worth scoring, but the stated experience level is above the candidate profile."
        : "The listing stays inside the candidate's technical domain and should proceed to scoring.",
    jdSummary: summarize(position.jdText),
    roleFamily,
    location,
    company: {
      name: position.company,
      redFlags: [],
      cultureNotes: [],
      verdict: "CAUTIOUS",
    },
    highlights:
      position.remoteType === "remote"
        ? [{ type: "pro", text: "Advertised as remote work." }]
        : [],
    disposition: "proposed",
    persistence: "none",
  });
}

function inferSeniority(
  title: string,
  text: string,
): "junior" | "mid" | "senior" | "lead" | "not_specified" {
  const normalized = `${title} ${text.slice(0, 1_000)}`.toLowerCase();
  if (/\b(lead|staff|principal|head)\b/.test(normalized)) return "lead";
  if (/\bsenior\b/.test(normalized)) return "senior";
  if (/\bjunior\b/.test(normalized)) return "junior";
  if (/\bmid(?:-level)?\b/.test(normalized)) return "mid";
  return "not_specified";
}

function inferDegree(
  text: string,
):
  | "mandatory"
  | "preferred"
  | "not_required"
  | "or_equivalent"
  | "not_specified" {
  if (
    /\b(?:degree|bachelor|master|phd)\b.{0,40}\bor equivalent\b/i.test(text)
  ) {
    return "or_equivalent";
  }
  if (
    /\b(?:degree|bachelor|master|phd)\b.{0,40}\b(?:required|must)\b/i.test(text)
  ) {
    return "mandatory";
  }
  if (/\b(?:degree|bachelor|master|phd)\b.{0,40}\bpreferred\b/i.test(text)) {
    return "preferred";
  }
  return "not_specified";
}

function inferRoleFamily(title: string): string {
  if (/platform|devops|sre|infrastructure/i.test(title)) {
    return "Platform Engineering";
  }
  if (/front|ui|design engineer/i.test(title)) return "Frontend Engineering";
  if (/data/i.test(title)) return "Data Engineering";
  return "Software Engineering";
}

function reconcileRoleFamily(
  inferred: string,
  activeRoleFamilies: string[],
): string {
  return (
    activeRoleFamilies.find(
      (family) => family.toLowerCase() === inferred.toLowerCase(),
    ) ?? inferred
  );
}

function inferLocation(
  raw: string,
  workMode: "remote" | "hybrid" | "onsite" | "unspecified",
) {
  if (/\brome\b/i.test(raw)) {
    return { city: "Rome", country: "Italy", countryCode: "IT", workMode };
  }
  if (/\beu|european union\b/i.test(raw)) {
    return {
      city: null,
      country: "European Union",
      countryCode: "EU",
      workMode,
    };
  }
  return {
    city: workMode === "remote" ? null : raw,
    country: "Not specified",
    countryCode: "ZZ",
    workMode,
  };
}

function summarize(value: string): string {
  return value.length <= 900 ? value : `${value.slice(0, 897)}...`;
}

function timeoutFault(): WorkerFault {
  return new WorkerFault("TIMEOUT", {
    retryable: true,
    limit: "timeout_ms",
  });
}
