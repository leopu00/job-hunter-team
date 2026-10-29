import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmLocalOwnerChange,
  probeLocalOwner,
  returnToLocalOwner,
  takeOverLocalOwner,
} from "./onboarding-runtime";
import { switchToOwnerLocalProfile } from "./local-profile";
import { localOwnerWays } from "./local-owner";

vi.mock("./onboarding-runtime", () => ({
  confirmLocalOwnerChange: vi.fn(),
  probeLocalOwner: vi.fn(),
  returnToLocalOwner: vi.fn(),
  takeOverLocalOwner: vi.fn(),
}));
vi.mock("./local-profile", () => ({ switchToOwnerLocalProfile: vi.fn() }));

const OWNER = "a".repeat(64);
const order: string[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  order.length = 0;
  vi.mocked(confirmLocalOwnerChange).mockImplementation(async (change) => { order.push(`confirm:${change}`); return `token-${change}`; });
  vi.mocked(returnToLocalOwner).mockImplementation(async (token) => { order.push(`return:${token}`); return OWNER; });
  vi.mocked(takeOverLocalOwner).mockImplementation(async (token) => { order.push(`take:${token}`); });
  vi.mocked(switchToOwnerLocalProfile).mockImplementation(() => { order.push("switch"); return { profileId: OWNER, displayName: "Ada" }; });
});

describe("the two ways out of another profile's runtime", () => {
  it("going back asks for its token when it runs, spends it once, then keeps the owner's id", async () => {
    const changed = vi.fn(() => { order.push("changed"); });
    await localOwnerWays(changed).returnToOwner();
    expect(order).toEqual(["confirm:return", "return:token-return", "switch", "changed"]);
    expect(switchToOwnerLocalProfile).toHaveBeenCalledWith(OWNER);
    expect(takeOverLocalOwner).not.toHaveBeenCalled();
  });

  it("a refusal of the native side keeps the renderer's profile as it is", async () => {
    vi.mocked(returnToLocalOwner).mockRejectedValue({ code: "local_owner_change_refused" });
    const changed = vi.fn();
    await expect(localOwnerWays(changed).returnToOwner()).rejects.toBeTruthy();
    expect(switchToOwnerLocalProfile).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });

  it("taking over asks for its own token each time and never reuses one", async () => {
    const ways = localOwnerWays(vi.fn());
    await ways.takeOver();
    await ways.takeOver();
    expect(order).toEqual(["confirm:takeover", "take:token-takeover", "confirm:takeover", "take:token-takeover"]);
    expect(confirmLocalOwnerChange).toHaveBeenCalledTimes(2);
    expect(returnToLocalOwner).not.toHaveBeenCalled();
  });

  it("no token is asked for when the confirmation itself is refused", async () => {
    vi.mocked(confirmLocalOwnerChange).mockRejectedValue({ code: "local_owner_change_refused" });
    await expect(localOwnerWays(vi.fn()).takeOver()).rejects.toBeTruthy();
    expect(takeOverLocalOwner).not.toHaveBeenCalled();
  });

  it("the probe is the native one", () => {
    expect(localOwnerWays(vi.fn()).probe).toBe(probeLocalOwner);
  });
});
