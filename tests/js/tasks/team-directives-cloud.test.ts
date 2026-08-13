import { describe, expect, it, vi } from "vitest";
import {
  readTeamDirectivesForUser,
  validateDirectiveMutationResult,
} from "@/lib/team-directives-cloud";

describe("team directives cloud tenant seam", () => {
  it("filters by authenticated user and cannot return another tenant", async () => {
    const rows = [{ id: 1, body: "A", user_id: "A" }];
    const eq = vi.fn(() => ({
      order: vi.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => void) =>
        resolve({ data: rows, error: null }),
    }));
    const supabase = {
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq })) })),
    };
    const result = await readTeamDirectivesForUser(supabase, "A");
    expect(eq).toHaveBeenCalledWith("user_id", "A");
    expect(result.data).toEqual(rows);
    expect(result.data).not.toContainEqual({ id: 2, body: "B", user_id: "B" });
  });

  it("propagates auth/query failure without inventing local data", async () => {
    const eq = vi.fn(() => ({
      order: vi.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => void) =>
        resolve({ data: null, error: new Error("auth") }),
    }));
    const result = await readTeamDirectivesForUser(
      { from: () => ({ select: () => ({ eq }) }) },
      "A",
    );
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it("accepts only the RPC success shape", () => {
    expect(
      validateDirectiveMutationResult({ id: 7, status: "queued" }),
    ).toEqual({
      id: 7,
      status: "queued",
    });
    expect(validateDirectiveMutationResult(null)).toBeNull();
    expect(validateDirectiveMutationResult({ id: 7 })).toBeNull();
    expect(
      validateDirectiveMutationResult({ id: "7", status: "queued" }),
    ).toBeNull();
    expect(
      validateDirectiveMutationResult({ id: 7, status: "error" }),
    ).toBeNull();
  });
});
