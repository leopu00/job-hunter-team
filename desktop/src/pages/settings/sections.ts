/**
 * The sections of the Settings page, in the order of the column on the left. Everything technical that is
 * not about the positions has its place in one of them (SettingsPage): the address of a section is
 * /settings/<id>.
 */
export const SECTION_IDS = ["appearance", "team", "where", "data", "account"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export const DEFAULT_SECTION: SectionId = "appearance";

export function sectionOf(value: string | undefined): SectionId {
  return (SECTION_IDS as readonly string[]).includes(value ?? "") ? (value as SectionId) : DEFAULT_SECTION;
}

const LAST_SECTION_KEY = "jht-settings-section";

/** The section the person was last in: a convenience, so a failing storage just means the first one. */
export function lastSection(): SectionId {
  try {
    return sectionOf(window.localStorage.getItem(LAST_SECTION_KEY) ?? undefined);
  } catch {
    return DEFAULT_SECTION;
  }
}

export function rememberSection(id: SectionId): void {
  try {
    window.localStorage.setItem(LAST_SECTION_KEY, id);
  } catch {
    // a denied storage only loses the convenience
  }
}
