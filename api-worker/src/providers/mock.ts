import { ScoutProposalBatchSchema, type Usage } from "../contract.js";
import { WorkerFault } from "../errors.js";
import type { StepReservation } from "../guardrails.js";
import type {
  ProviderExecution,
  ProviderExecutionContext,
  ScoutProviderAdapter,
} from "./provider.js";

export class MockScoutProvider implements ScoutProviderAdapter {
  async run(context: ProviderExecutionContext): Promise<ProviderExecution> {
    assertNotAborted(context.signal);

    const searchReservation = await startMockStep(
      context,
      `${context.systemPrompt}\n${context.prompt}`,
    );
    const search = await searchAcrossBrief(context);
    await finishMockStep(
      context,
      searchReservation,
      {
        inputTokens: 180,
        outputTokens: 30,
        totalTokens: 210,
      },
      "tool-calls",
    );

    assertNotAborted(context.signal);
    const readReservation = await startMockStep(
      context,
      JSON.stringify({ prompt: context.prompt, search: search.jobs }),
    );
    const jobs = [];
    for (const summary of search.jobs.slice(
      0,
      context.input.search.maxCandidates,
    )) {
      jobs.push(await context.tools.readJob({ sourceId: summary.sourceId }));
    }
    await finishMockStep(
      context,
      readReservation,
      {
        inputTokens: 260,
        outputTokens: 80,
        totalTokens: 340,
      },
      "tool-calls",
    );

    assertNotAborted(context.signal);
    const outputReservation = await startMockStep(
      context,
      JSON.stringify({ prompt: context.prompt, jobs }),
    );
    const output = ScoutProposalBatchSchema.parse({
      proposals: jobs.map((job) => ({
        ...job,
        matchedCriteria: matchedCriteria(context, job),
        disposition: "proposed",
        persistence: "none",
      })),
      exhausted: jobs.length === 0 && !search.truncated,
      notes:
        jobs.length === 0
          ? [
              search.truncated
                ? "The synthetic search stopped at its tool budget before every lane was checked."
                : "The synthetic catalog contained no matching fresh listings.",
            ]
          : [
              "Synthetic fixture proposals only; no database hand-off occurred.",
            ],
    });
    await finishMockStep(
      context,
      outputReservation,
      {
        inputTokens: 340,
        outputTokens: Math.max(40, jobs.length * 120),
        totalTokens: 340 + Math.max(40, jobs.length * 120),
      },
      "stop",
    );

    return {
      output,
      rawStopReason: jobs.length === 0 ? "no_candidates" : "stop",
    };
  }
}

async function searchAcrossBrief(context: ProviderExecutionContext) {
  const collected = new Map<
    string,
    Awaited<
      ReturnType<ProviderExecutionContext["tools"]["searchJobs"]>
    >["jobs"][number]
  >();
  const searchCallBudget = Math.max(
    1,
    context.input.limits.maxToolCalls - context.input.search.maxCandidates,
  );
  let searchCalls = 0;
  let truncated = false;

  outer: for (const targetRole of context.input.search.targetRoles) {
    for (const location of context.input.search.locations) {
      for (const workMode of context.input.search.workModes) {
        if (searchCalls >= searchCallBudget) {
          truncated = true;
          break outer;
        }
        const result = await context.tools.searchJobs({
          targetRole,
          location,
          workMode,
          postedWithinDays: context.input.search.postedWithinDays,
          limit: context.input.search.maxCandidates,
        });
        searchCalls += 1;
        for (const job of result.jobs) collected.set(job.sourceId, job);
        if (collected.size >= context.input.search.maxCandidates) break outer;
      }
    }
  }

  return { jobs: [...collected.values()], truncated };
}

async function finishMockStep(
  context: ProviderExecutionContext,
  reservation: StepReservation,
  usage: Usage,
  finishReason: string,
) {
  await context.recordStep({ reservation, usage, finishReason });
}

async function startMockStep(
  context: ProviderExecutionContext,
  serializedRequest: string,
): Promise<StepReservation> {
  const reservation = context.guard.beforeProviderStep(serializedRequest);
  await context.recordRequestStarted(reservation);
  return reservation;
}

function matchedCriteria(
  context: ProviderExecutionContext,
  job: {
    title: string;
    location: string;
    remoteType: string;
    requirements: string[];
  },
): string[] {
  const matches = [job.location, job.remoteType];
  const haystack = `${job.title} ${job.requirements.join(" ")}`.toLowerCase();
  for (const skill of context.input.search.skills) {
    if (haystack.includes(skill.toLowerCase())) matches.push(skill);
  }
  return [...new Set(matches)].slice(0, 20);
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new WorkerFault("TIMEOUT", {
      retryable: true,
      limit: "timeout_ms",
    });
  }
}
