import { beforeEach, describe, expect, it, vi } from "vitest";

const world = vi.hoisted(() => ({
  users: [] as Array<{ id: string; app_metadata: { provider: string } } | null>,
  signIn: vi.fn(),
}));
vi.mock("../lib/supabase", async () => {
  class LoginError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return {
    LoginError,
    signInWithGoogle: (...a: unknown[]) => world.signIn(...a),
    supabase: {
      auth: {
        getUser: async () => {
          const user = world.users.length > 1 ? world.users.shift() : world.users[0];
          return { data: { user: user ?? null } };
        },
      },
    },
  };
});

import { LoginError } from "../lib/supabase";
import { canReauth, currentUserId, startReauth } from "./reauth";

const target = { kind: "apply-authorise" as const, target: "7" };
const A = { id: "11111111-1111-4111-8111-111111111111", app_metadata: { provider: "google" } };
const B = { id: "99999999-9999-4999-8999-999999999999", app_metadata: { provider: "google" } };
const GITHUB = { id: A.id, app_metadata: { provider: "github" } };

describe("signing in again in the desktop", () => {
  beforeEach(() => {
    world.signIn.mockReset();
    world.users = [A];
  });

  it("is the app's own Google sign-in, and ends «done» so the button can go on without a reload", async () => {
    world.signIn.mockResolvedValue(undefined);
    await expect(startReauth(target)).resolves.toBe("done");
    expect(world.signIn).toHaveBeenCalledTimes(1);
  });

  it("another account at the end of the sign-in is «changed»: nothing resumes", async () => {
    world.signIn.mockResolvedValue(undefined);
    world.users = [A, B];
    await expect(startReauth(target)).resolves.toBe("changed");
    // and an account that cannot be read afterwards is not «the same» either
    world.users = [A, null];
    await expect(startReauth(target)).resolves.toBe("changed");
  });

  it("only a Google account can sign in again here: any other gets no button and no sign-in", async () => {
    world.users = [GITHUB];
    await expect(canReauth()).resolves.toBe(false);
    await expect(startReauth(target)).resolves.toBe("unsupported");
    world.users = [{ id: A.id, app_metadata: { provider: "email" } }];
    await expect(canReauth()).resolves.toBe(false);
    world.users = [null];
    await expect(canReauth()).resolves.toBe(false);
    await expect(startReauth(target)).resolves.toBe("unsupported");
    expect(world.signIn).not.toHaveBeenCalled();
    world.users = [A];
    await expect(canReauth()).resolves.toBe(true);
    await expect(currentUserId()).resolves.toBe(A.id);
  });

  it("a cancelled sign-in is «cancelled»: nothing resumes", async () => {
    world.signIn.mockRejectedValue(new LoginError("cancelled" as never));
    await expect(startReauth(target)).resolves.toBe("cancelled");
  });

  it("any other failure is «failed», never «done»", async () => {
    world.signIn.mockRejectedValue(new LoginError("exchange-failed" as never));
    await expect(startReauth(target)).resolves.toBe("failed");
    world.signIn.mockRejectedValue(new Error("boom"));
    await expect(startReauth(target)).resolves.toBe("failed");
  });
});
