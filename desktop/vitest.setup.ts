import "@testing-library/jest-dom/vitest";

// jsdom has no ResizeObserver; the web components reused by the dashboard
// measure their rows with it.
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Node 25 turns on its own Web Storage: `localStorage` and `sessionStorage`
// become Node getters on globalThis, and without --localstorage-file they
// return an empty plain object (no length, no setItem). Vitest leaves those
// globals alone, so tests saw Node's object instead of jsdom's Storage. Point
// them back at jsdom's. On Node 24 (CI) they already are, and this is a no-op.
const dom = (globalThis as { jsdom?: { window: Window } }).jsdom;
if (dom) {
  for (const key of ["localStorage", "sessionStorage"] as const) {
    if (globalThis[key] !== dom.window[key]) {
      Object.defineProperty(globalThis, key, {
        configurable: true,
        enumerable: true,
        get: () => dom.window[key],
      });
    }
  }
}
