/**
 * The services this release offers, in ONE place: `jht setup` (guided and --non-interactive) offers only these, on the pi harness
 * with an API key, and `jht doctor` calls any other active provider not supported in this release. Bringing a service back (kimi)
 * is one line here and its test (cli/tests/release-providers.test.mjs); the code that serves the others stays for the next release.
 */
export const RELEASE_PROVIDERS = Object.freeze(['glm']);

/** The program that runs the agents in this release. */
export const RELEASE_HARNESS = 'pi';

/** True when this release offers `provider` (moonshot is kimi; anything else, including a name it does not know, is not offered). */
export function offeredInRelease(provider, aliases = { moonshot: 'kimi' }) {
  const name = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
  return RELEASE_PROVIDERS.includes(aliases[name] ?? name);
}
