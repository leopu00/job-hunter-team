# Vision

## What JHT wants to become

Job Hunter Team is not just a script that fires off applications. It is a **team of AI characters** that the user works *with*, not just runs. The interaction should feel less like configuring a SaaS dashboard and more like meeting a small group of specialists who happen to live inside your laptop.

The job market in the mid-2020s changes every month. Skills age fast. Old advice rots. A static automation tool can't keep up — but a team of agents that talk to you, react to your goals, and adapt their strategy can.

## Design principles

### 🎮 Gamified, but constructive

Every agent has a name, a face, an emoji, and a personality. Not because we like cute interfaces — because it makes a complex pipeline **legible**. When the Captain assigns work to the Scout and the Scout reports back, the user sees a story, not a JSON payload.

The goal is the *opposite* of "enterprise productivity software". Closer to: a Discord server full of helpful colleagues who never sleep.

### 🧑‍🤝‍🧑 Agents as characters

| | Agent | Personality hook |
|---|---|---|
| 👨‍✈️ | **Captain** | The one who keeps order. Brisk, dispatcher tone. |
| 💂 | **Sentinel** | The watchful one. Quiet until something is wrong. |
| 🕵️ | **Scout** | The hunter. Reports finds with the energy of a kid showing off rocks. |
| 👨‍🔬 | **Analyst** | The skeptic. "Sure, but is it real?" |
| 👨‍💻 | **Scorer** | The judge. Numbers, no sentiment. |
| 👨‍🏫 | **Writer** | The craftsman. Cares about the comma. |
| 👨‍⚖️ | **Critic** | The blind reviewer. Doesn't know who wrote what. |
| 👨‍💼 | **Assistant** | The copilot. Walks you through the platform. |
| 🧙‍♂️ | **Maestro** *(future)* | The career coach. Sees the bigger picture. |

This is not flavor text. The system prompts of each agent are written in voice. The UI reflects that voice. Telegram messages reflect that voice.

### 🧙‍♂️ The Maestro — the missing piece

Among the planned agents, **the Maestro is the most important one we haven't built yet.**

The other agents execute a pipeline — find, verify, score, write, review. The Maestro looks *outside* the pipeline:

- Where is the user trying to go in their career?
- What did the Scorer's last batch reveal about the gap between the user's profile and the market?
- Which skills should the user invest in this month?
- Are the user's goals still aligned with what the market is paying for?

The Maestro is the only agent that has the right to tell the user *"stop applying for X, go learn Y first"*. It is the meta-layer that keeps the team useful as the world changes.

See [`agents/maestro/maestro.md`](../agents/maestro/maestro.md) for the spec.

### 👨‍💼 The Assistant — the copilot

The platform is large. The Assistant exists so that no user gets lost. It lives in every interface (web, Telegram, CLI) and answers questions like *"how do I add a new agent?"*, *"what does this score mean?"*, *"why is the team idle right now?"*.

The Assistant is what makes the platform usable for non-technical users. Without it, JHT is a developer tool. With it, JHT is a product.

## Anti-goals

What JHT will deliberately **not** become:

- ❌ A spammer. JHT produces fewer, better applications — not thousands of generic ones.
- ❌ An autonomous applicator. The human decides when to send. The Critic is the last AI step; the user is the next one.
- ❌ A SaaS. The team runs locally or on the user's own VPS. The user owns their data, their profile, their pipeline.
- ❌ An LLM benchmark. JHT picks the providers that work for real users at sustainable cost — not the most powerful one in the leaderboard.

## How this shapes the roadmap

Every feature decision passes through these questions:

1. Does it make the agents feel more like a team and less like a config file?
2. Does it bring the platform closer to a non-technical user being able to use it?
3. Does it move us toward the Maestro being possible?
4. Does it lower the cost-per-result?

If the answer is no on all four, the feature waits.
