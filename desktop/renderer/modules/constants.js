// Wizard step IDs (kept as strings so they match data-step attributes
// in renderer/index.html).
export const STEP_LANGUAGE = 'language'
export const STEP_WELCOME = 'welcome'
export const STEP_SETUP = 'setup'
export const STEP_CONTAINER = 'container'
export const STEP_SUBSCRIPTION_NOTICE = 'subscription-notice'
export const STEP_MODEL_COMPARE = 'model-compare'
export const STEP_PROVIDER_CHOOSE = 'provider-choose'
export const STEP_PROVIDER_INSTALL = 'provider-install'
export const STEP_PROVIDER_LOGIN = 'provider-login'
export const STEP_READY = 'ready'
export const STEP_RUNNING = 'running'

export const PROVIDER_OPTIONS = [
  { id: 'claude', label: 'Claude Code', vendor: 'Anthropic · Claude Pro/Max' },
  { id: 'codex', label: 'Codex', vendor: 'OpenAI · ChatGPT Plus/Pro' },
  { id: 'kimi', label: 'Kimi', vendor: 'Moonshot · Kimi paid plan' },
]

// Subscription tiers the user can connect through each CLI. Monthly
// price, monthly tokens delivered at full saturation, $/M = price ÷
// monthly. Shown to help users pick a plan, not as a contract.
// Monthly tokens = weekly × 4 (conservative, approximates 4 full-
// saturation weeks per month).
//
// Methodology (reworked April 2026, reconciled with real-world
// measurements from ksred.com, productcompass.pm, Faros.ai, OpenAI
// community threads and kimik2ai.com):
//   - Claude Pro / Max 5×: community benchmarks converge on ~8M / 40M
//     tok/wk (=32M / 160M /mo), matching the 5× multiplier. Max 20×
//     weekly cap (intro 2025-08) compresses nominal 20× to measured
//     ~70–110M/wk (~280–440M/mo) — we use 400M/mo.
//   - Codex Plus: post-rebalance real usage is ~15–25M/wk (~60–100M/mo),
//     not the nominal 30M/wk. We use 80M/mo. Pro 5× / Pro 20× scale by
//     the stated multiplier on the new Plus baseline (400M / 1.6B /mo).
//   - Kimi Moderato: 16M/wk = 64M/mo, verified via 2048 Kimi Code
//     req/wk × ~8k tok/req. Allegretto / Allegro / Vivace: extrapolated
//     from published credit multipliers (5× / 15× / 44× Moderato) and
//     labelled "est." — no public measurements exist yet.
//
// Tokens uncached. Kimi's 75% cache discount bumps real throughput.
export const PROVIDER_PLANS = {
  claude: [
    { id: 'pro',    name: 'Claude Pro',     model: 'Sonnet 4.6 · Opus 4.7',            price: '$20/mo',  priceUsd: 20,  monthlyM: 32,   monthly: '~32M tok/mo',   estimate: '~44k tok / 5h baseline' },
    { id: 'max5',   name: 'Claude Max 5×',  model: 'Sonnet 4.6 · Opus 4.7',            price: '$100/mo', priceUsd: 100, monthlyM: 160,  monthly: '~160M tok/mo',  estimate: '~88k tok / 5h · 5× Pro' },
    { id: 'max20',  name: 'Claude Max 20×', model: 'Sonnet 4.6 · Opus 4.7',            price: '$200/mo', priceUsd: 200, monthlyM: 400,  monthly: '~400M tok/mo',  estimate: 'measured ~280–440M/mo (post weekly cap)',   recommended: true, recommendedTag: 'intelligence' },
  ],
  codex: [
    { id: 'plus',   name: 'ChatGPT Plus',    model: 'GPT-5.3-Codex',                   price: '$20/mo',  priceUsd: 20,  monthlyM: 80,   monthly: '~80M tok/mo',    estimate: 'measured ~60–100M/mo (post rebalance)' },
    { id: 'pro5',   name: 'ChatGPT Pro 5×',  model: 'GPT-5.4 · GPT-5.3-Codex',         price: '$100/mo', priceUsd: 100, monthlyM: 400,  monthly: '~400M tok/mo',   estimate: '~5× Plus',                                   recommended: true, recommendedTag: 'balanced' },
    { id: 'pro20',  name: 'ChatGPT Pro 20×', model: 'GPT-5.4 · GPT-5.3-Codex-Spark',   price: '$200/mo', priceUsd: 200, monthlyM: 1600, monthly: '~1.6B tok/mo',   estimate: '~20× Plus' },
  ],
  kimi: [
    { id: 'moderato',   name: 'Moderato',   model: 'Kimi Code',                        price: '$19/mo',  priceUsd: 19,  monthlyM: 64,   monthly: '~64M tok/mo',           estimate: '2048 Kimi Code req/wk (verified)' },
    { id: 'allegretto', name: 'Allegretto', model: 'Kimi Code',                        price: '$39/mo',  priceUsd: 39,  monthlyM: 320,  monthly: '~320M tok/mo (est.)',   estimate: '5× Moderato credits (extrapolated)',     recommended: true, recommendedTag: 'affordable' },
    { id: 'allegro',    name: 'Allegro',    model: 'Kimi Code',                        price: '$99/mo',  priceUsd: 99,  monthlyM: 960,  monthly: '~960M tok/mo (est.)',   estimate: '15× Moderato credits (extrapolated)' },
    { id: 'vivace',     name: 'Vivace',     model: 'Kimi Code',                        price: '$199/mo', priceUsd: 199, monthlyM: 2800, monthly: '~2.8B tok/mo (est.)',   estimate: '44× Moderato credits (extrapolated)' },
  ],
}

