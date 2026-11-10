import type { ErrorCopy } from "./error-catalog";
import type { ErrorTranslations } from "./error-catalog.locales";
import { HARNESS_ERRORS, HARNESS_ERROR_TRANSLATIONS } from "./error-catalog.harness";
import { PAGE_DATA_ERRORS, PAGE_DATA_ERROR_TRANSLATIONS } from "./error-catalog.page-data";

/** The catalog entries kept in their own files, in one place: error-catalog.ts and its locales spread these. */
export const EXTRA_ERRORS: Readonly<Record<string, ErrorCopy>> = { ...PAGE_DATA_ERRORS, ...HARNESS_ERRORS };
export const EXTRA_ERROR_TRANSLATIONS: Readonly<Record<string, ErrorTranslations>> = {
  ...PAGE_DATA_ERROR_TRANSLATIONS,
  ...HARNESS_ERROR_TRANSLATIONS,
};
