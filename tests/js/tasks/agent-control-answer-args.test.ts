import { describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript module of the CLI
import { agentControlArgv } from "../../../cli/src/lib/agent-control-args.js";

// JHT-T38: the answer to an agent's structured question in `jht agent-control`. The question's id
// and one option's id, in the shapes agent_questions.py gives them; never text, never a channel.
describe("agent-control: the answer to an agent's question", () => {
  const QUESTION = "aq:scrittore:1790000000-ab12cd";

  it("passes on the question's id and one option's id", () => {
    expect(agentControlArgv(["answer", QUESTION, "breve"])).toEqual(["answer", QUESTION, "breve"]);
    expect(agentControlArgv(["answer", QUESTION, "_rinvia"])).toEqual(["answer", QUESTION, "_rinvia"]);
    expect(agentControlArgv(["answer", "aq:scout-1:1-a", "cv_2"])).toEqual(["answer", "aq:scout-1:1-a", "cv_2"]);
  });

  it("refuses every other shape", () => {
    const bad = [
      ["answer"],
      ["answer", QUESTION],
      ["answer", QUESTION, "breve", "lungo"],
      ["answer", QUESTION, "CV breve"],
      ["answer", QUESTION, "Breve"],
      ["answer", QUESTION, "--json"],
      ["answer", QUESTION, "_altro"],
      ["answer", QUESTION, "x".repeat(25)],
      ["answer", QUESTION, "breve\n"],
      ["answer", `${QUESTION}\n`, "breve"],
      ["answer", "ans:" + QUESTION, "breve"],
      ["answer", "aq:Scout:1-a", "breve"],
      ["answer", "aq:scout:1-a;id", "breve"],
      ["answer", "$(id)", "breve"],
      ["answer", QUESTION, "breve; rm -rf /"],
    ];
    for (const args of bad) expect(agentControlArgv(args), JSON.stringify(args)).toBeNull();
  });
});
