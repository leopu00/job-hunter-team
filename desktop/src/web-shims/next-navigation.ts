import { useMemo } from "react";
import { currentLocation, navigate, refresh, useLocation } from "../shell/router";

/**
 * Stand-in for `next/navigation` in the desktop build: the web's client hooks
 * read and move the shell's router. router.refresh() asks the current page
 * to read its data again (see useRefresh in shell/router).
 */
export function useRouter() {
  return useMemo(
    () => ({
      push: (href: string) => navigate(href),
      replace: (href: string) => navigate(href, { replace: true }),
      back: () => window.history.back(),
      forward: () => window.history.forward(),
      refresh,
      prefetch: () => undefined,
    }),
    [],
  );
}

export function usePathname(): string {
  return useLocation().path;
}

export function useSearchParams(): URLSearchParams {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

/** Server-side in Next; here it moves the router and stops the render that asked. */
export function redirect(href: string): never {
  navigate(href, { replace: true });
  throw new Error(`redirect to ${href} (${currentLocation().path})`);
}

export function notFound(): never {
  throw new Error("not found");
}
