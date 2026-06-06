<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: spawn-doctor
description: Spawna un DOTTORE fresco on-demand quando tu (Capitano/Assistente/Sentinella/Mentor) hai bisogno di un giro di health-check immediato. Usa questa skill INVECE di scrivere nella sessione DOTTORE quando l'utente chiede "fai partire il dottore" / "dottora" / "controlla il team", perche' tra un round schedulato e l'altro la sessione DOTTORE e' bash residua (lifecycle one-shot, ~10 min attivi + ~110 min di sleep per il prossimo spawn del ciclo 2h).
allowed-tools: Bash(/app/.launcher/spawn-doctor.sh *), Bash(tmux *), Bash(jht-tmux-send *)
---

# spawn-doctor — chiamata di emergenza al Dottore

## Perche' esiste

Il **doctor-watchdog** spawna automaticamente un DOTTORE ogni 2 ore
(cadenza scelta 2026-05-18 per ridurre il token waste: 12 spawn/day
invece di 48). Tra uno spawn e il successivo la sessione tmux
`DOTTORE` esiste ma e' "bash residua" (il Dottore precedente si e'
auto-distrutto a fine giro). Mandare un `[URG]` o `[HEALTH]` a quella
sessione e' **inutile**: il messaggio finisce nella bash e nessuno lo
legge.

Caso classico (post-mortem `2026-05-18-capitano-zombie-night`):
l'Assistente ha mandato 2 URG al Dottore alle 06:08/06:09 perche'
l'utente l'aveva chiesto, ma il Dottore precedente si era
auto-distrutto alle 05:48 → 2 URG persi nel vuoto, il Capitano e' rimasto
zombie altri ~20 min finche' l'Assistente non ha capito di dover
agire direttamente.

Questa skill chiude il loop: invece di "parlare a un Dottore morto",
**ne spawno uno nuovo** subito.

## Chi puo' usarla

I 4 agenti coordinatori long-lived:
- 👨‍✈️ **Capitano** — quando rileva worker zombie e vuole un secondo paio
  di occhi prima di respawnare lui stesso.
- 💬 **Assistente** — quando l'utente chiede "fai partire il dottore" o
  "controlla il team" via Telegram/chat.
- 🧙‍♂️ **Mentor** — quando in un digest settimanale rileva pattern anomali
  e vuole una verifica salute infrastruttura.
- 💂 **Sentinella** — quando un agente smette di consumare token
  inaspettatamente in piena finestra produttiva.

Gli altri agenti (Scout, Analista, Scorer, Scrittore, Critico) **NON**
hanno questa skill: se vedono un problema, lo riportano al Capitano
via `[REPORT]` e lasciano a lui la decisione.

## Come usarla

```bash
# Spawn one-shot. Lo script e' idempotente: killa ogni DOTTORE* esistente
# prima di crearne uno nuovo, quindi puoi chiamarlo senza paura di
# duplicati.
bash /app/.launcher/spawn-doctor.sh
```

Output atteso:
```
[spawn-doctor] killing old session: DOTTORE     (se presente)
[spawn-doctor] DOTTORE avviato — workdir=/jht_home/agents/dottore — round=YYYYMMDDTHHMMSSZ-spawn
```

Il nuovo DOTTORE LLM (Codex/Kimi/Claude in base a `active_provider`)
parte in ~6-10 secondi, legge `AGENTS.md` (= prompt del Dottore), e
inizia il giro di health-check. Self-destruct alla fine.

## Dopo lo spawn — interagisci attraverso il Dottore (non da solo)

```bash
# 1. Spawn
bash /app/.launcher/spawn-doctor.sh

# 2. Attendi 8-12s che il LLM sia pronto a ricevere
sleep 10

# 3. Manda un [REQ] mirato (il Dottore fara' la sua procedura standard,
#    ma puoi orientarlo se hai un sospetto preciso).
jht-tmux-send DOTTORE \
  "[@$MY_ID -> @dottore] [REQ] Round mirato: il Capitano non risponde da
   ~30 min, capture-pane mostra solo bash. Verifica e respawn se zombie.
   Riporta a me con [RES] alla fine."

# 4. Aspetta [RES] del Dottore (~10 min budget standard) — non polling
#    aggressivo. Il Dottore stesso logghera' eventi in
#    /jht_home/logs/dottore-actions.jsonl quando agira'.
```

## Quando NON usarla

- ❌ Worker zombie e tu sei il **Capitano**: respawnalo direttamente via
  skill `spawn-agent` + kick-off resume. Non serve scomodare il Dottore.
  Il Dottore e' per problemi che richiedono LLM di alto livello
  (diagnosi token spike, deadlock subtle, prune cache cross-system).
- ❌ Loop di richieste: se hai gia' fatto `spawn-doctor` negli ultimi
  15 min, aspetta. Spawnare un nuovo Dottore mentre il precedente sta
  ancora lavorando lo killa (lo script e' idempotente con
  `kill-session` upfront) — perderesti tempo e budget.
- ❌ Senza ragione concreta: il Dottore costa ~3-5% di budget Kimi a
  giro. Non spawnarlo "per controllare se va tutto bene" — c'e' gia' il
  doctor-watchdog ogni 2h per quello. Spawnalo quando hai un evento
  specifico da investigare.

## Anti-patterns

- ❌ `jht-tmux-send DOTTORE "[URG] ..."` senza prima spawnare — exit 0
  ma messaggio perso nella bash residua. Errore storico osservato
  2026-05-18 06:08-06:09 UTC.
- ❌ Spawnare manualmente con `tmux new-session -d -s DOTTORE` — bypassa
  il prompt sync `AGENTS.md` + log JSONL + cleanup. Usa SEMPRE
  `spawn-doctor.sh`.
- ❌ Aspettarsi che il Dottore risolva un task non-health (es. "scrivi
  un CV"). Il Dottore e' single-purpose: liveness + cache-prune +
  py-tools-audit + cv-disk-audit. Non altro.

## Vedi anche

- `agents/dottore/dottore.md` — prompt del Dottore, lifecycle one-shot
- `agents/_skills/liveness-check/SKILL.md` — diagnosi che il Dottore esegue
- `.launcher/spawn-doctor.sh` — script idempotente (rev. legacy 2026-05-08)
- `.launcher/doctor-watchdog.sh` — loop cadenza 2h (post-mortem 2026-05-18)
- `docs/sessions/2026-05-18-capitano-zombie-night/README.md` — caso che ha originato questa skill
