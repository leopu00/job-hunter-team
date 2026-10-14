import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { syntheticDetail, syntheticPosition } from "../test-support/existing-team-positions-fixture";
import { ReadonlyExistingPositions } from "./ReadonlyExistingPositions";

const queries = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
}));
vi.mock("../lib/existing-team-positions", () => ({
  readDesktopVpsPositions: queries.list,
  readDesktopVpsPosition: queries.detail,
}));

describe("ReadonlyExistingPositions", () => {
  beforeEach(() => { queries.list.mockReset(); queries.detail.mockReset(); });

  it("shows degraded state and uses only fixed list/filter/detail reads", async () => {
    const user = userEvent.setup();
    const page = (start: number) => Array.from({ length: 20 }, (_, index) => ({
      ...syntheticPosition,
      id: String(start + index),
      title: `Synthetic role ${start + index}`,
    }));
    queries.list.mockResolvedValueOnce({ source: "vps", data: page(101) })
      .mockResolvedValueOnce({ source: "vps", data: page(121) })
      .mockResolvedValueOnce({ source: "vps", data: page(201) });
    queries.detail.mockResolvedValue({
      source: "vps",
      data: { ...syntheticDetail, position: { ...syntheticDetail.position, title: "Synthetic role 201" } },
    });
    const onClose = vi.fn();
    render(<ReadonlyExistingPositions readiness={false} onClose={onClose} />);
    expect(await screen.findByText(/assistente non attivo/i)).toBeInTheDocument();
    expect(queries.list).toHaveBeenNthCalledWith(1, { limit: 20, offset: 0 });
    await user.click(screen.getByRole("button", { name: /successivo/i }));
    await waitFor(() => expect(queries.list).toHaveBeenLastCalledWith({ limit: 20, offset: 20 }));
    await user.type(screen.getByLabelText(/filtro annunci/i), "synthetic");
    await user.click(screen.getByRole("button", { name: /filtra/i }));
    await waitFor(() => expect(queries.list).toHaveBeenLastCalledWith({ q: "synthetic", limit: 20, offset: 0 }));
    await user.click(screen.getByRole("button", { name: /synthetic role 201/i }));
    expect(await screen.findByRole("heading", { name: "Synthetic role 201" })).toBeInTheDocument();
    expect(queries.detail).toHaveBeenCalledWith("201");
    expect(screen.getByRole("button", { name: /precedente/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /apply|write|recheck|ticket/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /torna alla configurazione/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows no records when the scoped query denies data", async () => {
    queries.list.mockResolvedValue({ source: "unavailable", code: "existing_team_runtime_target_changed" });
    render(<ReadonlyExistingPositions readiness onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/non disponibili/i);
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(queries.detail).not.toHaveBeenCalled();
  });
});
