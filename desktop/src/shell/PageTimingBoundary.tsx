import { useInsertionEffect, type ReactNode } from "react";
import { beginPageLoad } from "../lib/page-timing";

/** Start at commit, before a child reports visible data in a layout or passive effect. */
export function PageTimingBoundary({ path, search, children }: {
  path: string;
  search: string;
  children: ReactNode;
}) {
  useInsertionEffect(() => beginPageLoad(path), [path, search]);
  return children;
}
