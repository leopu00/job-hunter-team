import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  CaptainProviderOutputSchema,
  CaptainRoleSpec,
  CaptainWorkerInputSchema,
  CriticProviderOutputSchema,
  CriticRoleSpec,
  CriticWorkerInputSchema,
  DoctorRoleSpec,
  DoctorWorkerInputSchema,
  SentinelRoleSpec,
  SentinelProviderOutputSchema,
  SentinelWorkerInputSchema,
  WriterApiWorker,
  WriterProviderOutputSchema,
  WriterProposalSchema,
  WriterRoleSpec,
  WriterWorkerInputSchema,
} from "../src/index.js";
import { fixtureProfile, loadFixture } from "./helpers.js";

const run = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const roles = [
  "writer",
  "critic",
  "assistant",
  "mentor",
  "captain",
  "sentinel",
  "doctor",
  "maintainer",
] as const;

type FixtureEnvelope = {
  sharedLimits: unknown;
  inputs: Record<string, Record<string, unknown>>;
};

describe("remaining isolated API roles", () => {
  it("executes every packaged synthetic role command end to end", async () => {
    for (const role of roles) {
      const runtimeDir = await mkdtemp(join(tmpdir(), `jht-${role}-cli-`));
      const { stdout } = await run(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/prototype-cli.ts",
          role,
          "--runtime-dir",
          runtimeDir,
        ],
        { cwd: packageRoot },
      );
      const output = JSON.parse(stdout) as {
        ok: boolean;
        result: {
          role: string;
          persistence: string;
          metrics: { steps: number };
        };
      };
      expect(output).toMatchObject({
        ok: true,
        result: {
          role,
          persistence: "none",
          metrics: { steps: 1 },
        },
      });
      expect(stdout).not.toContain(runtimeDir);
    }
  }, 60_000);

  it("keeps Writer strictly user-driven and score-gated", async () => {
    const envelope = (await loadFixture(
      "prototype-inputs.synthetic.json",
    )) as FixtureEnvelope;
    const raw: Record<string, unknown> = {
      ...envelope.inputs.writer!,
      limits: envelope.sharedLimits,
    };
    expect(() =>
      WriterWorkerInputSchema.parse({ ...raw, userRequested: false }),
    ).toThrow();
    expect(() =>
      WriterWorkerInputSchema.parse({
        ...raw,
        position: {
          ...(raw["position"] as Record<string, unknown>),
          score: 49,
        },
      }),
    ).toThrow();

    const outcome = await new WriterApiWorker(await fixtureProfile(), {
      runtimeDir: await mkdtemp(join(tmpdir(), "jht-writer-gate-")),
    }).run(raw);
    expect(outcome.ok).toBe(true);
  });

  it("constructs Writer output at maximum evidence cardinality without dropping claims", () => {
    const skills = Array.from(
      { length: 30 },
      (_, index) => `skill-${index}-${"s".repeat(280)}`,
    );
    const experienceHighlights = Array.from(
      { length: 20 },
      (_, index) => `experience-${index}-${"e".repeat(280)}`,
    );
    const input = WriterWorkerInputSchema.parse({
      contractVersion: "1",
      runId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      role: "writer",
      requestKind: "cv",
      userRequested: true,
      position: {
        sourceId: "synthetic-boundary-job",
        url: "https://jobs.example.invalid/writer-boundary",
        title: "Synthetic Engineer",
        company: "Boundary Example Labs",
        jdSummary: "A wholly synthetic role used for a Writer boundary test.",
        score: 50,
      },
      candidateEvidence: {
        headline: "Synthetic boundary candidate",
        skills,
        experienceHighlights,
      },
      limits: {
        maxInputTokensPerStep: 20000,
        maxOutputTokensPerStep: 10000,
        maxTotalOutputTokens: 10000,
        maxResultBytes: 100000,
        maxSteps: 1,
        maxToolCalls: 1,
        maxWebSearches: 1,
        timeoutMs: 15000,
        maxCostUsd: 0,
      },
    });
    const output = WriterProposalSchema.parse(
      WriterRoleSpec.buildMockOutput(input),
    );

    expect(output.claimsUsed).toHaveLength(50);
    expect(output.claimsUsed).toEqual([...skills, ...experienceHighlights]);
    expect(output.markdown.length).toBeGreaterThan(12_000);
    expect(() => WriterRoleSpec.validateOutput?.(input, output)).not.toThrow();
    expect(() =>
      WriterRoleSpec.validateOutput?.(input, {
        ...output,
        documentKind: "cover_letter",
      }),
    ).toThrow();
    expect(() =>
      WriterRoleSpec.validateOutput?.(input, {
        ...output,
        claimsUsed: [...output.claimsUsed.slice(0, 49), "invented claim"],
      }),
    ).toThrow();
  });

  it("keeps Critic blind and CV-only at the contract boundary", async () => {
    const envelope = (await loadFixture(
      "prototype-inputs.synthetic.json",
    )) as FixtureEnvelope;
    const raw = {
      ...envelope.inputs.critic!,
      limits: envelope.sharedLimits,
    };
    expect(CriticWorkerInputSchema.parse(raw)).not.toHaveProperty("candidate");
    expect(() =>
      CriticWorkerInputSchema.parse({
        ...raw,
        document: { kind: "cover_letter", markdown: "Synthetic letter" },
      }),
    ).toThrow();
  });

  it("uses portable provider transports with full local role validation", async () => {
    const envelope = (await loadFixture(
      "prototype-inputs.synthetic.json",
    )) as FixtureEnvelope;
    const writerInput = WriterWorkerInputSchema.parse({
      ...envelope.inputs.writer!,
      limits: envelope.sharedLimits,
    });
    const writer = WriterProviderOutputSchema.parse(
      WriterRoleSpec.buildMockOutput(writerInput),
    );
    expect(WriterRoleSpec.parseProviderOutput?.(writer)).toEqual(writer);

    const criticInput = CriticWorkerInputSchema.parse({
      ...envelope.inputs.critic!,
      limits: envelope.sharedLimits,
    });
    const critic = CriticProviderOutputSchema.parse(
      CriticRoleSpec.buildMockOutput(criticInput),
    );
    expect(CriticRoleSpec.parseProviderOutput?.(critic)).toEqual(critic);

    const sentinelInput = SentinelWorkerInputSchema.parse({
      ...envelope.inputs.sentinel!,
      limits: envelope.sharedLimits,
    });
    const sentinel = SentinelProviderOutputSchema.parse(
      SentinelRoleSpec.buildMockOutput(sentinelInput),
    );
    expect(SentinelRoleSpec.parseProviderOutput?.(sentinel)).toEqual(sentinel);
  });

  it("enforces Captain phase and referenced-ID invariants outside the prompt", async () => {
    const envelope = (await loadFixture(
      "prototype-inputs.synthetic.json",
    )) as FixtureEnvelope;
    const input = CaptainWorkerInputSchema.parse({
      ...envelope.inputs.captain!,
      workPhase: "OFF",
      limits: envelope.sharedLimits,
    });
    const base = CaptainRoleSpec.buildMockOutput(input);

    expect(() =>
      CaptainRoleSpec.validateOutput?.(input, {
        ...base,
        decisions: [
          { action: "start", target: "scout", reason: "Invalid during OFF." },
        ],
      }),
    ).toThrow();
    expect(() =>
      CaptainRoleSpec.validateOutput?.(input, {
        ...base,
        decisions: [
          {
            action: "assign",
            target: input.tickets[0]!.id,
            agentId: input.activeAgents[0]!.id,
            reason: "Tickets must remain open while work is OFF.",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      CaptainRoleSpec.validateOutput?.(input, {
        ...base,
        decisions: [
          {
            action: "assign",
            target: input.tickets[0]!.id,
            agentId: "ghost-agent",
            reason: "Unknown assignee ID.",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      CaptainRoleSpec.validateOutput?.(input, {
        ...base,
        decisions: [
          { action: "stop", target: "ghost-agent", reason: "Unknown ID." },
        ],
      }),
    ).toThrow();
    expect(() => CaptainRoleSpec.validateOutput?.(input, base)).not.toThrow();
    const transport = CaptainProviderOutputSchema.parse({
      ...base,
      decisions: base.decisions.map((decision) => ({
        ...decision,
        agentId: decision.agentId ?? null,
      })),
    });
    expect(CaptainRoleSpec.parseProviderOutput?.(transport)).toEqual(base);
  });

  it("rejects unknown or duplicate Sentinel and Doctor references", async () => {
    const envelope = (await loadFixture(
      "prototype-inputs.synthetic.json",
    )) as FixtureEnvelope;
    const sentinel = SentinelWorkerInputSchema.parse({
      ...envelope.inputs.sentinel!,
      limits: envelope.sharedLimits,
    });
    const sentinelOutput = SentinelRoleSpec.buildMockOutput(sentinel);
    expect(() =>
      SentinelRoleSpec.validateOutput?.(sentinel, {
        ...sentinelOutput,
        orders: [
          {
            agentId: "ghost-agent",
            action: "stop",
            reason: "Unknown synthetic reference.",
          },
        ],
      }),
    ).toThrow();

    const doctor = DoctorWorkerInputSchema.parse({
      ...envelope.inputs.doctor!,
      limits: envelope.sharedLimits,
    });
    const doctorOutput = DoctorRoleSpec.buildMockOutput(doctor);
    expect(doctorOutput.interventions.map((item) => item.action)).toEqual([
      "refresh",
      "diagnose",
    ]);
    expect(() =>
      DoctorRoleSpec.validateOutput?.(doctor, {
        ...doctorOutput,
        interventions: [
          {
            sessionId: doctor.sessions[0]!.id,
            action: "observe",
            reason: "Contradicts mandatory TTL.",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      DoctorRoleSpec.validateOutput?.(doctor, {
        ...doctorOutput,
        interventions: doctorOutput.interventions.slice(1),
      }),
    ).toThrow();
    expect(() =>
      DoctorWorkerInputSchema.parse({
        ...doctor,
        sessions: [doctor.sessions[0], doctor.sessions[0]],
      }),
    ).toThrow();
  });
});
