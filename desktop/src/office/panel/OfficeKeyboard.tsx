import type { OfficeClick } from "../contract";

/**
 * The office without a mouse (D08): one button per agent and object, in
 * reading order, out of sight but in the Tab order, named with what the
 * tag under the pointer says, so a screen reader reads the same. The focus
 * is shown in the scene (a ring around the target, the tag beside it);
 * Enter or Space opens the panel. Real buttons in the page's order: Tab
 * leaves the office as it entered, nothing is trapped.
 */
export type OfficeKeyboardProps = {
  targets: OfficeClick[];
  /** the tag's text, for the button's accessible name */
  label: (target: OfficeClick) => string;
  onFocusTarget: (target: OfficeClick | null) => void;
  onOpen: (target: OfficeClick, opener: HTMLButtonElement) => void;
};

export const targetKey = (t: OfficeClick) => JSON.stringify(t);

export default function OfficeKeyboard({ targets, label, onFocusTarget, onOpen }: OfficeKeyboardProps) {
  return (
    <ul aria-label="Agenti e oggetti dell'ufficio" className="sr-only">
      {targets.map((t) => (
        <li key={targetKey(t)}>
          <button
            type="button"
            data-office-target={targetKey(t)}
            aria-label={label(t)}
            onFocus={() => onFocusTarget(t)}
            onBlur={() => onFocusTarget(null)}
            onClick={(e) => onOpen(t, e.currentTarget)}
          >
            {label(t)}
          </button>
        </li>
      ))}
    </ul>
  );
}
