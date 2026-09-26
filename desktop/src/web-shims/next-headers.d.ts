// Types only. web/lib/dashboard-i18n.ts imports the ServerLocale type from
// web/lib/server-locale.ts, whose import chain reaches `next/headers`. The
// desktop never runs that code (the import is type-only and erased), but tsc
// follows it: this declaration lets it resolve without installing next.
export declare function cookies(): Promise<{
  get(name: string): { name: string; value: string } | undefined;
}>;
export declare function headers(): Promise<Headers>;
