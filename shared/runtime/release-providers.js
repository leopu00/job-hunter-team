/**
 * The services this release offers, in ONE place: each way is a provider, the program that runs the agents (harness) and how
 * they reach the provider (auth). `jht setup` (guided and --non-interactive) offers only these, and `jht doctor`, `jht status`
 * and `jht team start` call any other way not supported in this release. Bringing a way back is one line here and its test
 * (cli/tests/release-providers.test.mjs); the code that serves the others stays for the next release.
 */
export const RELEASE_OFFERS = Object.freeze([
  Object.freeze({ provider: "glm", harness: "pi", auth: "api_key" }),
  Object.freeze({ provider: "kimi", harness: "pi", auth: "api_key" }),
  Object.freeze({ provider: "openai", harness: "pi", auth: "api_key" }),
  Object.freeze({ provider: "claude", harness: "pi", auth: "api_key" }),
]);

/** The providers of the offers, in their order (the first is the default of the setup). */
export const RELEASE_PROVIDERS = Object.freeze([
  ...new Set(RELEASE_OFFERS.map((offer) => offer.provider)),
]);

/** The program that runs the agents when nothing else is said. */
export const RELEASE_HARNESS = "pi";

const ALIASES = Object.freeze({ moonshot: "kimi", anthropic: "claude" });
const canonical = (name, aliases = ALIASES) => {
  const plain = typeof name === "string" ? name.trim().toLowerCase() : "";
  return aliases[plain] ?? plain;
};

/** True when this release offers `provider` in some way (moonshot is kimi, anthropic claude; anything else, including a name it does not know, is not). */
export function offeredInRelease(provider, aliases = ALIASES) {
  return RELEASE_PROVIDERS.includes(canonical(provider, aliases));
}

/** The ways this release offers `provider`, in their order ([] when it offers none). */
export function releaseOffersOf(provider) {
  const name = canonical(provider);
  return RELEASE_OFFERS.filter((offer) => offer.provider === name);
}

/** True when this release offers `provider` on `harness` with `auth`; a harness or an auth left out is not looked at. */
export function offeredWay(provider, harness, auth) {
  return releaseOffersOf(provider).some(
    (offer) =>
      (!harness || offer.harness === harness) && (!auth || offer.auth === auth),
  );
}

/**
 * True when the team a config describes runs in a way this release offers: the active provider, its harness (codex when the
 * config names none, as before the harness was asked) and its auth_method.
 */
export function configOffered(config) {
  const provider = config?.active_provider;
  if (!offeredInRelease(provider)) return false;
  const name = canonical(provider);
  const entry = config?.providers?.[provider] ?? config?.providers?.[name];
  return offeredWay(
    name,
    typeof config?.harness === "string" ? config.harness : "codex",
    entry?.auth_method,
  );
}
