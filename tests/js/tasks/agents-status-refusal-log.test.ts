import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The box asks the site to take the agents' statuses with its heartbeat. A site older than the field
// refuses them with 403 on every attempt, every 30 minutes (22/10: 48 a day on a VPS): the box sends
// the heartbeat again alone and waits, and the warning is said once per start, not once per attempt.
let errors: string[];

beforeEach(() => {
  vi.resetModules();
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.join(" "));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const refusal = { status: 403, message: "PATCH /api/team-state → HTTP 403: Campi non scrivibili da source=token: agents_status" };

describe("the statuses' refusal in the daemon log", () => {
  it("is said once, however many times the site refuses", async () => {
    const { logAgentsStatusRefusal } = await import("../../../cli/src/lib/team-state-reconciler.js");
    expect(logAgentsStatusRefusal(refusal)).toBe(true);
    for (let i = 0; i < 47; i += 1) expect(logAgentsStatusRefusal({ ...refusal })).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("agents-status.refused-with-heartbeat");
    expect(errors[0]).toContain("403");
  });

  it("is said again for a different reason, and once for each", async () => {
    const { logAgentsStatusRefusal } = await import("../../../cli/src/lib/team-state-reconciler.js");
    expect(logAgentsStatusRefusal(refusal)).toBe(true);
    expect(logAgentsStatusRefusal({ status: 400, message: "agents_status map refused" })).toBe(true);
    expect(logAgentsStatusRefusal(refusal)).toBe(false);
    expect(errors).toHaveLength(2);
  });

  it("is said again after a restart of the daemon", async () => {
    const first = await import("../../../cli/src/lib/team-state-reconciler.js");
    first.logAgentsStatusRefusal(refusal);
    vi.resetModules();
    const second = await import("../../../cli/src/lib/team-state-reconciler.js");
    expect(second.logAgentsStatusRefusal(refusal)).toBe(true);
    expect(errors).toHaveLength(2);
  });
});
