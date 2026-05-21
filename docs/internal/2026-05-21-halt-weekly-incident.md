# HALT-WEEKLY incident — 2026-05-21

Manovra di emergenza sulla VPS1 (`203.0.113.20`, Hetzner CPX22) per evitare la saturazione del weekly cap Codex ProLite osservato al **96% alle 06:57 UTC** con burn rate sostenuto a **~2.7 %/h** (proiezione esaurimento entro 90 min). Reset weekly previsto al 26/05 20:16 UTC (mancavano ~133 h).

**Tutte le modifiche descritte sotto sono transitorie**, applicate solo sull'istanza viva VPS1, **non vanno persistite nel repo** (la stessa regola "STOP team" rotta la coordinazione su istanze future "normali"). Quando l'utente revoca l'halt, le modifiche scompaiono al primo respawn da container fresco / nuova VPS.

Questo documento esiste perché la diagnosi (math 5h↔weekly, regime "cauto") e i pattern operativi messi in piedi possono servire per il fix strutturale di [PACING-WEEKLY-EXHAUSTION] in `BACKLOG.md` (`docs/internal/2026-05-20-team-idle-gaps-investigation.md`).

---

## Timeline VPS1

| UTC | Evento |
|---|---|
| 06:57 | Snapshot Codex: weekly=96%, primary=88%, reset weekly = 26/05 20:16 |
| 07:13 | Spawn Dottore #1 (giro health-check standard → si autodistrugge) |
| 07:20 | Decisione utente: HALT team fino a reset weekly, solo Capitano + Sentinella + Assistente + Mentor restano. Regime "Q&A utente, niente produzione" |
| 07:21 | Spawn Dottore #2 con missione FASE 1 (respawn Capitano con context fresco + handoff con direttiva HALT) |
| 07:23 | Capitano respawnato, riceve ordine HALT, crea `/jht_home/.weekly-halt.flag`. Notifica utente NON inviata (welcome flag già presente → idempotenza welcome rispettata) |
| 07:25 | Kill manuale (Claude diretto, no Dottore per non sprecare token) di: SCOUT-1/2, SCORER-1, SCRITTORE-1/2/3, CRITICO-S3. Handoff e snapshot in `/jht_home/.<agent>-handoff.md` + `/jht_home/.<agent>-snapshot.txt` |
| 07:25 | Kill bridge daemons: `pacing-bridge.py`, `sentinel-bridge.py`, `agent-watchdog.sh`, `doctor-watchdog.sh`. Preservati: `token-meter` (solo metrica), `tg-bridge` × 3 (per Q&A utente) |
| 07:30 | Update direttamente in `/jht_home/agents/*/AGENTS.md` (Capitano, Sentinella, Assistente, Mentor): regola PRIMARIA `*-00 WEEKLY BUDGET GUARD` + math 5h↔weekly + regime cauto. Skill `weekly-budget-monitor` distribuita in `.claude/skills/` + `.agents/skills/` dei 4 agenti. **`/app/agents/` (image-layer) NON è bind mount → le edit a `capitano.md` sorgente NON arrivano automaticamente; vanno copiate direttamente nei runtime workdir `/jht_home/agents/<agente>/AGENTS.md`.** |
| 07:30 | Kill+respawn dei 4 agenti rimanenti per leggere il nuovo AGENTS.md. Welcome idempotente (flag già presenti) → niente ulteriore notifica utente |

## Stato finale VPS1 (post-incident)

Sessioni tmux vive:
- `CAPITANO`, `ASSISTENTE`, `MENTOR`, `SENTINELLA` — tutti in idle Codex, in attesa di input utente via `tg-bridge`.

Bridge attivi:
- `tg-bridge` × 3 (assistente/capitano/mentor) — canali Telegram preservati.
- `token-meter.py` — solo scrittura CSV, non risveglia agenti.

Marker:
- `/jht_home/.weekly-halt.flag` (touch vuoto).
- `/jht_home/handover.md` — direttiva persistente.

## Math 5h primary ↔ weekly (riusabile per fix strutturale)

- Primary cap: 300 min / 5 h.
- Weekly cap: 10080 min / 168 h.
- Weekly = **33.6 × primary**.
- **1 % primary ≈ 3 min ≈ 0.03 % weekly**.
- **1 % weekly ≈ 33.6 % primary**.
- Una finestra primary saturata = **3 % weekly**.

