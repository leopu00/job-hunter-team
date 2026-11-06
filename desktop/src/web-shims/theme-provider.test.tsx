import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DarkModeToggle, useTheme } from "@/app/theme-provider";

function Probe() {
  return <span data-testid="theme">{useTheme().resolvedTheme}</span>;
}

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

describe("the web's theme on the desktop (the Map's globe, the charts that ask for it)", () => {
  it("is the base the desktop's theme wrote on the page, and follows it when another theme is chosen", async () => {
    document.documentElement.dataset.theme = "light";
    render(<Probe />);
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    await act(async () => {
      document.documentElement.dataset.theme = "dark";
      await Promise.resolve();
    });
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    await act(async () => {
      document.documentElement.dataset.theme = "light";
      await Promise.resolve();
    });
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
  });

  it("is dark when the page says nothing, and the web's own light/dark switch is not shown", () => {
    const { container } = render(
      <>
        <Probe />
        <DarkModeToggle />
      </>,
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});
