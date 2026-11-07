import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { dataShown } from "./page-timing";
import { pageData } from "./page-data";
import type { PageDataSnapshot, PageDataTopic } from "./page-data-store";

export function usePageData<T>(topic: PageDataTopic, operation: string, params: unknown, load: () => Promise<T>, measure = false, enabled = true) {
  const epoch = useSyncExternalStore(pageData.subscribeContext, pageData.epoch, pageData.epoch);
  const key = pageData.key(topic, operation, params);
  const binding = useRef({ key, read: load });
  if (binding.current.key !== key) binding.current = { key, read: load };
  binding.current.read = load;
  const request = binding.current;
  const start = useCallback(() => request.read(), [request]);
  const subscribe = useCallback((listener: () => void) => enabled ? pageData.subscribe(key, topic, listener) : () => undefined, [key, topic, enabled]);
  const snapshot = useCallback(() => pageData.snapshot<T>(key, topic), [key, topic]);
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  const first = useRef({ key, cached: value.data !== undefined, shown: false });
  if (first.current.key !== key) first.current = { key, cached: value.data !== undefined, shown: false };
  useEffect(() => { if (enabled) void pageData.revalidate(key, topic, start); }, [key, topic, start, epoch, enabled]);
  useEffect(() => {
    if (!enabled || !measure || value.data === undefined || first.current.shown) return;
    first.current.shown = true;
    dataShown(first.current.cached || value.fromDisk ? "memory" : "native");
  }, [key, value.data, measure, enabled]);
  const refresh = useCallback(() => pageData.invalidate(topic), [topic]);
  return { ...value, error: value.error ?? value.diskError, errorAt: value.error ? value.errorAt : value.diskErrorAt, refresh };
}

export function usePageDataTopic(topic: PageDataTopic) {
  const subscribe = useCallback((listener: () => void) => pageData.subscribeTopic(topic, listener), [topic]);
  const revision = useCallback(() => pageData.revision(topic), [topic]);
  const version = useSyncExternalStore(subscribe, revision, revision);
  const epoch = useSyncExternalStore(pageData.subscribeContext, pageData.epoch, pageData.epoch);
  return { ...pageData.last(topic), version: `${epoch}:${version}`, scope: String(epoch) };
}

export type { PageDataSnapshot };
