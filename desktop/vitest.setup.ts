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