Per H24×7gg sostenibile (rate target weekly 100 %/168 h ≈ 0.6 %/h): primary medio < **20 %/h** ≈ chiusura finestra primary 5h al **~25 %** invece dei classici 92 % (target band attuale).

A 96 % weekly con 133 h al reset: budget residuo = 4 % ≈ ~80-100 turn lunghi OR ~300-400 turn corti per l'intero team.

## Regime "cauto" (template da estrarre per future skill)

Inserito nei 4 prompt vivi (Capitano C-00, Sentinella step 0, Assistente A-00, Mentor M-00):

1. Rispondi all'utente — HALT ≠ mute. Risposte brevi (lungo = 33× weekly).
2. Tra turn utente: idle. No background work, no checkin proattivo, no analisi spontanea.
3. Prima di compute non-banale (multi-file read, DB scan, generazione > 1k token): re-check `weekly-budget-monitor`, warn utente con `weekly_used%`, offrire defer.
4. Forbidden: spawn agenti, ordini operativi, `pipeline-triage`, `bridge-pacing` enforcement (i bridge sono OFF; silenzio sui canali = atteso, non da investigare).
5. Auto-resume vietato anche dopo reset weekly: solo ordine esplicito utente (`"riprendi team"`, `"resume team"`).

## Bug noti rilevati durante l'incidente (NON blocking durante HALT)

- `pipeline-triage/SKILL.md` (Capitano) — YAML invalid line 2 col 514 → skill skipped al boot.
- `spawn-agent/SKILL.md` (Capitano) — YAML invalid line 2 col 280 → skill skipped al boot.
- `profile-yaml/SKILL.md` (Assistente) — YAML invalid line 2 col 337 → skill skipped al boot.

Da fixare quando saremo fuori HALT (preferibilmente prima del prossimo team production-spawn). Non bloccano l'attuale operatività perché in HALT le skill `pipeline-triage` e `spawn-agent` sono comunque inibite dalla regola C-00.

## Lezioni per il fix strutturale di [PACING-WEEKLY-EXHAUSTION]

1. **Math weekly va monitorato nativamente**: il `sentinel-bridge` attuale guarda solo il primary 5h. Lo snapshot `codex.rate_limits` espone BOTH (primary+secondary). Aggiungere parsing della `secondary` nel bridge è ~10 righe di codice.
2. **Soglie operative reali**: 80 % weekly = throttle 4, 90 % weekly = HALT operativi soft, 95 % = HALT-HARD + notifica utente, 99 % = freeze (provider rifiuterà). La skill `weekly-budget-monitor/SKILL.md` deployata in VPS contiene una decision table riusabile.
3. **Halt deve essere idempotente e marker-based**: un flag file (`.weekly-halt.flag`) sopravvive a respawn, è leggibile dal Capitano al boot, blocca `pipeline-triage` con un singolo if all'inizio del turn. Più affidabile di "ricordare lo stato".
4. **Bridge daemon hanno costo non zero**: anche con team operativo killato, `pacing-bridge` + `sentinel-bridge` mandano tick ogni 15/10 min al Capitano vivo, che fa ~1 turn ognuno → ~6-9 % primary/h sprecato. In modalità HALT vanno spenti o silenziati. Da considerare per il fix.
5. **Welcome flag rispetta l'idempotenza**: i flag `*-welcomed.flag` già esistenti hanno evitato spam Telegram al respawn dei 4 agenti — pattern già funzionante.
6. **`/app/agents/` è image-layer, non bind mount**: edit ai sorgenti `<agent>.md` non arrivano runtime senza respawn (`start-agent.sh` li copia in `/jht_home/agents/<agente>/AGENTS.md`). Per hot-patch va modificato direttamente l'AGENTS.md runtime + respawn dell'agente per applicare. Da documentare in `docs/internal/INFRA.md` se non già presente.

## Riferimenti

- `BACKLOG.md` — entry `[PACING-WEEKLY-EXHAUSTION]` (P0).
- `docs/internal/2026-05-20-team-idle-gaps-investigation.md` — analisi gap pre-incident.
- `docs/internal/2026-05-20-agent-context-saturation.md` — PoC restart agenti (pattern usato per FASE 1 del Dottore).
