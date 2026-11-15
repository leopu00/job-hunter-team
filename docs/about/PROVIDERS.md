# 💳 Providers & Pricing

**0.4.0 offers four ways to power the team: Pi with an API key from GLM (Z.ai), Kimi (Moonshot), OpenAI or Claude (Anthropic).** `jht setup` (guided and `--non-interactive`) offers those four.

| Way | How you pay | Agents run on | Status in 0.4.0 |
|---|---|---|---|
| 🟢 **Pi with GLM (Z.ai)** | an **API key**, billed per call by the provider | the Pi harness | ✅ offered |
| 🟢 **Pi with Kimi (Moonshot)** | an **API key**, billed per call by the provider | the Pi harness | ✅ offered |
| 🟢 **Pi with OpenAI** | an **API key**, billed per call by the provider | the Pi harness | ✅ offered |
| 🟢 **Pi with Claude (Anthropic)** | an **API key**, billed per call by the provider | the Pi harness | ✅ offered |
| 🔵 Codex (OpenAI) with a ChatGPT subscription | subscription | Codex CLI | ⏳ not in 0.4.0 |

The services a release offers are one list in the code (`shared/runtime/release-providers.js`). A team already configured on a service that is not offered keeps its configuration: `jht doctor` says it is not supported in this release and what to do (`jht setup`, choose GLM and paste its key).

## 🔵 Codex: subscription (not in 0.4.0)

`jht setup` (or the app) signs you in with your ChatGPT account. The team runs inside the plan's 5-hour and weekly windows:

1. **🛡️ Sentinel** watches the usage in real time and slows the team down if it goes too fast.
2. **🌉 Bridge** samples the usage on a fixed clock and projects when the team would hit 100% of the window.

Together they aim each window at **92%** without crossing 100% (which would rate-limit and freeze the team). Measured: a 30-day autonomous run on Codex Pro found 658 positions and scored 520, closing every week at 99–100% with no overshoot ([Case Study #4](RESULTS.md#-case-study-4--the-finance-profile--codex-pro-one-month-autonomous-run)). Numbers in [`MONITORING.md`](MONITORING.md).

The plan matters: the app asks which one you have (a card in the Assistant's chat) and sizes the team to it.

## 🟢 Pi with an API key (GLM, Kimi, OpenAI, Claude)

```bash
jht setup                                                      # guided: the key is typed hidden
jht setup --non-interactive --provider glm --api-key-file <file>   # or: … --api-key-stdin < <file>
jht setup --non-interactive --provider kimi --api-key-file <file>  # Kimi (Moonshot): the key is MOONSHOT_API_KEY
jht setup --non-interactive --provider openai --api-key-file <file>  # OpenAI: the key is OPENAI_API_KEY
jht setup --non-interactive --provider claude --api-key-file <file>  # Claude (Anthropic): the key is ANTHROPIC_API_KEY
```

The harness is Pi (`--harness pi` is the default and the only one accepted in 0.4.0). The guided setup asks which provider (GLM first) and checks the key with it before it keeps it. The key is read from a file or from stdin, kept off the command line (`--api-key` works but leaves the key in your shell history), and handed to the agents only through their environment. To give the provider a new key, run `jht setup` again with it: the team's other settings stay.

Models per role (`shared/runtime/provider-models.list`): on GLM the Scout, the Analyst and the Sentinel use `glm-5.3-flash`, the other roles `glm-5.3`; on Kimi `kimi-k3.1-pro` for every role; on OpenAI the Captain, the Writer, the Critic and the Mentor use `gpt-5.6-sol`, the Scorer, the Assistant and the Closer `gpt-5.6-terra`, the Scout, the Analyst and the Sentinel `gpt-5.6-luna`; on Claude the same split with `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-haiku-5-5`.

An API key has **no usage window**: nothing paces the team but a ceiling. Set it in the configuration (or ask the Captain):

```json
"no_quota_cap": {"eur": 10, "tokens_per_hour": 500000}
```

`eur` is what the agents spent today (as measured by Pi), `tokens_per_hour` what they processed in the last hour. At the ceiling the team pauses (nothing is lost) and resumes the next day, when the hour drops below the limit, or when you raise the ceiling. Without a ceiling the team keeps spending and tells you once a day how much. Set a limit with the provider too.

Measured cost (GLM, 30 minutes, fake persona on real job ads): **2.38 USD for 24 scored positions**, about 0.10 USD per score. The Assistant's onboarding with a CV cost 0.4–0.7 USD in the test runs.

## ⚖️ Terms of service

JHT drives each provider through its official tool (Pi with your key): no scraping, no reverse-engineered endpoints. Providers' terms change and automation policies differ between plans: **read your provider's current terms** before running a team around the clock, and prefer an account or key used only by JHT, also to keep the budget readable.

## 📜 History

[ADR-0004](../adr/0004-subscription-only-no-api-keys.md) (subscriptions only) is superseded by [ADR-0012](../adr/0012-desktop-setup-matrix.md). Measured before 0.4 and kept as history: Claude Max x20 held each window within ±5% of target; Claude Pro (~€20) ran out before an agent finished a useful session. The headless [API team](../guides/API-TEAM.md) is a separate path, in rehearsal on a test VPS.
