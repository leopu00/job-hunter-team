import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePathname, useRouter, useSearchParams } from "../web-shims/next-navigation";
import { currentLocation, matchRoute, navigate, parseHash, REFRESH_EVENT, useRefresh } from "./router";

describe("parseHash", () => {
  it("reads a web path and its query out of the hash", () => {
    expect(parseHash("#/positions/42?tab=cv")).toEqual({ path: "/positions/42", search: "?tab=cv" });
    expect(parseHash("")).toEqual({ path: "/", search: "" });
    expect(parseHash("#positions/")).toEqual({ path: "/positions", search: "" });
  });
});

describe("matchRoute", () => {
  const routes = [{ path: "/positions" }, { path: "/positions/:id" }];
  it("fills the :params and keeps list and detail apart", () => {
    expect(matchRoute(routes, "/positions")?.route.path).toBe("/positions");
    expect(matchRoute(routes, "/positions/a%20b")).toEqual({ route: routes[1], params: { id: "a b" } });
    expect(matchRoute(routes, "/positions/1/cv")).toBeNull();
  });
});

describe("next/navigation stand-in", () => {
  function Probe() {
    const router = useRouter();
    return (
      <div>
        <span data-testid="path">{usePathname()}</span>
        <span data-testid="q">{useSearchParams().get("q") ?? ""}</span>
        <button onClick={() => router.push("/map?q=roma")}>go</button>
      </div>
    );
  }

  it("moves the router and re-renders the web hooks", () => {
    navigate("/dashboard", { replace: true });
    render(<Probe />);
    expect(screen.getByTestId("path")).toHaveTextContent("/dashboard");
    act(() => screen.getByText("go").click());
    expect(screen.getByTestId("path")).toHaveTextContent("/map");
    expect(screen.getByTestId("q")).toHaveTextContent("roma");
    expect(window.location.hash).toBe("#/map?q=roma");
  });

  it("follows Back (hashchange)", () => {
    navigate("/dashboard", { replace: true });
    navigate("/swipe");
    act(() => {
      window.history.replaceState(null, "", "#/profile");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(currentLocation().path).toBe("/profile");
  });

  it("router.refresh() reaches the page's useRefresh", () => {
    const onRefresh = vi.fn();
    function Page() {
      useRefresh(onRefresh);
      const router = useRouter();
      return <button onClick={router.refresh}>refresh</button>;
    }
    render(<Page />);
    act(() => screen.getByText("refresh").click());
    window.dispatchEvent(new CustomEvent(REFRESH_EVENT));
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });
});
