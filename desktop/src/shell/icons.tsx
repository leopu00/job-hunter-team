/**
 * The icons of the panel's most important buttons: start and stop the team, refresh, the account, customise the theme.
 * Drawn in code, one line weight with the theme gear (1.6-1.8), in the button's own colour (currentColor), so they
 * follow every theme. Always next to the button's words, never instead of them: hidden from screen readers.
 */
type IconProps = { size?: number };

const frame = (size: number) =>
  ({ "aria-hidden": true, viewBox: "0 0 24 24", width: size, height: size, focusable: false, className: "shrink-0" }) as const;

export function PlayIcon({ size = 12 }: IconProps) {
  return (
    <svg {...frame(size)} data-icon="play">
      <path d="M7 4.5v15a.6.6 0 0 0 .9.5l12-7.5a.6.6 0 0 0 0-1L7.9 4a.6.6 0 0 0-.9.5Z" fill="currentColor" />
    </svg>
  );
}

export function StopIcon({ size = 12 }: IconProps) {
  return (
    <svg {...frame(size)} data-icon="stop">
      <rect x="5.5" y="5.5" width="13" height="13" rx="1.5" fill="currentColor" />
    </svg>
  );
}

export function RefreshIcon({ size = 13 }: IconProps) {
  return (
    <svg {...frame(size)} data-icon="refresh">
      <path
        d="M20 11a8 8 0 0 0-14.5-4.6L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.6L20 16m0 4v-4h-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AccountIcon({ size = 13 }: IconProps) {
  return (
    <svg {...frame(size)} data-icon="account">
      <circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 20.5a8 8 0 0 1 16 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function PaletteIcon({ size = 14 }: IconProps) {
  return (
    <svg {...frame(size)} data-icon="palette">
      <path
        d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.9 1.8-1.9 0-.5-.2-.9-.5-1.3-.3-.3-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.5 17 3 12 3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="7.5" cy="11" r="1.3" fill="currentColor" />
      <circle cx="10.5" cy="7.3" r="1.3" fill="currentColor" />
      <circle cx="15" cy="7.8" r="1.3" fill="currentColor" />
    </svg>
  );
}
