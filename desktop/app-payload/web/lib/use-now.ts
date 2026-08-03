"use client";

import { useEffect, useState } from "react";

/**
 * A live wall-clock value for one page or list. Call this once in the owner and
 * pass the value to rows so large lists never create an interval per item.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}
