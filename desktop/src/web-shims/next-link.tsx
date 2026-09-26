import type { AnchorHTMLAttributes, MouseEvent, Ref } from "react";

/**
 * Stand-in for `next/link` in the desktop build. The dashboard reuses the web
 * components as they are, and RecentPositionsTable links to `/positions` and
 * `/positions/<id>`: pages the desktop does not have yet. A real navigation
 * would leave the app, so the click is kept inside and announced as a
 * `jht:navigate` event, for the screen that will handle those routes.
 */
export const NAVIGATE_EVENT = "jht:navigate";

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  ref?: Ref<HTMLAnchorElement>;
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
};

export default function Link({
  href,
  onClick,
  prefetch: _prefetch,
  replace: _replace,
  scroll: _scroll,
  ...rest
}: Props) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: { href } }));
  };
  return <a href={href} onClick={handleClick} {...rest} />;
}
