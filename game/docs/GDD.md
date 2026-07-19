# JHT: The Office — current product design

The Godot application is the only desktop client for Job Hunter Team. It is a
useful job-search cockpit presented as a living office, not a separate game or
a visual wrapper around another application.

## Product contract

- A new user enters the office immediately. Setup never hides the product.
- The five-stage pipeline is physically visible: Scout → Analysts → Scorer →
  Writers → Critics.
- Real container/VPS state controls which agents are present and what they do.
- Positions, CVs, applications, statistics, map, activity, chat and settings
  are native Godot views.
- Technical commands and provider CLIs run inside the embedded console. OAuth
  may open a browser, but never an external terminal.
- The web dashboard remains an optional read-only mirror; Electron is removed.

## First-run gameplay

The setup CTA exposes both a three-gate checklist and three diegetic
conversations:

1. **Assistant** gathers role family, experience, work mode and geography,
   then prefills the native profile form.
2. **Coordinator** guides local/VPS runtime, provider selection and login,
   required profile fields, optional Telegram/email/cloud channels, and team
   activation.
3. **Mentor** captures career priority, search breadth, feedback cadence and
   optionally opens working hours.

Before provider authentication, only authored reply choices are available and
no LLM is called. State is persisted locally. After provider authentication
and agent startup, suggested replies remain available while free text is sent
to the real agent. Details: [`FIRST-RUN.md`](FIRST-RUN.md).

## Main state flow

```text
TITLE → OFFICE ↔ native panels / scripted conversations
                 │
                 ├─ container or VPS
                 ├─ provider subscription login
                 ├─ complete native profile
                 └─ start team → live agents + free chat
```

`scenes/wizard.tscn` remains a focused Assistant/profile surface reachable from
the office; it is not the mandatory first screen.

## Interaction and visual language

- FreeCamera: drag/WASD, wheel/pinch zoom; no player avatar.
- Click agents for identity, activity and conversation.
- Click department paper piles for their real processing queues.
- Click the output shelf for generated CVs.
- Terminal-style native panels use the brand palette and painted office/agent
  assets; fullscreen chat pairs a large portrait with dialogue and choices.
- Any modal blocks camera input and background scrolling.

## Data and security

`BackendBus` is the UI contract. `LocalBackend` and `VpsBackend` expose the
same snapshots and write methods. Secrets never enter safe settings snapshots;
email and Telegram credentials travel through stdin and remain under
`~/.jht` or the connected VPS. Profile writes are atomic and backed up.

## Verification

- `tools/run.sh test` / `tools/run.ps1 test`: logic, UI and integration smoke.
- `JHT_GUIDED_TEST=1`: scripted trees, offline choice-only UI, hybrid free-text
  transition and native profile-field coverage.
- `JHT_GUIDED_CHAT=assistente JHT_CHAT_FULL=1`: visual first-run preview.
