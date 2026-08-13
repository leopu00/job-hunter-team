import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import PositionStateCell from "../../../web/app/components/PositionStateCell";
import {
  POSITION_STATUSES,
  PUBLIC_POSITION_STATES,
  PUBLIC_STATE_LABELS,
  TICKET_INDICATOR_LABELS,
  attachTicketIndicators,
  positionStatusesForFilters,
  publicApplicationState,
  publicPositionState,
} from "../../../web/lib/position-state";

const requireFromWeb = createRequire(
  resolve(__dirname, "../../../web/package.json"),
);
const { renderToStaticMarkup } = requireFromWeb("react-dom/server") as {
  renderToStaticMarkup: (node: React.ReactNode) => string;
};

const LOCALES = ["it", "en", "hu", "es", "de", "fr", "pt"] as const;

describe("O-89 canonical position state", () => {
  it("maps every database status and hides the internal review stage", () => {
    expect(POSITION_STATUSES).toHaveLength(9);
    expect(publicPositionState("writing")).toBe("preparing");
    expect(publicPositionState("review")).toBe("preparing");
    expect(publicApplicationState("review")).toBe("preparing");
    expect(publicPositionState("unexpected")).toBe("needs_attention");
    for (const status of POSITION_STATUSES) {
      expect(PUBLIC_POSITION_STATES).toContain(publicPositionState(status));
    }
  });

  it("has exact EN + 6 labels from the same map", () => {
    for (const state of PUBLIC_POSITION_STATES) {
      expect(Object.keys(PUBLIC_STATE_LABELS[state]).sort()).toEqual(
        [...LOCALES].sort(),
      );
    }
    expect(Object.keys(TICKET_INDICATOR_LABELS.pending).sort()).toEqual(
      [...LOCALES].sort(),
    );
    expect(Object.values(PUBLIC_STATE_LABELS.preparing)).not.toContain(
      "review",
    );
    expect(Object.values(PUBLIC_STATE_LABELS.preparing)).not.toContain(
      "In review",
    );
  });

  it("expands the public preparing filter to both technical states", () => {
    expect(positionStatusesForFilters(["preparing"])).toEqual([
      "writing",
      "review",
    ]);
  });

  it("renders state and pending ticket as two independent indicators", () => {
    const html = renderToStaticMarkup(
      PositionStateCell({
        status: "review",
        hasOpenTicket: true,
        locale: "en",
      }),
    );
    expect(html).toContain('data-position-state="preparing"');
    expect(html).toContain('data-ticket-indicator="pending"');
    expect(html).toContain("Preparing");
    expect(html).toContain("Ticket pending");
    expect(html).not.toContain(">review<");
  });

  it("models the known cloud shape: five positions and no tickets", () => {
    const statuses = ["new", "checked", "scored", "review", "ready"];
    const rows = attachTicketIndicators(
      statuses.map((status, index) => ({ legacy_id: index + 1, status })),
      [],
    );
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.ticket_indicator === "none")).toBe(true);
    expect(rows[3].public_state).toBe("preparing");
  });
});
