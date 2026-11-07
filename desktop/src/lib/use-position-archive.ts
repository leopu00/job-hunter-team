import { useCallback, useLayoutEffect, useReducer, useRef } from "react";
import { observePositionReads } from "./page-position-data";
import { pageData } from "./page-data";
import { usePageDataTopic } from "./use-page-data";

export function usePositionArchive(query: string) {
  const state = usePageDataTopic("positions");
  const [, changed] = useReducer((value: number) => value + 1, 0);
  const binding = `${state.scope}:${query}`;
  const read = useRef({ query: binding, waited: false, keys: new Set<string>() });
  if (read.current.query !== binding) read.current = { query: binding, waited: false, keys: new Set() };
  useLayoutEffect(() => {
    const retained = new Map<string, () => void>();
    const stop = observePositionReads((key, cached) => {
      if (!retained.has(key)) retained.set(key, pageData.subscribe(key, "positions", () => undefined));
      const added = !read.current.keys.has(key);
      read.current.keys.add(key);
      if (cached === false) read.current.waited = true;
      if (added) changed();
    });
    pageData.invalidate("positions");
    return () => { stop(); retained.forEach((off) => off()); };
  }, [binding]);
  const source = useCallback(() => read.current.keys.size === 0 ? undefined
    : read.current.waited ? "native" as const : "memory" as const, []);
  const current = useCallback(() => String(pageData.epoch()) === state.scope, [state.scope]);
  return { ...state, ...pageData.last("positions", read.current.keys), source, current };
}
