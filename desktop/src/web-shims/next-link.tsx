import type { AnchorHTMLAttributes, MouseEvent, Ref } from "react";
import { isAppHref, navigate } from "../shell/router";

/**
 * Stand-in for `next/link` in the desktop build, so the web components run
 * unchanged. A web path (`/positions/42`) goes through the shell's router; any
 * other href (https://…, mailto:) behaves as a plain link. Modified clicks
 * (cmd/ctrl/shift, middle button) are left alone.
 */
type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string | { pathname?: string; query?: Record<string, string> };
  ref?: Ref<HTMLAnchorElement>;
  prefetch?: boolean | null;
  replace?: boolean;
  scroll?: boolean;
};

function toHref(href: Props["href"]): string {
  if (typeof href === "string") return href;
  const query = href.query ? "?" + new URLSearchParams(href.query).toString() : "";
  return (href.pathname ?? "") + query;
}

export default function Link({
  href: rawHref,
  onClick,
  prefetch: _prefetch,
  replace = false,
  scroll: _scroll,
  ...rest
}: Props) {
  const href = toHref(rawHref);
  const inApp = isAppHref(href);
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || !inApp) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href, { replace });
  };
  return <a href={inApp ? "#" + href : href} onClick={handleClick} {...rest} />;
}
