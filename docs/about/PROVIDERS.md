# 💳 Providers & Pricing

**0.4.0 offers one way to power the team: Pi with a GLM (Z.ai) API key.** `jht setup` (guided and `--non-interactive`) offers only that.

| Way | How you pay | Agents run on | Status in 0.4.0 |
|---|---|---|---|
| 🟢 **Pi with GLM (Z.ai)** | an **API key**, billed per call by the provider | the Pi harness | ✅ offered |
| 🔵 Codex (OpenAI) with a ChatGPT subscription or an OpenAI key | subscription or API key | Codex CLI | ⏳ coming in a later release |
| Kimi (Moonshot), Claude | API key / subscription | Pi / their CLI | ⏳ coming in a later release |

The services a release offers are one list in the code (`shared/runtime/release-providers.js`). A team already configured on a service that is not offered keeps its configuration: `jht doctor` says it is not supported in this release and what to do (`jht setup`, choose GLM and paste its key).

## 🔵 Codex: subscription (coming in a later release)

`jht setup` (or the app) signs you in with your ChatGPT account. The team runs inside the plan's 5-hour and weekly windows:

1. **🛡️ Sentinel** watches the usage in real time and slows the team down if it goes too fast.
2. **🌉 Bridge** samples the usage on a fixed clock and projects when the team would hit 100% of the window.

Together they aim each window at **92%** without crossing 100% (which would rate-limit and freeze the team). Measured: a 30-day autonomous run on Codex Pro found 658 positions and scored 520, closing every week at 99–100% with no overshoot ([Case Study #4](RESULTS.md#-case-study-4--the-finance-profile--codex-pro-one-month-autonomous-run)). Numbers in [`MONITORING.md`](MONITORING.md).

The plan matters: the app asks which one you have (a card in the Assistant's chat) and sizes the team to it.

## 🟢 Pi with GLM: API key

```bash
jht setup                                                      # guided: the key is typed hidden
jht setup --non-interactive --provider glm --api-key-file <file>   # or: … --api-key-stdin < <file>
```

The harness is Pi (`--harness pi` is the default and the only one accepted in 0.4.0). Kimi (`--provider kimi`) comes in a later release. The guided setup checks the key with the provider before it keeps it. The key is read from a file or from stdin, kept off the command line (`--api-key` works but leaves the key in your shell history), and handed to the agents only through their environment. The app's **Settings** can switch the agents' program (Codex or Pi) and give GLM/Kimi a new key.

Models per role (`shared/runtime/provider-models.list`): on GLM the Scout, the Analyst and the Sentinel use `glm-5.3-flash`, the other roles `glm-5.3`; on Kimi `kimi-k3.1-pro` for every role.

An API key has **no usage window**: nothing paces the team but a ceiling. Set it in the configuration (or ask the Captain):

```json
"no_quota_cap": {"eur": 10, "tokens_per_hour": 500000}
```

`eur` is what the agents spent today (as measured by Pi), `tokens_per_hour` what they processed in the last hour. At the ceiling the team pauses (nothing is lost) and resumes the next day, when the hour drops below the limit, or when you raise the ceiling. Without a ceiling the team keeps spending and tells you once a day how much. Set a limit with the provider too.

Measured cost (GLM, 30 minutes, fake persona on real job ads): **2.38 USD for 24 scored positions**, about 0.10 USD per score. The Assistant's onboarding with a CV cost 0.4–0.7 USD in the test runs.

## ⚖️ Terms of service

JHT drives each provider through its official tool (the Codex CLI with your account, Pi with your key): no scraping, no reverse-engineered endpoints. Providers' terms change and automation policies differ between plans: **read your provider's current terms** before running a team around the clock, and prefer an account or key used only by JHT, also to keep the budget readable.

## 📜 History

[ADR-0004](../adr/0004-subscription-only-no-api-keys.md) (subscriptions only) is superseded by [ADR-0012](../adr/0012-desktop-setup-matrix.md). Measured before 0.4 and kept as history: Claude Max x20 held each window within ±5% of target; Claude Pro (~€20) ran out before an agent finished a useful session. The headless [API team](../guides/API-TEAM.md) is a separate path, in rehearsal on a test VPS.
