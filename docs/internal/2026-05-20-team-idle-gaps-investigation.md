# 2026-05-20 — Team idle gaps investigation (WORK IN PROGRESS)

> **Status: INDAGINE NON CONCLUSIVA.** Le ipotesi documentate qui sono state
> elaborate sotto pressione interpretando dati parziali, e parte sono state
> già smentite dai fatti misurati. Vanno riviste a freddo prima di tradurle
> in fix di prodotto. Le sezioni `Ipotesi A/B/C` sono **da elaborare**, non
> rappresentano la verità.

## Context

Dal grafico Hetzner del CPX22 `ubuntu-4gb-fsn1-2` (VPS1) si osservano
oscillazioni CPU con valli profonde, e visivamente almeno due regimi
distinti:

- **20:55 → ~04:00 UTC**: oscillazione abbastanza uniforme (20-80%) con
  piccole pause tra picchi.
- **~04:00 UTC → ora**: pattern picco→zero→picco con stalli ben più lunghi.

L'utente ha chiesto di capire cosa è successo prima delle 04:00 che ha
portato a questo cambio di regime.

## Misurazione effettuata

Script `/tmp/peek-gaps.js` esegue contro `/jht_home/.codex/logs_2.sqlite`
una query per estrarre tutti i `session_task.turn` distinti per timestamp
nel range `2026-05-19T20:55 → 2026-05-20T10:00 UTC`, e trova i gap > 5 min
tra turn consecutivi.

**Risultato: 31 gap > 5 min, totale ~8h15m di stasi su ~13h di operatività**.

### Lista completa dei gap (turn codex)

| # | start gap (UTC) | end gap (UTC) | durata |
|---|---|---|---|
| 1 | 21:09:00 | 21:28:11 | 19m11s |
| 2 | 21:39:13 | 21:44:49 | 5m36s |
| 3 | 21:46:40 | 21:58:01 | 11m21s |
| 4 | 22:08:00 | 22:13:15 | 5m15s |
| 5 | 22:16:56 | 22:23:33 | 6m37s |
| 6 | 22:25:45 | 22:35:08 | 9m23s |
| 7 | 22:40:37 | 22:45:51 | 5m14s |
| 8 | 22:48:57 | 22:55:34 | 6m37s |
| 9 | 22:57:04 | 23:02:09 | 5m05s |
| 10 | 23:02:24 | 23:07:26 | 5m02s |
| 11 | 23:08:52 | 23:13:59 | 5m07s |
| 12 | 23:23:51 | 23:29:27 | 5m36s |
| 13 | 00:39:11 | 00:47:23 | 8m12s |
| 14 | 01:00:37 | 01:08:10 | 7m33s |
| 15 | 01:19:26 | 01:31:32 | 12m06s |
| 16 | 01:31:36 | 01:37:09 | 5m33s |
| 17 | 01:44:25 | 01:49:33 | 5m08s |
| 18 | **02:05:17** | **02:49:41** | **44m24s** ⬅️ primo gap "grande" |
| 19 | 03:04:12 | 03:32:37 | 28m25s |
| 20 | 03:46:26 | 03:59:50 | 13m24s |
| 21 | **04:22:54** | **05:23:01** | **60m07s** ⬅️ il più lungo |
| 22 | 05:47:00 | 06:05:51 | 18m51s |
| 23 | **06:05:55** | **06:46:35** | **40m40s** (coincide con FREEZE emergenza 06:35) |
| 24 | 06:46:46 | 07:05:50 | 19m04s |
| 25 | **07:12:04** | **08:01:32** | **49m28s** (post redirect utente "basta legno") |
| 26 | 08:11:04 | 08:34:41 | 23m37s |
| 27 | 08:35:05 | 08:49:14 | 14m09s |
| 28 | **08:49:21** | **09:18:42** | **29m21s** |
| 29 | 09:23:31 | 09:33:14 | 9m43s |
| 30 | 09:34:16 | 09:43:24 | 9m08s |
| 31 | 09:49:19 | 09:54:48 | 5m29s |

Fino al gap #17 (01:49 UTC) i gap sono tutti < 13 min. Dal gap #18 (02:05)
iniziano i gap "grandi" (44m, 28m, 60m, 40m, 49m, 29m). Cambio di regime
visualmente confermato.

## Eventi inter-agent rilevanti misurati

### Prima del gap #18 (02:05→02:49) — chi parlava

Estratto del `codex/history.jsonl` (body intero, non `messages.jsonl.preview`
troncato):

