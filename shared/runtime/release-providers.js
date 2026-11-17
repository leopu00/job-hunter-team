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
  // OpenAI with the ChatGPT subscription, run by Pi with its own sign-in (not Codex's): no key, paced by the plan
  Object.freeze({ provider: "openai", harness: "pi", auth: "subscription" }),
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

/**
 * What this release offers, in one English sentence for the refusals of the CLI («glm, kimi, openai, claude on Pi with an API
 * key»). Built from RELEASE_OFFERS, so it never says less than the list.
 */
export function offersSentence() {
  const words = {
    api_key: "an API key",
    subscription: "the ChatGPT subscription",
    cli: "the sign-in of its CLI",
  };
  const programs = { pi: "Pi", codex: "Codex" };
  const groups = [];
  for (const offer of RELEASE_OFFERS) {
    let group = groups.find(
      (g) => g.harness === offer.harness && g.auth === offer.auth,
    );
    if (!group)
      groups.push(
        (group = { harness: offer.harness, auth: offer.auth, providers: [] }),
      );
    group.providers.push(offer.provider);
  }
  return groups
    .map(
      (g) =>
        `${g.providers.join(", ")} on ${programs[g.harness] ?? g.harness} with ${words[g.auth] ?? g.auth}`,
    )
    .join("; ");
}

/**
 * Why the team a config describes is not a way of this release, or null when it is (or there is no provider yet):
 *   'codex_subscription'  OpenAI on Codex (the ChatGPT subscription, or a key Codex keeps): the way of 0.3.x, not in this release
 *   'way'                 a provider of the release on a way it does not offer (glm on codex, claude with a subscription)
 *   'provider'            a provider this release does not offer at all
 */
export function notOfferedReason(config) {
  const provider =
    typeof config?.active_provider === "string"
      ? config.active_provider.trim().toLowerCase()
      : "";
  if (!provider || configOffered(config)) return null;
  const harness =
    typeof config?.harness === "string" ? config.harness : "codex";
  if ((provider === "openai" || provider === "codex") && harness === "codex")
    return "codex_subscription";
  return offeredInRelease(provider) ? "way" : "provider";
}

/**
 * A team set up before 0.4.0 on OpenAI with the ChatGPT subscription (Codex): not offered to new users, but it keeps running.
 * Every command that sees such a team accepts it and says the same warning (CODEX_LEGACY_WARNING).
 */
export function codexLegacy(config) {
  return notOfferedReason(config) === "codex_subscription";
}

/** The one warning, in English, for the programs that have no catalog of their own (the launcher writes the same). */
export const CODEX_LEGACY_WARNING =
  "The ChatGPT subscription (Codex) is no longer offered to new users from 0.4.0: your team keeps working; to move to GLM, Kimi, OpenAI or Claude with an API key: jht setup";
