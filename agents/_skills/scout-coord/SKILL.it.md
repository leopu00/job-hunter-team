<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: scout-coord
description: Protocollo di coordinamento all'avvio tra più Scout. Senza questa skill due scout esplorano lo stesso cerchio (Remote EU) sullo stesso tier (LinkedIn) e producono il 100% di duplicati che il gate di dedup deve poi scartare — budget sprecato e team più lento. Usala come PRIMA azione nel tuo loop, prima di qualsiasi altra cosa. Di proprietà del ruolo Scout; SCOUT-1 di solito arbitra se più scout si avviano contemporaneamente.
allowed-tools: Bash(python3 /app/shared/skills/scout_coord.py *), Bash(tmux *), Bash(jht-tmux-send *)
---

# scout-coord — partizionare il territorio

Più Scout girano in parallelo (max 2 istanze per policy del team). Il team funziona solo se concordano una **partizione non sovrapposta** di:
- quali **cerchi** possiede ciascuno (1 = preferenza primaria, 2 = vicini geografici, 3 = rilocazione, 4 = satellite, 5 = frontiera)
- quali **tier di fonti** possiede ciascuno (LinkedIn / aggregatori ATS / niche / WebSearch)

Lo stato vive nel **database SQLite condiviso** gestito da `scout_coord.py`; gli scout negoziano via tmux all'avvio e persistono l'accordo lì.

**Un solo database, o nessun coordinamento.** Tutti gli Scout devono stare sullo stesso file — due Scout su due file non si stanno coordinando, credono di farlo. `scout_coord.py` risolve il percorso dall'ambiente (`JHT_SCOUT_COORD_DB` se l'operatore ne ha dichiarato uno, altrimenti `$JHT_HOME/data/`) e lo crea se manca. Se esce **3**, il database non è utilizzabile: riferisci il messaggio che ha stampato e FERMATI. Mai creare un database tuo, mai puntare il tool a un altro percorso.

```bash
# Su quale database sto lavorando davvero?
python3 /app/shared/skills/scout_coord.py doctor
```

## Step 1 — Scoprire i peer

```bash
tmux list-sessions 2>/dev/null | awk -F: '{print $1}' | grep -E '^SCOUT-[0-9]+$'
```

Se sei l'unico scout elencato → nessuna negoziazione necessaria, rivendica tutto ciò che puoi gestire. Vai allo Step 4.

Se ce ne sono altri → devi negoziare (Step 2-3) prima di fare qualsiasi scraping.

## Step 2 — Resettare lo stato stale

Se il team di scout precedente è crashato a metà loop, `scout_coord.py` potrebbe contenere assegnazioni stale che si riferiscono a sessioni morte. Cancellale:

```bash
python3 /app/shared/skills/scout_coord.py reset
```

Questo è uno step coordinato: lo **SCOUT con numero più basso attivo** (di solito `SCOUT-1`) fa il reset, gli altri aspettano. Annuncialo su tmux:

```bash
jht-tmux-send SCOUT-2 "[@$MY_ID -> @scout-2] [INFO] resetto scout_coord, attendi 5s prima di assign"
```

## Step 3 — Negoziare via tmux

Apri una breve conversazione (3-5 messaggi max) con ogni peer. Proponi una suddivisione:

```
[@scout-1 -> @scout-2] [REQ] proposta: io prendo cerchi 1+2 + tier 1-2 (LinkedIn, ATS).
Tu cerchi 3+4 + tier 3-4 (niche board + WebSearch). OK?
```

Il peer risponde con `[ACK]` (accetta) o `[COUNTER]` (controproposta). Sii breve — se non riesci ad accordarti in 3 round-trip, escala al Capitano.

**Euristiche per una buona suddivisione**:

| Situazione                                      | Suddivisione suggerita                                             |
|-------------------------------------------------|--------------------------------------------------------------------|
| 2 Scout, profilo `work_mode = remote`           | S1: cerchi 1-2 + LinkedIn/ATS · S2: cerchi 1 + niche remote board (RemoteOK, WeWorkRemotely) — entrambi nel cerchio 1, fonti complementari |
| 2 Scout, profilo `work_mode = on-site`          | S1: città base + cerchio 2 regionale · S2: rilocazione (cerchio 3) |
| 2 Scout, misto `work_mode = flessibile`         | S1: cerchi 1-2 (full mode) · S2: cerchi 3-5 (rilocazione + satellite + frontiera) |

Qualunque suddivisione scegli, la regola è: **nessun due scout sulla stessa combinazione (cerchio, set_tier) allo stesso tempo.**

