import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import TeamPage from "./index";

vi.mock("@/app/(protected)/team/loading", () => ({ default: () => <p>Team loading</p> }));
vi.mock("@/app/(protected)/team/page", () => ({ default: () => <p>Existing team</p> }));
vi.mock("../../shell/server-page", () => ({ default: () => <p>Existing team</p> }));
afterEach(() => { cleanup(); localStorage.clear(); });

// Out of 0.4.0 (the operator's decision): the Team page opens straight on the team, with no entry to the assisted browser.
for (const lang of ["en", "it"]) {
  it(`the Team page has no button for the assisted browser (${lang})`, () => {
    localStorage.setItem("jht-lang", lang);
    render(<TeamPage params={{}} search={new URLSearchParams()} />);
    expect(screen.getByText("Existing team")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /assisted browser|browser assistito/i })).toBeNull();
    expect(document.querySelector(".closer-desktop-entry-row")).toBeNull();
  });
}