```
[01:56:43] @critico → @scrittore-1 [RES] Review done. Score 7.0/10 — bb-italia-spa
[01:58:15] @critico → @scrittore-2 [RES] Review done. Score 5.5/10 — QC Technician feedback
[01:59:54] @critico → @scrittore-1 [RES] Review done. Score 7.5/10 — bb-italia v2
[02:01:51] @critico → @scrittore-2 [RES] Review done. Score 5.5/10 — Manufacturing QC v2
[02:03:46] @critico → @scrittore-1 [RES] Review done. Score 7.5/10 — bb-italia v3
[02:04:14] @dottore  → @capitano   [REPORT] Health round 1779242010 completato (checked 9, all alive)
[02:04:41] @critico → @scrittore-2 [RES] Review done. Score 6.0/10 (final) — QC Technician
[02:05:12] @capitano → @critico-s2 [URG] Sentinella Phase 2: RALLENTARE aumentato a 240s
                                    Prima del prossimo round usa jht-throttle-check/wait
                                    Dopo ogni round usa jht-throttle 240 --agent critico-s2
                                    Tool timeout 270s
[02:05:17] @critico-s2 → @capitano [ACK] RALLENTARE 240s received
                                    (No next round from this one-shot critic session)
[02:49:52] @critico → @scrittore-1 [RES] Review done. Score 7.5/10 — arbi-arredobagno
```

Tra `02:05:17` (ACK del Critico-s2) e `02:49:52` (prossimo RES) = **44m35s**
di silenzio. Allineato precisamente col gap #18.

### Prima del gap #21 (04:22→05:23) — chi parlava

```
[04:20:01] @scrittore-2 → @critico   [REQ] Review cieca ROUND 2/3 — #44 Openjobmetis
[04:22:04] @scrittore-2 → @critico   [REQ] Review cieca ROUND 3/3 FINALE — #44 Openjobmetis
[04:23:20] @scrittore-2 → @capitano  [REPORT] Position #44 Openjobmetis — verdict PASS
[04:23:58] @capitano   → @scrittore-2 [ACK] #44 Openjobmetis verificata: DB ready
— 04:30:00 pacing tick normale (ma team_kt scende a 0)
— 04:45:00 pacing tick SALTATO reason=insufficient_samples
— 05:00:00 pacing tick SALTATO reason=non_positive_delta delta_usage=0.0 team_kt=0
— 05:07:51 BRIDGE TICK formale → Sentinella (primo segnale di risveglio)
[05:08:00] @sentinella → @capitano  [INFO] TICK Phase 1 informativo, usage=63, proj=79
[05:09:13] @capitano   → @scout-2   [INFO] Start the main loop
[05:09:30] @capitano   → @scout-2   [INFO] KICKOFF RETRY
[05:13:59] @scout-2    → @analista  [INFO] Batch 5 posizioni inserite (IDs 46-50)
[05:23:02] @critico    → @scrittore-1 [RES] Review done — banyai-butorok
```

### Storia completa eventi RALLENTARE / jht-throttle

```
21:46:27 | 250s | Capitano → critico-s1 — "SFORO forte, top consumer critico-s1"
01:00:27 | 210s | Capitano → critico-s1 — "MARGINE, micro-rilascio"
01:31:32 | 240s | Capitano → critico-s2 — "Sentinella Phase 2: RALLENTARE"
02:05:12 | 240s | Capitano → critico-s2 — "RALLENTARE aumentato"   ⬅️ prima del gap #18
08:49:14 | 240s | Capitano → scrittore-1 — "Phase 2"                ⬅️ prima del gap #28
09:23:25 | 240s | Capitano → scrittore-1 — Phase 2 (di nuovo)
09:46:51 | 240s | Capitano → scrittore-2 — Phase 2
09:54:51 | 240s | Capitano → assistente  — Phase 2
09:56:54 | 240s | Capitano → mentor      — Phase 2
09:57:55 | 240s | Sentinella → Capitano — proj 123.77% ATTENZIONE → 240s per agente
09:58:57 | 240s | Capitano → scout-1     — Phase 2
```

## Semantica `jht-throttle` (letta dal source)

`/app/agents/_tools/jht-throttle` (verificato):

