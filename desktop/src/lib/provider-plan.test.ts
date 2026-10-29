import { afterEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);

import { declarePlan, loadPlans, parsePlanChoice, parsePlanOption } from "./provider-plan";

const plan = (id: string, label = id, price = "20 $/month") => ({ id, label, price });
const choice = (overrides: Record<string, unknown> = {}) => ({
  provider: "openai", declared: null, plans: [plan("plus", "Plus"), plan("pro", "Pro", "100 $/month")], suggested: null, ...overrides,
});
afterEach(() => { native.invoke.mockReset(); native.isTauri.mockReturnValue(true); });

describe("provider-plan", () => {
  it("reads the plans of the host being set up, or of the saved one", async () => {
    native.invoke.mockResolvedValue(choice({ suggested: "pro" }));
    const host = { kind: "local" } as const;
    expect((await loadPlans(host)).suggested).toBe("pro");
    expect(native.invoke).toHaveBeenLastCalledWith("onboarding_plans", { host });
    await loadPlans(null);
    expect(native.invoke).toHaveBeenLastCalledWith("onboarding_plans", { host: null });
  });

  it("declares exactly the plan chosen and refuses another one in the answer", async () => {
    native.invoke.mockResolvedValue(plan("plus", "Plus", ""));
    expect(await declarePlan({ kind: "local" }, "plus")).toEqual(plan("plus", "Plus", ""));
    expect(native.invoke).toHaveBeenLastCalledWith("onboarding_plan_declare", { host: { kind: "local" }, plan: "plus" });
    native.invoke.mockResolvedValue(plan("pro", "Pro", ""));
    await expect(declarePlan(null, "plus")).rejects.toEqual({ code: "plan_declare_failed" });
  });

  it("drops a suggestion that is not one of the plans, and refuses an answer it cannot rely on", () => {
    expect(parsePlanChoice(choice({ suggested: "pro-max" }))?.suggested).toBeNull();
    expect(parsePlanChoice(choice({ suggested: "pro" }))?.suggested).toBe("pro");
    for (const bad of [
      null, [], "plans", choice({ plans: [] }), choice({ plans: [plan("Plus")] }), choice({ plans: [plan("plus", "")] }),
      choice({ plans: [plan("plus", "Pl\u0007us")] }), choice({ plans: [plan("plus", "x".repeat(49))] }),
      choice({ declared: { id: "", label: "x" } }), choice({ provider: "" }),
      choice({ plans: Array.from({ length: 13 }, (_, i) => plan(`p${i}`)) }),
    ]) expect(parsePlanChoice(bad), JSON.stringify(bad)).toBeNull();
    expect(parsePlanOption({ id: "pro-max", label: "Pro 20x" })).toBeNull();
  });

  it("rejects an unreadable answer as plans_unavailable, and outside the desktop app", async () => {
    native.invoke.mockResolvedValue({ ok: false });
    await expect(loadPlans(null)).rejects.toEqual({ code: "plans_unavailable" });
    native.isTauri.mockReturnValue(false);
    await expect(loadPlans(null)).rejects.toEqual({ code: "desktop_only" });
    await expect(declarePlan(null, "plus")).rejects.toEqual({ code: "desktop_only" });
  });
});
