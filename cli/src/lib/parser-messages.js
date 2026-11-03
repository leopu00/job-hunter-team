/**
 * The parser's own errors (Commander writes them in English) in the language of the person.
 * Only the usual four or five are known; any other line comes out as the parser wrote it.
 */
import { say } from './texts.js';

const PATTERNS = [
  [/^unknown command '(.+)'$/, 'error.unknown_command'],
  [/^unknown option '(.+)'$/, 'error.unknown_option'],
  [/^missing required argument '(.+)'$/, 'error.missing_argument'],
  [/^option '(.+)' argument missing$/, 'error.option_missing_value'],
];

/** A line of the parser, in the language of the person (or as it was, when it is not one of the known). */
export function parserLine(line) {
  const text = String(line).trim();
  for (const [pattern, key] of PATTERNS) {
    const m = pattern.exec(text);
    if (m) return say(key, { name: m[1] });
  }
  if (/^too many arguments/.test(text)) return text.replace(/^too many arguments/, say('error.too_many'));
  const suggestion = /^Did you mean (.+)\?$/.exec(text);
  if (suggestion) return say('error.did_you_mean', { name: suggestion[1] });
  return text;
}