- `until = NOW + seconds` — **overwrite, non cumulativo**
- Cap massimo 1h (3600s)
- Il parent bash blocca per `seconds` in micro-sleep da 15s (mantiene
  l'agente bloccato per tutta la durata)
- Il child detached scrive `start`/`end` su `events.jsonl` indipendentemente
  dal timeout del provider

`/app/agents/_tools/jht-throttle-check`:

- Exit 0 se `NOW >= until` (file mancante o scaduto)
- Exit 1 se `NOW < until` → l'agente sa che DEVE chiamare `jht-throttle-wait`

`/app/agents/_tools/jht-throttle-wait`:

- Blocca finché `until` non è passato, in chunk da 15s
- Idempotente, exit 0 se non c'è file di stato

**Conseguenza**: `jht-throttle 240` blocca esattamente 240s. Più chiamate
ravvicinate non accumulano — l'ultima sovrascrive `until`. Quindi il
throttle non può, da solo, generare un gap di 60 min.

## Ipotesi formulate (DA ELABORARE)

### Ipotesi A (originale) — "Scout-1 ha esaurito le fonti del web"

**Dato che la falsifica**: Scout-2 alle 05:13:59 ha inserito 5 nuove
posizioni (IDs 46-50) cercando nelle stesse aree (furniture/wood IT/HU
+ audio/loudspeaker EU). Quindi le fonti **avevano ancora job**. Scout-1
non era saturato — semplicemente non stava cercando.

→ **Scartata.**

### Ipotesi B — "Deadlock di workflow"

L'idea era: A aspetta B, B aspetta A, nessuno parte. Però i log non
mostrano nessuno bloccato su un wait esplicito. Più precisamente non c'è
"deadlock" nel senso classico (mutex / lock contention).

→ **Termine sbagliato.** È più simile a "cooperative idle" — vedi C.

### Ipotesi C — "Throttle 240s spiega il gap 60m via N round × 240s"

Era: `5 positions × 3 round = 15 round × 240s = 60 min`. Matematicamente
plausibile come quadratura, ma **incompatibile col fatto che nei 60 min
non c'è stato 1 turn codex**. Throttle 240s dà 1 round ogni 240s (= 15
round in 60 min), non zero round.

→ **Scartata.**

### Ipotesi E (scoperta a posteriori, 2026-05-20 ~14:30) — "NO CV mode attivo"

**Causa primaria mai identificata nelle prime analisi.** Recuperato dal
log codex il body intero del messaggio utente delle 07:42 UTC del
2026-05-20:

> "ok, no cv, continua con ricerca di ruoli. considera le cose che ti
> ha detto il mentor"

44 secondi dopo il Capitano ha propagato URG a entrambi gli Scrittori:
> "Ordine utente: NO CV per ora. Non claimare nuove posizioni anche se
> scored >=50. Resta idle/gate Phase2 finché nuovo ordine esplicito."

**Conseguenza diretta**: dalle 07:42 UTC in poi gli Scrittori sono in
`gate Phase2` (idle by design). Un intero anello della pipeline non
lavora. Il throughput del team è **strutturalmente dimezzato**.

Tutti i gap successivi a 07:42 UTC vanno riletti con questa lente. In
particolare i gap "post emergency" del 06:35 e in poi sono **una
combinazione di NO CV + context saturation**, non solo cooperative idle.
La causa NO CV era sempre lì, ma nascosta nei body troncati di
`messages.jsonl.preview`.

Vedi [[project_no_cv_mode_active_vps1]] per il contesto completo.

→ **Da elaborare**: separare gap "fisiologici" (NO CV by design) da gap
"patologici" (context bloat) richiede una nuova passata di analisi. Le
ipotesi A-D precedenti restano scartate/imprecise, ma la decomposizione
del totale di 8h15m di silenzio in "by design" vs "patologico" non è
stata fatta.

### Ipotesi D (precedente, parzialmente vera) — "Cooperative idle"

Tutti gli agenti hanno consegnato i loro task disponibili
(Scrittore-1/2: position #44 chiusa, batch finito; Scout-1: batch
consegnato; Analista/Scorer: code vuote). Nessuno ha più input attivo.

Il loro main loop è "consegna task → wait next instruction da Capitano".
Il Capitano stesso aspetta notifiche degli operatori che non arrivano.

Risultato: **tutto il team in attesa passiva, nessun token consumato**.

Il `pacing-bridge-state.json` conferma: alle 05:00 `delta_usage=0.0
team_kt=0`. Zero attività.

Il sistema esce dall'idle solo grazie al Bridge TICK alle 05:07:51 che
forza Sentinella → Capitano a "muoversi".

**Da elaborare**:

- Cosa esattamente fa che il Bridge TICK riesca alle 05:07:51 dopo aver
  "saltato" alle 04:45 e 05:00? Vedi `pacing-bridge-state.json` storia.
- Perché il Capitano non auto-rilancia Scout-1 col prossimo sweep
  immediatamente dopo aver ack-ato l'ultima position? È un bug del
  prompt del Capitano? Un design intenzionale "aspetta segnale
  Sentinella"?
