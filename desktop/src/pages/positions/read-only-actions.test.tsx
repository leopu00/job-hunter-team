import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReadOnlyActionsProvider } from "@/lib/read-only-actions";
import { ApplyRequestView } from "@/app/(protected)/positions/[id]/ApplyRequestButton";
import { CvDownloadButton } from "@/app/(protected)/positions/[id]/CvDownloadButton";
import { CoverLetterRequestButton } from "@/app/(protected)/positions/[id]/CoverLetterRequestButton";
import { ExcludeButton } from "@/app/(protected)/positions/[id]/ExcludeButton";
import { FeedbackButtons } from "@/app/(protected)/positions/[id]/FeedbackButtons";
import { GeocodeRequestButton } from "@/app/(protected)/positions/[id]/GeocodeRequestButton";
import { RecheckButton } from "@/app/(protected)/positions/[id]/RecheckButton";
import { RescoreRequestButton } from "@/app/(protected)/positions/[id]/RescoreRequestButton";
import { TicketPanel } from "@/app/(protected)/positions/[id]/TicketPanel";
import UserNote from "@/app/(protected)/positions/[id]/UserNote";
import { WriteRequestButton } from "@/app/(protected)/positions/[id]/WriteRequestButton";

// Every web control that writes, one by one: under the read-only provider it is
// on screen and disabled with the reason; without it, the web's own behaviour
// is untouched. (The page-level run is existing-team-readonly.test.tsx.)
vi.mock("../../lib/supabase", () => ({ supabase: {}, supabaseConfigured: true, signOut: vi.fn() }));

const REASON = "Solo lettura: assistente non attivo";
const t = (key: string) => key;

const CASES: Array<[string, () => ReactElement]> = [
  ["apply request (available)", () => <ApplyRequestView state={{ kind: "available" }} t={t} />],
  ["apply request (authorised, to withdraw)", () => <ApplyRequestView state={{ kind: "authorised", at: null }} t={t} />],
  [
    "CV download (asks the team for the file)",
    () => <CvDownloadButton fileName="synthetic.pdf" cloudMode color="var(--color-green)" labels={{ idle: "CV", preparing: "…", error: "!" }} />,
  ],
  ["user note", () => <UserNote legacyId={1} initialNote="synthetic note" />],
  ["geocode", () => <GeocodeRequestButton legacyId={1} initialRequested={false} alreadyGeocoded={false} />],
  ["recheck", () => <RecheckButton legacyId={1} initialRequested={false} lastOpenCheck={null} />],
  ["rescore", () => <RescoreRequestButton legacyId={1} initialStatus={null} />],
  ["write the CV", () => <WriteRequestButton legacyId={1} initialRequested={false} />],
  ["write the cover letter", () => <CoverLetterRequestButton legacyId={1} initialRequested={false} />],
  ["exclude", () => <ExcludeButton legacyId={1} status="scored" initialReason={null} />],
  ["exclude, undo", () => <ExcludeButton legacyId={1} status="excluded" initialReason="other" />],
  ["new ticket", () => <TicketPanel legacyId={1} tickets={[]} />],
  ["judgments and mark-applied", () => <FeedbackButtons legacyId={1} initialVerdict={null} />],
  [
    "judgments, applied and outcome",
    () => (
      <FeedbackButtons
        legacyId={1}
        initialVerdict="review_ok"
        initialApplied
        initialAppliedAt="2026-01-02T03:04:05Z"
        initialOutcome="rejected"
        initialRejectionReason="other"
        initialRejectionNote="synthetic"
      />
    ),
  ],
];

const controls = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement & { disabled: boolean }>("button, textarea, select, input")];

afterEach(cleanup);

describe("web controls under the read-only provider", () => {
  it.each(CASES)("%s stays on screen, disabled, with the reason", (_name, element) => {
    const { container } = render(
      <ReadOnlyActionsProvider value={{ readOnly: true, reason: REASON }}>{element()}</ReadOnlyActionsProvider>,
    );
    const all = controls(container);
    expect(all.length).toBeGreaterThan(0);
    for (const control of all) expect(control).toBeDisabled();
    // The reason is on the control itself, not only in a banner elsewhere.
    expect(all.some((control) => control.getAttribute("title") === REASON)).toBe(true);
  });

  it.each(CASES)("%s keeps working outside it", (_name, element) => {
    const { container } = render(element());
    const enabled = controls(container).filter((control) => !control.disabled);
    expect(enabled.length).toBeGreaterThan(0);
    expect(container.querySelector(`[title="${REASON}"]`)).toBeNull();
  });
});
