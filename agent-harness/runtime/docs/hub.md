# jht-hub — the team's database and channels behind one process

T18, SICUREZZA-HARNESS §8 phase 2. Before it, a role that needed `jobs.db`
or the channels had them mounted, and its shell could write both: rewrite
scores with `node:sqlite`, post into another role's inbox under any name,
read the person's replies meant for someone else. With the hub, a role's
container mounts neither, and what it may do there is what its tools allow.

## What it does

`npm run hub` listens on `127.0.0.1` (the pod's loopback) and answers five
POSTs, JSON in and out, each with a role's token in `Authorization: Bearer`:

| Path | Does |
| --- | --- |
| `/v1/tool` `{name, args}` | runs one of the caller's database tools: the tools `createSkillTools` builds with the database for the caller's role (its `skills.list`, read by the hub), with the same code and `role-policy.ts`. Tools that do not need the database stay in the role; asking the hub for one is a 403 |
| `/v1/mailbox/send` `{to, text}` | appends to `to`'s inbox, `from` set to the token's agent |
| `/v1/mailbox/drain` `{}` | empties the caller's inbox, and only the caller's |
| `/v1/notify` `{kind, text, positionId?}` | appends to `notify.jsonl`, at most 5 per hour per agent (kept here too, not only in the role) |
| `/v1/replies/take` `{}` | the person's replies to the caller |

The agent is the token's, never a field of the request: a body with an extra
field is refused (400). Status codes: 401 no or unknown token, 403 a tool the
role does not have, 404/405/415/413 wrong shape, 429 notification limit.

## The role's side

With `JHT_HUB_URL=http://127.0.0.1:<port>` and `JHT_HUB_TOKEN=<token>`, the
runtime builds the same tools as with a database of its own (the model sees
the same specs) and sends the database ones to the hub; the mailbox, the
notifications and the replies go there too. It opens no database and creates
no `channels/`. The URL must be a loopback address: the token travels in
clear.

## Deploying it (VPS)

- **Container:** the `jht-api` image, `npm run hub`, in the pod (`--pod`), its
  own uid (not a role's), `--read-only --security-opt no-new-privileges --cap-drop=all`.
- **Mounts:** `jobs.db`'s folder and `channels/` read-write, a state folder of
  its own read-write, the profile read-only, the token file read-only.
- **Environment:** `JHT_HUB_TOKENS` (the file), `JHT_HUB_DB`, `JHT_HUB_CHANNELS`,
  `JHT_HUB_STATE`, `JHT_HUB_PORT` (default 8788), `JHT_API_PROFILE_DIR`,
  `JHT_API_APP_ROOT=/app`.
- **Tokens:** one per agent id, random (`openssl rand -hex 32`), written by
  the host into `{ "<token>": "<agent>" }`, readable by the hub's uid only.
  Each role's container gets only its own, as `JHT_HUB_TOKEN`. An agent with
  two tokens, or a token shorter than 32 characters, and the hub does not start.
- **Roles:** no `jobs.db`, no `channels/`, no `JHT_API_DB`; `JHT_HUB_URL` and
  `JHT_HUB_TOKEN` instead, and they run in the pod to reach the loopback
  (a mock run too: the mock provider calls nothing).
- **Check inside a role's container:** `node:sqlite` finds no `jobs.db`, no
  inbox is on disk, and its token used for another role's operation gets 403.

`tests/hub.test.ts` covers the protocol, the rights per role, the channels,
and a mock SCORER cycle through the hub with no database on the role's side.
