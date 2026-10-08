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

// jsdom implements window.scrollTo as a "not implemented" console error; the
// shell's router scrolls to the top on every navigation.
// (Guarded: a test may run in the node environment, without window.)
if (typeof window !== "undefined") window.scrollTo = () => undefined;

// The desktop speaks the system language when the person chose none
// (src/lib/app-locale.ts). jsdom reports en-US; the tests run as the Italian
// system the app was written on, and a test that wants another language
// says so.
if (dom) {
  for (const [key, value] of [["language", "it-IT"], ["languages", ["it-IT", "it"]]] as const) {
    Object.defineProperty(dom.window.navigator, key, { configurable: true, get: () => value });
  }
}
