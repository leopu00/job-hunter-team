import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import UnseenDot from "@/app/components/UnseenDot";
import { ReadOnlyActionsProvider } from "@/lib/read-only-actions";

// The «NEW» tag marks a position this computer has not opened. Read only, on a
// team's VPS that does not record what was opened, every row would be NEW.
describe("UnseenDot", () => {
  it("marks an unseen position NEW, as the web does", async () => {
    render(<UnseenDot id="unseen-1" label="Not seen yet" />);
    expect(await screen.findByText("NEW")).toBeInTheDocument();
  });

  it("marks nothing on an existing team that is only read", async () => {
    render(
      <ReadOnlyActionsProvider value={{ readOnly: true, reason: "Read only" }}>
        <UnseenDot id="unseen-2" label="Not seen yet" />
      </ReadOnlyActionsProvider>,
    );
    await act(async () => {});
    expect(screen.queryByText("NEW")).not.toBeInTheDocument();
  });

  it("still leaves a position the server knows as seen unmarked", async () => {
    render(<UnseenDot id="unseen-3" label="Not seen yet" initialSeen />);
    await act(async () => {});
    expect(screen.queryByText("NEW")).not.toBeInTheDocument();
  });
});
