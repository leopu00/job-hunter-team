# 🔍 Incident & Root-Cause — Overspawn + saturazione weekly Codex (VPS andris)

> **Data analisi:** 2026-06-11
> **VPS:** `5.78.124.70` (`ubuntu-2gb-hil-1-andris`, Hetzner Hillsboro, 2 GB)
> **Container:** `jht` — `ghcr.io/leopu00/jht:latest` (image build **2026-06-05 14:35 UTC**)
> **Provider:** Codex oauth, piano **prolite** · TZ host/container **UTC**
> **Tutti gli orari nel doc sono UTC** salvo diversa indicazione.
> Diagnosi ricostruita **interamente dai rollout Codex** (`~/.codex/sessions/`), che sono persistenti e intatti.

---

## 🧭 TL;DR

1. Dopo la nuova immagine del **05/06**, il numero di agenti è cresciuto **6 → 16** in 3 giorni.
2. Il **weekly budget Codex è arrivato al 100% il 07/06 17:11** → **HALT forzato di ~3,5 giorni** (08–10/06), Dottore incluso (ogni sua sessione sbatteva subito sul rate-limit).
3. La ripresa è avvenuta **11/06 06:00 UTC** = **08:00 Europe/Rome** (reset weekly Codex, che coincide con l'inizio working-hours). **Nessun bug di orario.**
4. **Causa radice NON è "scaling aggressivo".** È un **falso positivo di diagnosi**: il Capitano scambia lo stato `Working (Xs • esc to interrupt)` della TUI codex per un "pager/vista morta" e **rimpiazza un agente vivo**, lasciando l'originale acceso (zombie) a bruciare budget.
5. **Oggi (11/06) il pattern NON si è ripetuto** grazie a una regola conservativa del Dottore già attiva (`non ricettivo → ambiguous, niente respawn`) — ma la giornata era anche a bassa attività, quindi non è ancora uno stress-test.

---

## 📅 Timeline

### Crescita agenti (sessioni tmux, da `start-agent.sh`, solo-Capitano)

| Quando | Spawn | Totale |
|---|---|---|
| 05/06 14:39 (boot launcher) | ASSISTENTE, CAPITANO, SENTINELLA | 3 |
| 05/06 14:59 / 15:14 / 17:46 | analista 1, scorer 1, scorer 2 | 6 |
| 06/06 06:00–15:23 | analista 2, scout 1, scout 2, analista 3, scout 3 | 11 |
| 07/06 10:31–16:15 | scout 4, analista 4, scout 5, scout 6, MENTOR | **16** |

> Gli spawn erano **distanziati ore** l'uno dall'altro → la regola "1 spawn per tick, ~5 min" NON è stata violata. Non è stato un loop aggressivo.

### Usage weekly Codex (picco giornaliero, da `rate_limits` nei rollout)

| Giorno | weekly max | Note |
|---|---|---|
| 03/06 | 19% | |
| 04/06 | 31% | |
| 05/06 | 59% | 🆕 nuova immagine, parte l'accumulo |
| 06/06 | 79% | |
| **07/06** | **100%** ⛔ | esaurito **17:11:45 UTC** |
| 08–10/06 | maxed | HALT — solo tentativi Dottore, tutti `rate_limit_reached` |
| 11/06 | 7% | dopo reset weekly |

### Lo stop (gap di attività produttiva)

- Ultima transizione di stato prima dello stop: **07/06 17:24:53** (`analista-4`).
- Ripresa: **11/06 06:01:56** (`scorer-2`).
- Gap reale: **3 giorni 12h 37m**. Durante 08–10/06: 0 posizioni, 0 scoring, 0 transizioni.
- Prova che il Dottore **non** lavorava: errori nei rollout → 07/06 `rate_limit_reached: 443`; 08/06–10/06 `rate_limit_reached: 6` (= 1 per ognuno dei 6 tentativi/giorno, tutti falliti).

---

## 🎯 Causa radice — falso positivo "pager", NON pager reale

Quello che il Capitano chiama "pager/scroll/vista" è in realtà lo **stato normale `Working (Xs • esc to interrupt)`** della TUI codex (agente a metà turno). La riga `› Run /review on my current changes` che compariva nei pane è la **frase-segnaposto del composer vuoto di codex** (come `Implement {feature}`), non testo dell'agente.

### Evidenza chiave — sequenza SCOUT-1 → SCOUT-2 (06/06)

Dal rollout del Capitano (`rollout-2026-06-05T14-39-58...`):

| Ora | Evento |
|---|---|
| 08:55:34 | invia msg a SCOUT-1; pensa *"SCOUT-1 risulta vivo ma in una **vista/pager**"* |
| 08:55:41 | 3 retry interni; *"attendo l'esito… dato il pager"* |
| 08:55:52 | *"SCOUT-1 **non è ricettivo** dopo 3 tentativi"* → decide lo spawn |
| 08:55:53 | `bash /app/.launcher/start-agent.sh scout 2` |

➡️ **18 secondi** di pazienza per un agente che stava solo finendo un turno.

### Il bug meccanico in `jht-tmux-send`

Logica dello script (`/app/agents/_skills/tmux-send/jht-tmux-send`):
1. digita il testo nel pane → verifica che la **firma del testo compaia** (match diretto);
2. se compare → manda Enter (submit);
3. **se NON compare dopo 3 retry → `exit 3` "TUI irricettiva"**.

Quando la TUI codex è in `Working…`, il composer **non eco-a** il testo digitato → la firma non compare mai → **exit 3**. Lo script non distingue **"busy" da "morta"**.

### Catena causale completa

```
1. Agente in turno lungo → TUI mostra "Working (Xs • esc to interrupt)"
        ↓
2. jht-tmux-send digita nel composer occupato → testo non eco-ato
        ↓
3. 3 retry rapidi falliscono → exit 3 "TUI irricettiva"
        ↓
4. Capitano interpreta exit-3 + "Working" come "vista/pager" → agente "morto"
        ↓
5. Policy "non killo un agente vivo" → spawna un RIMPIAZZO
   (giusto non killare… ma l'agente era VIVO, solo busy)
        ↓
6. L'originale finisce il turno secondi dopo → orfano, task spostato al clone,
   continua a girare e a consumare token (zombie burn)
        ↓
7. Ripeti per ogni ruolo → 6 SCOUT, 4 ANALISTA → weekly 31% → 100%
```

### Viola la sua stessa skill

`spawn-agent/SKILL.md` dice testualmente:
> ❌ *"Restart a working agent because it looks slow. **Slow ≠ dead. Long turns with visible token output are not a spawn case** — they are a liveness-check case (Dottore)."*

Il Capitano ha fatto esattamente questo.

### Concausa di contesto: pacing weekly a metà migrazione

La Sentinella fa pacing sulla finestra **5h** (`proj` = 5h), trattando il **weekly come riga INFO**. Tenendo il 5h sempre <100% ha lasciato salire il weekly indisturbato. Vedi `pacing-migration-plan-2026-06-05.md` (Phase 0+1 "da validare su VPS nuova", deployato non validato). Questo ha permesso allo zombie-burn di arrivare al 100% senza che nessun guardrail lo fermasse.

---

## ✅ Come è andata oggi (11/06)

| Metrica | 06/06 (incidente) | 11/06 (oggi) |
|---|---|---|
| Spawn `start-agent.sh` | 12 rimpiazzi falsi | **0** |
| Capitano "vista/pager" | ricorrente | **0** |
| Crescita agenti | 6 → 16 | stabile |
| Weekly | 31% → 100% | ~7% piatto |

**Perché:** regola conservativa nuova del Dottore, già attiva (dai suoi log di oggi):
> *"i casi non ricettivi vengono marcati `ambiguous` **senza respawn**"*
> *"`node` è già trattato come CLI vivo"*
> *"ACK di CAPITANO ricevuto; lo considero **evidenza di liveness** oltre alla capture"*

È il fix giusto in direzione "busy ≠ morto", **già parzialmente applicato**.

🟡 **Caveat:** oggi era anche a **bassa attività** (code spesso vuote, pochi dispatch) → meno collisioni kick-off↔agente-busy a prescindere. **Non è ancora uno stress-test** ad alta attività.

---

## 🔧 Fix raccomandati (in ordine di priorità)

1. **`jht-tmux-send` deve gestire lo stato busy**: se rileva `Working … esc to interrupt`, **attende** il ritorno al prompt idle (poll) prima di digitare, invece di fallire con exit 3. Distinguere "busy" da "morta".
2. **Capitano: exit-3 / `Working` = VIVO-occupato**, non trigger di spawn. Delegare al Dottore (`liveness-check`) e alzare la soglia di pazienza da ~18s a minuti. *(Parzialmente coperto dalla regola `ambiguous` del Dottore.)*
3. **Reaping**: se un rimpiazzo avviene comunque, il vecchio agente va **terminato** (non lasciato zombie). Con 1 e 2 corretti, diventa raro.
4. **Pacing weekly-aware**: completare/validare la migrazione (`pacing-migration-plan-2026-06-05.md`) così la Sentinella ancora le decisioni al **weekly**, non alla 5h. Guardrail anti-100%.
5. **Cap spawn** come backstop (es. max N SCOUT/ANALISTA finché 1–4 non sono validati sotto carico). Cerotto, non cura.

---

## 🛡️ Mitigazioni temporanee applicate (11/06)

> ⚠️ Stato come da sessione di analisi dell'11/06. Sono **reversibili**.

1. **Firewall verso Codex (DNS sinkhole in `/etc/hosts` del container)** — aggiunto `0.0.0.0`/`::` per `chatgpt.com` e `api.openai.com`. Verificato: entrambi → `000` (bloccati) → **zero usage** anche se gli agenti girano. Applicato come root (`docker exec -u root`). **Si auto-azzera al restart del container** (Docker rigenera `/etc/hosts`) — comportamento voluto: al deploy del fix si riparte pulito.
2. **`jht team stop --all`** — fermati i 15 worker. **Nota:** i watchdog del launcher (`agent-watchdog.sh`, `doctor-watchdog.sh`, `sentinel-bridge.py`, `pacing-bridge.py`, `tg-bridge.py`) **rispawnano in automatico i core (CAPITANO/MENTOR/ASSISTENTE)** → il `team stop` da solo non "tiene"; il blocco effettivo del budget è il **firewall**. Per silenziare anche i watchdog serve `docker stop jht`.

### Per riprendere dopo il fix
```bash
# rimuovere il sinkhole (o semplicemente: docker restart jht, che lo azzera)
docker exec -u root jht sed -i '/chatgpt.com/d;/api.openai.com/d' /etc/hosts
docker exec jht node /app/cli/bin/jht.js team start
```

---

## 📌 Note operative apprese

- I **rollout Codex** (`~/.codex/sessions/AAAA/MM/GG/*.jsonl`) sono la fonte di verità per la diagnosi: contengono ragionamento, `exec_command`, `capture-pane` con output, e le letture `rate_limits` (primary=5h, secondary=weekly). Più ricchi dello scrollback tmux.
- `jht team stop` chiude le **sessioni live** degli agenti → il contesto in-sessione si perde (i file/DB restano). Non usarlo se quelle sessioni servono per diagnosi live.
- Reset weekly Codex prolite: **giovedì 06:00 UTC** (= 08:00 Europe/Rome). `working_hours` config = `Europe/Rome 08:00–20:00`, 7/7.
