declare module "*redaction-rules.js" {
  export type RedactionRule = {
    key: string;
    family: "secret" | "personal";
    pattern: RegExp;
    replace: string;
  };
  export const REDACTION_RULES: RedactionRule[];
}
