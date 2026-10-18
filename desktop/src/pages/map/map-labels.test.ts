import { describe, expect, it } from "vitest";
import { groupLabel } from "@/lib/globe-label-placement";

describe("groupLabel", () => {
  it("writes nothing for one position, the count for a group", () => {
    expect(groupLabel(1, false, "remote")).toBe("");
    expect(groupLabel(1, true, "remote")).toBe("");
    expect(groupLabel(9, false, "remote")).toBe("9");
  });

  it("writes «N remote» for a group of remote positions, without a separator that splits it in two", () => {
    expect(groupLabel(2, true, "remote")).toBe("2 remote");
    expect(groupLabel(3, true, "da remoto")).toBe("3 da remoto");
    expect(groupLabel(4, true, "remote")).not.toContain("·");
  });
});
