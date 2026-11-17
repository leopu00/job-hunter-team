import { createRequire } from "node:module";
import path from "node:path";
import { expect, vi } from "vitest";

const webRequire = createRequire(path.resolve(__dirname, "../../../web/package.json"));
export const { createElement, act } = webRequire("react");
const { createRoot } = webRequire("react-dom/client");
export type Answer = Response | Error;
export type WriteCall = { key: string; body?: string };

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Route replies repeat the last answer; callers keep their own call records. */
export function createRouteReplies(record: (call: WriteCall) => void) {
  const routes: Record<string, Answer[]> = {};
  function route(key: string, ...answers: Answer[]) {
    routes[key] = answers;
  }
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input).split("?")[0]}`;
    record({ key, body: typeof init?.body === "string" ? init.body : undefined });
    const list = routes[key];
    if (!list?.length) return json({}, 404);
    const next = list.length > 1 ? list.shift()! : list[0];
    if (next instanceof Error) throw next;
    return next.clone();
  });
  return { route, fetch };
}

export async function settle(ticks: number) {
  for (let i = 0; i < ticks; i += 1) {
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
  }
}

export async function type(el: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export function alerts(scope: ParentNode) {
  return [...scope.querySelectorAll('[role="alert"]')].map((a) => a.textContent);
}

function matches(label: RegExp, button: HTMLButtonElement, aria: boolean) {
  return label.test(button.textContent ?? "") ||
    (aria && label.test(button.getAttribute("aria-label") ?? ""));
}

export function firstButton(container: ParentNode, label: RegExp, aria = false) {
  return [...container.querySelectorAll("button")].find((b) => matches(label, b, aria));
}

export function lastButton(container: ParentNode, label: RegExp, aria = false) {
  return [...container.querySelectorAll("button")].filter((b) => matches(label, b, aria)).at(-1);
}

/** Each caller creates a fresh root/container in its existing beforeEach. */
export function createWriteFailureHarness(ticks: number) {
  let container: HTMLDivElement;
  let root: { render(el: unknown): void; unmount(): void };

  function setup() {
    document.cookie = "NEXT_LOCALE=en";
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }

  function cleanup() {
    act(() => root.unmount());
    container.remove();
  }

  async function open(element: unknown) {
    await act(async () => {
      root.render(element);
    });
    await settle(ticks);
  }

  async function click(el: Element | null | undefined, message = "element not found") {
    expect(el, message).toBeTruthy();
    await act(async () => {
      el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle(ticks);
  }

  return {
    setup, cleanup, open, click,
    settle: () => settle(ticks),
    get container() { return container; },
    get root() { return root; },
  };
}
