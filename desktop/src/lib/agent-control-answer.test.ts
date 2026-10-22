import { beforeEach, describe, expect, it, vi } from "vitest";

// JHT-T38: the answer to an agent's question from the agents' panel. Only the ids of the
// question and of one option reach the native side, with the list's target, as an action.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);

import { answerQuestion } from "./agent-control";

const QUESTION = "aq:scrittore:1790000000-ab12cd";

describe("answerQuestion", () => {
  beforeEach(() => {
    native.invoke.mockReset();
    native.invoke.mockResolvedValue({ ok: true, data: { result: "answered" } });
  });

  it("sends the ids, the target and the confirmation, and keeps only a closed result", async () => {
    const done = await answerQuestion(QUESTION, "breve", "T1");
    expect(native.invoke).toHaveBeenCalledWith("agent_control", { request: { op: "answer", question: QUESTION, choice: "breve", target: "T1", confirmed: true } });
    expect(done).toMatchObject({ ok: true, value: "answered" });
    native.invoke.mockResolvedValue({ ok: true, data: { result: "CV breve" } });
    expect(await answerQuestion(QUESTION, "breve", "T1")).toMatchObject({ ok: false, code: "agent_control_unanswered" });
    native.invoke.mockResolvedValue({ ok: false, error: "question_unknown" });
    expect(await answerQuestion(QUESTION, "breve", "T1")).toMatchObject({ ok: false, code: "question_unknown" });
  });

  it("sends nothing when an id is out of shape", async () => {
    for (const [question, choice] of [[QUESTION, "CV breve"], [QUESTION, "--json"], ["ans:" + QUESTION, "breve"], [`${QUESTION}\n`, "breve"], [QUESTION, "_altro"]]) {
      expect(await answerQuestion(question, choice, "T1"), `${question} ${choice}`).toMatchObject({ ok: false, code: "agent_control_invalid" });
    }
    expect(native.invoke).not.toHaveBeenCalled();
  });
});
