---
name: scout-coord
description: Boot-time coordination protocol between multiple Scouts. Without this skill two scouts crawl the same circle (Remote EU) on the same tier (LinkedIn) and produce 100% duplicates that the dedup gate then has to drop — wasted budget and slower team. Use it as the FIRST action in your loop, before anything else. Owned by the Scout role; SCOUT-1 typically arbitrates if multiple scouts boot simultaneously.
allowed-tools: Bash(python3 /app/shared/skills/scout_coord.py *), Bash(tmux *), Bash(jht-tmux-send *)
---

# scout-coord — partition the territory

Multiple Scouts run in parallel (max 2 instances by team policy). The team works only if they agree on a **non-overlapping partition** of:
- which **circles** each owns (1 = primary preference, 2 = geo neighbours, 3 = relocation, 4 = satellite, 5 = frontier)
- which **source tiers** each owns (LinkedIn / ATS aggregators / niche / WebSearch)

The state lives in a small JSON managed by `scout_coord.py`; the scouts negotiate via tmux at boot and persist the agreement there.

## Step 1 — Discover peers

```bash
tmux list-sessions 2>/dev/null | awk -F: '{print $1}' | grep -E '^SCOUT-[0-9]+$'
```

If you are the only scout listed → no negotiation needed, claim everything you can handle. Skip to Step 4.

If others are listed → you must negotiate (Steps 2-3) before scraping anything.

## Step 2 — Reset stale state

If the previous scout team crashed mid-loop, `scout_coord.py` may hold stale assignments referring to dead sessions. Wipe them:

```bash
python3 /app/shared/skills/scout_coord.py reset
```

This is a coordinated step: the **lowest-numbered live SCOUT** (usually `SCOUT-1`) does the reset, the others wait. Announce it on tmux:

```bash
jht-tmux-send SCOUT-2 "[@$MY_ID -> @scout-2] [INFO] resetto scout_coord, attendi 5s prima di assign"
```

## Step 3 — Negotiate via tmux

Open a short conversation (3-5 messages max) with each peer. Propose a split:

```
[@scout-1 -> @scout-2] [REQ] proposta: io prendo cerchi 1+2 + tier 1-2 (LinkedIn, ATS).
Tu cerchi 3+4 + tier 3-4 (niche board + WebSearch). OK?
```

Peer answers with `[ACK]` (accept) or `[COUNTER]` (counter-proposal). Keep it short — if you can't agree in 3 round-trips, escalate to the Capitano.

**Heuristics for a good split**:

| Situation                                       | Suggested split                                                    |
|-------------------------------------------------|--------------------------------------------------------------------|
| 2 Scouts, profile `work_mode = remote`          | S1: cerchi 1-2 + LinkedIn/ATS · S2: cerchi 1 + niche remote board (RemoteOK, WeWorkRemotely) — both in cerchio 1, complementary sources |
| 2 Scouts, profile `work_mode = on-site`         | S1: città base + cerchio 2 regionale · S2: relocation (cerchio 3) |
| 2 Scouts, mixed `work_mode = flessibile`        | S1: cerchi 1-2 (full mode) · S2: cerchi 3-5 (relocation + satellite + frontier) |

Whichever split you pick, the rule is: **no two scouts on the same (circle, tier_set) combination at the same time.**

**Volume vs curated split — empirico dal run VPS1 2026-05-21 (vps1-run-postmortem #14):**

> Scout-1 trovava 130 position con score avg 63.1 (40% high-score)
> Scout-2 trovava 76 position con score avg 68.4 (54% high-score)
>
> → Scout-2 era 1.4× più qualitativo di Scout-1 sullo stesso candidato.

Pattern raccomandato quando si ha la libertà di scegliere il tier per i 2 scout:

| Scout    | Tier assegnato                                          | Razionale                                      |
|----------|---------------------------------------------------------|------------------------------------------------|
| SCOUT-1  | LinkedIn (alto volume, noisy)                           | Cattura il flusso, accetta lo score medio basso|
| SCOUT-2  | Ashby / Greenhouse / Lever / company-careers (curated)  | Pochi ma giusti, score medio più alto          |

Il `next-for-analista` riceve poi un mix bilanciato di volume + qualità, e il filtro hard-requirements dell'Analista (RULE-06) si concentra sul Scout-1 stream (dove c'è più rumore). Non e' una regola rigida — adattare al `work_mode` come da tabella sopra.

## Step 4 — Solidify the assignment

Once you and your peers agree, persist the partition:

```bash
python3 /app/shared/skills/scout_coord.py assign $MY_ID \
    --cerchi "<cerchi assegnati a te, es. 1,2>" \
    --fonti "<slug fonti assegnate, separate da virgola, es. linkedin,greenhouse,lever>"
```

Each scout writes their own line. The script enforces no-overlap on the source slugs, so if two scouts try to claim `linkedin` simultaneously the second one fails — the loser must re-negotiate.

## Step 5 — Verify

```bash
python3 /app/shared/skills/scout_coord.py show
```

Expected output: one line per live scout with their `cerchi` and `fonti`. If your line is missing, your `assign` failed silently — repeat Step 4.

Cross-check: the union of all `fonti` should cover the tiers the team actually wants to scrape today. If a tier has zero scouts (e.g. nobody is on `niche-remote`), notify the Capitano:

```bash
jht-tmux-send CAPITANO "[@$MY_ID -> @capitano] [INFO] scout-coord: tier 'niche-remote' senza scout, considera spawn aggiuntivo o riassegnamento."
```

## Anti-patterns

- ❌ Skipping Step 1 ("there's only me") without checking — a peer might have just been respawned by the Dottore.
- ❌ Reset performed by every scout in parallel — race condition, the JSON ends up corrupted. Lowest-numbered scout only.
- ❌ Negotiating then forgetting Step 4 — the JSON is empty, peers can't see your claim, two scouts hit the same source.
- ❌ Claiming both `linkedin` AND `greenhouse` AND `lever` AND `remoteok` AND `weworkremotely` AND `webresearch` "to be safe" — nothing to share with the peer, they have nothing to do.
- ❌ Re-negotiating mid-loop without a trigger — the partition is boot-time. If a peer dies the Dottore respawns them with the same role; only the SCOUT itself reads its `cerchi`/`fonti` again at boot.

## When to re-negotiate

Only on these triggers:
- A new SCOUT just booted (you see `SCOUT-N+1` in `tmux list-sessions` that wasn't there at your boot)
- A SCOUT died and was NOT respawned (capacity dropped, redistribute its tier)
- Capitano explicitly orders a re-partition (rare, e.g. after a `[FEEDBACK]` from Analyst that one tier is consistently producing dead links)

In all three cases: short tmux exchange, then re-`assign` with new params. No need to `reset` unless the JSON is visibly corrupted.

## See also

- `circles-and-sources` — the actual definition of the 5 cerchi + 4 tier of fonti (this skill is HOW to partition; that one is WHAT to partition).
- `position-insert` — what each Scout does once it has its assignment.
- `agents/_manual/anti-collision.md` — the broader anti-collision contract this skill implements for the Scout role.
- `tmux-send` — message envelope for the negotiation.
