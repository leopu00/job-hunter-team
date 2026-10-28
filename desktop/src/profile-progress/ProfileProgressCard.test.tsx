import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";
import { ProfileProgressCard } from "./ProfileProgressCard";
import { PROFILE_FIELD_KEYS, type ProfileProgress } from "./contract";
import { PROFILE_PROGRESS_TEXT } from "./profile-progress.i18n";

function ready(filled: number, over: Partial<ProfileProgress> = {}): ProfileProgress {
  return {
    state: "ready",
    filled,
    total: 8,
    fields: PROFILE_FIELD_KEYS.map((key, index) => ({
      key,
      label: PROFILE_PROGRESS_TEXT.it.fields[key],
      value: key === "email" ? null : index < filled ? `value-${key}` : null,
      done: index < filled,
    })),
    ...over,
  };
}

afterEach(() => {
  cleanup();
  document.cookie = "NEXT_LOCALE=it; path=/";
});

describe("the profile card", () => {
  it("has a real bar of filled over total, a line that says it, and a row per field", () => {
    render(<ProfileProgressCard progress={ready(3)} />);
    const bar = screen.getByTestId("profile-progress-bar") as HTMLProgressElement;
    expect(bar.value).toBe(3);
    expect(bar.max).toBe(8);
    expect(screen.getByTestId("profile-progress-counter")).toHaveTextContent("3 di 8 campi");
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(8);
    expect(rows.map((row) => row.getAttribute("data-field"))).toEqual([...PROFILE_FIELD_KEYS]);
    expect(rows.map((row) => row.getAttribute("data-done"))).toEqual(["true", "true", "true", "false", "false", "false", "false", "false"]);
    expect(within(rows[0]).getByText("✓")).toBeInTheDocument();
    expect(within(rows[3]).getByText("○")).toBeInTheDocument();
    expect(within(rows[0]).getByText("value-name")).toBeInTheDocument();
  });

  it("says in words, for a screen reader, what each tick means", () => {
    render(<ProfileProgressCard progress={ready(1)} />);
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByText("compilato")).toBeInTheDocument();
    expect(within(rows[1]).getByText("da compilare")).toBeInTheDocument();
  });

  it("shows the email only as done or not, never a text", () => {
    render(<ProfileProgressCard progress={ready(2, { fields: ready(2).fields.map((field) => (field.key === "email" ? { ...field, value: "someone@example.org" } : field)) })} />);
    // a value that reached the card is shown as given: the guard is where the reply is read (contract.test.ts)
    expect(screen.getByText("someone@example.org")).toBeInTheDocument();
  });

  it("shows what the agent wrote as plain text: no HTML, no markdown, no link to click", () => {
    const hostile = ["<b>bold</b><img src=x onerror=alert(1)>", "[click](https://example.invalid/x)", "https://example.invalid/page", "**strong** _em_ `code`"];
    const base = ready(8);
    // the hostile texts go where the agent's words go: name, role, location and level (the email never has a text)
    const named = base.fields.map((field) => {
      const slot = ["name", "target_role", "location", "seniority_target"].indexOf(field.key);
      return slot >= 0 ? { ...field, value: hostile[slot] } : field;
    });
    const { container } = render(<ProfileProgressCard progress={{ ...base, fields: named }} />);
    // the characters are on the screen as typed ...
    for (const text of hostile) expect(container.textContent).toContain(text);
    // ... and none of them became an element
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b, strong, em, code")).toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("says when the profile is complete", () => {
    render(<ProfileProgressCard progress={ready(8)} />);
    expect(screen.getByTestId("profile-progress-counter")).toHaveTextContent("Profilo completo");
    expect((screen.getByTestId("profile-progress-bar") as HTMLProgressElement).value).toBe(8);
  });

  it("is a line while it reads, and a calm sentence — not an error — when there is no profile to read yet", () => {
    const view = render(<ProfileProgressCard progress={{ state: "loading", fields: [], filled: 0, total: 8 }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Leggo il profilo…");
    expect(screen.queryByTestId("profile-progress-bar")).toBeNull();
    view.rerender(<ProfileProgressCard progress={{ state: "unavailable", fields: [], filled: 0, total: 8 }} />);
    expect(screen.getByTestId("profile-progress-unavailable")).toHaveTextContent("Il profilo comparirà qui");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByTestId("profile-progress-bar")).toBeNull();
  });

  it("is in every language, with every field named and nothing left empty", () => {
    for (const locale of locales) {
      document.cookie = `NEXT_LOCALE=${locale}; path=/`;
      const text = PROFILE_PROGRESS_TEXT[locale];
      for (const [key, value] of Object.entries(text)) {
        if (key !== "fields") expect((value as string).trim().length, `${locale}.${key}`).toBeGreaterThan(2);
      }
      for (const key of PROFILE_FIELD_KEYS) expect(text.fields[key].trim().length, `${locale}.${key}`).toBeGreaterThan(1);
      render(<ProfileProgressCard progress={ready(2, { fields: ready(2).fields.map((field) => ({ ...field, label: text.fields[field.key] })) })} />);
      expect(screen.getByRole("heading", { name: text.title })).toBeInTheDocument();
      expect(screen.getByTestId("profile-progress-counter")).toHaveTextContent(text.counter.replace("{filled}", "2").replace("{total}", "8"));
      cleanup();
    }
  });
});