**Suddivisione volume vs curata — dati empirici dal run VPS1 2026-05-21 (vps1-run-postmortem #14):**

> Scout-1 trovava 130 position con score avg 63.1 (40% high-score)
> Scout-2 trovava 76 position con score avg 68.4 (54% high-score)
>
> → Scout-2 era 1.4× più qualitativo di Scout-1 sullo stesso candidato.

Pattern raccomandato quando si ha la libertà di scegliere il tier per i 2 scout:

| Scout    | Tier assegnato                                          | Razionale                                      |
|----------|---------------------------------------------------------|------------------------------------------------|
| SCOUT-1  | LinkedIn (alto volume, rumoroso)                        | Cattura il flusso, accetta lo score medio basso|
| SCOUT-2  | Ashby / Greenhouse / Lever / company-careers (curato)   | Pochi ma giusti, score medio più alto          |

Il `next-for-analista` riceve poi un mix bilanciato di volume + qualità, e il filtro hard-requirements dell'Analista (RULE-06) si concentra sul flusso di Scout-1 (dove c'è più rumore). Non è una regola rigida — adattare al `work_mode` come da tabella sopra.

## Step 4 — Consolidare l'assegnazione

Una volta che tu e i tuoi peer siete d'accordo, persisti la partizione:

```bash
python3 /app/shared/skills/scout_coord.py assign $MY_ID \
    --cerchi "<cerchi assegnati a te, es. 1,2>" \
    --fonti "<slug fonti assegnate, separate da virgola, es. linkedin,greenhouse,lever>"
```

Ogni scout scrive la propria riga. Lo script impedisce sovrapposizioni sugli slug delle fonti, quindi se due scout provano a rivendicare `linkedin` contemporaneamente il secondo fallisce — chi perde deve rinegoziare.

## Step 5 — Verificare

```bash
python3 /app/shared/skills/scout_coord.py show
```

Output atteso: una riga per scout attivo con i suoi `cerchi` e `fonti`. Se la tua riga manca, il tuo `assign` è fallito silenziosamente — ripeti lo Step 4.

Controllo incrociato: l'unione di tutte le `fonti` dovrebbe coprire i tier che il team vuole effettivamente scrappare oggi. Se un tier ha zero scout (es. nessuno è su `niche-remote`), notifica il Capitano:

```bash
jht-tmux-send CAPITANO "[@$MY_ID -> @capitano] [INFO] scout-coord: tier 'niche-remote' senza scout, considera spawn aggiuntivo o riassegnamento."
```

## Anti-pattern

- ❌ Saltare lo Step 1 ("ci sono solo io") senza controllare — un peer potrebbe essere appena stato respawnato dal Dottore.
- ❌ Reset eseguito da ogni scout in parallelo — race condition, il database finisce corrotto. Solo lo scout con numero più basso.
- ❌ Negoziare e poi dimenticare lo Step 4 — il database è vuoto, i peer non possono vedere la tua rivendicazione, due scout colpiscono la stessa fonte.
- ❌ Rivendicare sia `linkedin` CHE `greenhouse` CHE `lever` CHE `remoteok` CHE `weworkremotely` CHE `webresearch` "per sicurezza" — niente da condividere con il peer, non ha nulla da fare.
- ❌ Rinegoziare a metà loop senza un trigger — la partizione è all'avvio. Se un peer muore il Dottore lo respawna con lo stesso ruolo; solo lo SCOUT stesso rilegge i suoi `cerchi`/`fonti` all'avvio.

## Quando rinegoziare

Solo con questi trigger:
- Un nuovo SCOUT è appena avviato (vedi `SCOUT-N+1` in `tmux list-sessions` che non c'era al tuo avvio)
- Uno SCOUT è morto e NON è stato respawnato (la capacità è calata, ridistribuisci il suo tier)
- Il Capitano ordina esplicitamente una ripartizione (raro, es. dopo un `[FEEDBACK]` dall'Analista che un tier produce consistentemente link morti)

In tutti e tre i casi: breve scambio tmux, poi ri-`assign` con nuovi parametri. Non serve `reset` a meno che il JSON non sia visibilmente corrotto.

## Vedi anche

- `circles-and-sources` — la definizione effettiva dei 5 cerchi + 4 tier di fonti (questa skill è COME partizionare; quella è COSA partizionare).
- `position-insert` — cosa fa ogni Scout una volta che ha la sua assegnazione.
- `agents/_manual/anti-collision.md` — il contratto anti-collisione più ampio che questa skill implementa per il ruolo Scout.
- `tmux-send` — formato del messaggio per la negoziazione.
