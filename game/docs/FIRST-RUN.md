# First-run conversation contract

## Purpose

The office must be understandable before Docker or an LLM is available. A
repeatable showroom conversation exists for every visible role; the Assistant,
Coordinator and Mentor also collect setup choices without network calls or
token usage. Fifty clearly labelled fictional positions populate list, detail,
filters and map without using personal or production data.

## State

`ScriptedOnboarding` is an autoload. It persists steps, history, profile draft,
preferences, structured answers and completion flags in
`user://guided_onboarding.cfg`. It also updates two portable local exports
after every answer:

- `user://onboarding_context.json`: versioned machine-readable context;
- `user://onboarding_context.md`: compact, human-readable LLM context.

Re-answering a topic replaces that topic in the structured context (the
visible chat still keeps its history), so an LLM never receives two
contradictory current preferences.

- **Assistant:** role and specialization → experience/current situation →
  skill stretch → work mode/geography → relocation → contract → compensation
  → company stage → native profile.
- **Coordinator:** local/VPS → runtime → provider → login → profile → optional
  autonomy → token budget → privacy → availability → channels → activation.
- **Mentor:** career priority/motivation → breadth → risk/pace → feedback
  tone/cadence → deal-breaker → hours.

Decision nodes offer 3–7 authored choices and follow-up copy reacts to the
path already taken. Across the three agents this creates millions of valid
combinations without pretending to call an AI. Users can leave and return
without losing state.

The physical office tour also exposes multiple questions for every presented
department (sources, enrichment reliability, scoring, document provenance,
review criteria and health monitoring). `DialogueUI` records the selected
questions in the same structured memory, including keyboard choices 1–9, so
the future agents know which parts of the system mattered to the user.

## Strict choice-only and live modes

Free text is disabled until all of these are true:

1. the container is running;
2. a subscription provider is authenticated;
3. the selected agent has a live backend session.

Provider authentication is a hard boundary. Before it, only authored choices
exist. As soon as it succeeds, every authored choice disappears—even if the
container or selected agent still needs to start. Once all three conditions are
true, free text is routed through `BackendBus` to the real agent.

On the first live message to each agent, the VPS adapter attaches the current
Markdown onboarding context to the tmux payload outside the visible
`chat.jsonl` message. It sends it again only after the context changes. Agents
are told to treat it as a starting point, prefer newer explicit requests and
ask for confirmation on conflicts. Nothing is sent before the user connects a
provider and starts a live chat.

Assistant, Coordinator and Mentor install `game-reply-options` at agent boot.
They may emit 2–5 optional buttons generated for the current live context. Such
buttons come from `chat.jsonl`, remain compatible with free text and disappear
after the next user message; they are not a second hardcoded onboarding tree.

## Provider authorization

Codex, Claude and Kimi run in the full-screen embedded console. URLs detected
in output get **Open in browser** and **Copy link** actions; codes and menu
choices can be pasted or typed without leaving the office terminal. The system
probes persisted credentials every few seconds. When authorization completes,
it updates the checklist and closes an otherwise-still-interactive provider
CLI automatically. The browser is only the provider's authorization surface;
no external terminal is launched.

## Profile without an LLM

The authored Assistant stores the chosen role category and specialty as stable
IDs, independent of the localized labels shown in chat. It also prefills
experience and location. `target_role` remains the user's free-text objective:
the wizard never derives it from a display label, and the ready gate still
requires that exact text together with name, email, location, experience,
seniority, at least two skills and at least one language. `PROFILE_SAVE_PY`
persists those fields plus guided search preferences without invoking an agent.
Existing free-text roles are not migrated or normalized; see
`docs/internal/2026-08-12-target-role-category-contract.md`.

## Tests

`JHT_GUIDED_TEST=1` exercises all three trees inside the normal Office scene,
including VPS, provider-switch, optional-channel and Mentor-restart branches;
it renders a real `ChatPanel`, presses a real authored-choice button, verifies
choice-only mode, switches to a mock live agent, verifies strict removal of
authored choices plus agent-generated buttons, and
checks that email/languages exist in the native profile editor. The embedded
terminal test also verifies URL/input and provider-auth auto-close. Embedded
Python payloads are separately syntax-compiled by
`tools/python_payload_syntax_test.py`.
