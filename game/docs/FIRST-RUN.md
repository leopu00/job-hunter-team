# First-run conversation contract

## Purpose

The office must be understandable before Docker or an LLM is available. A
repeatable showroom conversation exists for every visible role; the Assistant,
Coordinator and Mentor also collect setup choices without network calls or
token usage. Fifty clearly labelled fictional positions populate list, detail,
filters and map without using personal or production data.

## State

`ScriptedOnboarding` is an autoload. It persists steps, history, profile draft,
preferences and completion flags in `user://guided_onboarding.cfg`.

- **Assistant:** goal → experience → work mode → geography → native profile.
- **Coordinator:** local/VPS → runtime → provider → login → profile → optional
  channels → team activation.
- **Mentor:** career priority → search breadth → feedback cadence → hours.

Every node offers two or more authored choices where a decision exists. Users
can leave and return without losing state.

## Strict choice-only and live modes

Free text is disabled until all of these are true:

1. the container is running;
2. a subscription provider is authenticated;
3. the selected agent has a live backend session.

Provider authentication is a hard boundary. Before it, only authored choices
exist. As soon as it succeeds, every authored choice disappears—even if the
container or selected agent still needs to start. Once all three conditions are
true, free text is routed through `BackendBus` to the real agent.

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

The authored Assistant prefills role, experience and location. The native
Profile panel collects exact personal data. The ready gate requires name,
email, target role, location, experience, seniority, at least two skills and at
least one language. `PROFILE_SAVE_PY` persists all eight fields plus guided
search preferences without invoking an agent.

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