// Benchmark data for the "How the models stack up" step. Five variants
// total — two Claude tiers (Opus 4.7 ceiling, Sonnet 4.6 workhorse),
// two GPT-5.3-Codex reasoning levels (high and xhigh), and Kimi Code.
// Choices:
//   - GPT-5.3-Codex, not GPT-5.4: GPT-5.4 is the generalist reasoning
//     model on ChatGPT. Codex CLI's native model is still GPT-5.3-Codex
//     (coding-specialized, stronger on SWE-bench Verified). Users who
//     pick "Codex" get GPT-5.3-Codex by default.
//   - Hiku excluded — not deep enough for Captain / Writer / Critic
//     roles in the JHT team.
//
// Sources (April 2026): Artificial Analysis (throughput), SWE-bench
// Verified leaderboard / Vals.ai (intelligence), Anthropic/OpenAI/
// Moonshot pricing pages (API cost). Kimi Code intelligence is K2.5
// proxy — K2.6 Code Preview rolled out 2026-04-13 but official
// numbers aren't published yet. GPT-5.3 xhigh numbers extrapolated
// from its "high" default (~80% SWE-bench Verified from benchlm.ai)
// applying OpenAI's documented "xhigh gains a few points for 3-5x
// more output tokens thought".
export const MODEL_VARIANTS = [
  {
    providerId: 'claude',
    modelName: 'Opus 4.7',
    color: '#d97757',
    intelligence: 87.6,
    speed: 51,
    cost: 25,
  },
  {
    providerId: 'claude',
    modelName: 'Sonnet 4.6',
    color: '#e8a283',
    intelligence: 79.6,
    speed: 53,
    cost: 15,
  },
  {
    providerId: 'codex',
    modelName: 'GPT-5.3 xhigh',
    color: '#10a37f',
    intelligence: 82,
    speed: 73,
    cost: 14,
  },
  {
    providerId: 'codex',
    modelName: 'GPT-5.3 high',
    color: '#4fc49d',
    intelligence: 80,
    speed: 90,
    cost: 14,
  },
  {
    providerId: 'kimi',
    modelName: 'Kimi Code',
    color: '#7d62e8',
    intelligence: 78,
    speed: 60,
    cost: 2.5,
  },
]

// Where to send the user to buy a subscription if they don't have one
// yet. Opened in the default system browser via shell.openExternal.
export const PROVIDER_SUBSCRIBE_URL = {
  claude: 'https://claude.com/pricing',
  codex: 'https://chatgpt.com/pricing',
  kimi: 'https://www.kimi.com/membership/pricing',
}