- Lo Scout-1 ha o no un timer interno di re-sweep? Se sì, perché non si
  è attivato in 60 min?
- I tmux send-keys dal Bridge / Sentinella verso il Capitano triggerano
  automaticamente un turn codex, o serve uno Enter / submit?

Tutto questo richiede tracing dei pane tmux nel periodo specifico, che
non è ancora stato fatto.

## Pattern visivo "picco→zero→picco" dopo le 05:14

Dopo che Scout-2 ha rilanciato la pipeline alle 05:14, ogni batch è
auto-contenuto:

1. Scout-2 fa sweep (~10 s di lavoro intenso)
2. Analista → Scorer → Scrittore-1/2 in cascata + Critico 3 round per
   ogni position (~5-10 min di attività sostenuta = "picco")
3. Batch finito → tutti tornano in cooperative idle (= "zero")
4. Trigger esterno (Bridge TICK, sweep timer Scout, KICKOFF Capitano)
   → ripartenza

Cadenza osservata batch: ~30-60 min tra un picco e il successivo.

**Da capire (DA ELABORARE)**: perché in alcuni casi il sistema riprende
prima (es. dopo 13-19 min) e in altri ha bisogno di ~40-60 min? Cosa
distingue un gap "breve" da un gap "lungo"?

## Cose ancora NON misurate / NON spiegate

1. **Tmux pane history nel periodo del gap** — solo il `capture-pane`
   live mostra il pane attuale, non lo scrollback storico. Servirebbe
   abilitare `tmux pipe-pane -o` o usare `terminal-recorder` per avere
   il vero film di cosa l'agente vedeva sul suo terminale durante il gap.

2. **Codex history.jsonl ordinato per agente** — il file globale
   `~/.codex/history.jsonl` contiene tutti i turn ma mescolati per
   session_id. Servirebbe matchare ogni session_id a un nome di agente
   (es. 019e41ea-…=scout-1, 019e41e3-…=sentinella) per ricostruire la
   timeline per-agente.

3. **Stato del `throttle-<agent>.json` durante il gap** — il file di
   stato viene cancellato a fine wait, quindi non posso vedere
   retroattivamente se in quei 60 min c'erano file `until > NOW`. Avrei
   dovuto loggare snapshot del dir state ogni minuto.

4. **Sentinel ticks vs Bridge ticks** — il bridge fa due tipi di tick
   (TICK informativo + PACING ogni 15 min). Non ho tracciato la cadenza
   esatta dei tick "saltati" vs "consegnati" nei 60 min. Possibile che
   il sistema sia entrato in un loop "Bridge skip → Sentinella muta →
   nessuno parla → Bridge skip ancora".

5. **Pacing-bridge-state.json storico** — il file ha solo l'ultimo
   stato. Per ricostruire la storia servirebbe un append-only.

## Conclusione preliminare (da elaborare)

Il vero motivo dei gap grandi (>= 20 min, fascia dalle 02:00 in poi) è
**cooperative idle**: il team non ha un meccanismo robusto di
auto-rilancio quando le code si svuotano. Quando l'ultimo task chiude,
tutti aspettano un trigger che arriva solo:
- dal Bridge TICK quando ricompila i campioni (irregolare)
- dal Capitano se il Capitano decide di spawnare Scout-N (raro)
- dall'utente via Telegram (manuale)

Throttle 240s, esaurimento fonti, deadlock: **non sono la causa**. Sono
fenomeni correlati o erroneamente identificati.

**Prossimi step proposti** (da validare):
1. Loggare `pipe-pane` di tutte le sessioni tmux per il prossimo
   stallo, così abbiamo evidenza di cosa l'agente "vedeva" mentre
   silenziava
2. Capire se nel prompt del Capitano c'è un "if pipeline empty: spawn
   scout / rilancia sweep" e perché non si attiva
3. Mappare session_id codex → nome agente in modo deterministico
4. Aggiungere un "watchdog di liveness pipeline" che, se nessun
   `team_kt` > 0 per N minuti consecutivi, forza un kickoff al Capitano

Tutto **DA ELABORARE A FREDDO**.

## Memory rilevante

- [[feedback_dev_time_over_repair_time]] — Leone vuole feature, non
  riparare tooling. Questa indagine è di tooling, va completata in
  modo strutturato senza divagare.
- [[2026-05-20-vps-bootstrap-bugs]] — i bug del setup VPS1 sono
  separati da questi gap operativi
- [[2026-05-20-supabase-perf-backlog]] — i bottleneck Supabase sono un
  altro livello, separato da questi stalli applicativi
