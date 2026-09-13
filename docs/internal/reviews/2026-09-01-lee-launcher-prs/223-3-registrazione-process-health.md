# PR #223 — rischio 3/5: il sorvegliante non è sorvegliato

**Verdetto: CONFERMATO, da correggere prima del rilascio.** Il quinto watchdog
(`.launcher/pager-unstick-watchdog.sh`) è agganciato a pid1 in modo corretto
(spawn `cli/src/commands/pid1.js:806-827`, respawn a 5s, kill nello shutdown a
`pid1.js:1221`), ma **non esiste in nessun inventario**: non è in `EXPECTED` di
`shared/skills/process_health.py:36-67`, non ha un test che lo pinni, e non
legge i due flag di sospensione (`.team-standby.flag`, `.team-halted.flag`) che
ogni altro componente capace di *svegliare* un agente onora. La PR ha toccato
2 file (`git show --stat 11eca0aa9c`: `.launcher/pager-unstick-watchdog.sh`,
`cli/src/commands/pid1.js`) contro i 10+2 del precedente `throttle-engine`.

Conseguenza pratica: se il watchdog muore, si torna esattamente al problema che
la PR esiste per chiudere — agente headless fermo nel pager, sessione tmux viva,
processo dell'agente vivo, **zero progresso** — e questa morte è invisibile a
tutti i canary attuali. Il Mantenitore non la vedrebbe al primo sweep del giorno,
il Capitano non riceverebbe nessuna escalation.

---

## 1. Il contratto di `shared/skills/process_health.py`

**Cos'è.** Canary di *liveness* read-only: scansiona `/proc/*/cmdline` in Python
(`_cmdlines`, `process_health.py:171-179`) e per ogni riga di `EXPECTED`
(`:36-67`, tuple `(nome, marker, gruppo)`) conta quanti processi contengono il
marker. È la **seconda rete**, sotto al respawn di pid1: il docstring
(`:1-23`) dice esplicitamente che serve al caso «anche il respawn automatico
fallisce» (watchdog vivo ma buggato, flap-cap raggiunto), con worst case ~1
giorno di degrado invece che infinito. Nasce dal crash silenzioso del
sentinel-bridge su betaC (`docs/internal/postmortems/2026-06-27-betaC-sentinel-bridge-crash.md`,
8h ciechi sull'usage).

**Chi lo chiama.**

1. `.launcher/agent-watchdog.sh:75` (`PROCESS_HEALTH_TOOL`, override-abile via
   `JHT_PROCESS_HEALTH_TOOL`) → `maybe_respawn_bridges()` a `:479-550`, ogni
   tick (30s). Invoca `summary --shell` (`:493`) e fa `eval` dell'output
   (`:495`). Nota di contratto già pagata in passato: l'exit code **non** viene
   gatato, perché lo script esce 1 proprio quando c'è un morto (`:486-489`,
   `process_health.py:280`).
2. Il **MANTENITORE**, passo 0 del giro (`agents/_skills/maintainer-sweep/SKILL.it.md:19-33`
   e i 6 gemelli linguistici; prompt `agents/mantenitore/mantenitore.it.md:82`)
   → `process_health.py summary` in output umano.
3. Nessun altro: `cli/src/commands/{doctor,health,status}.js` **non** contengono
   liste di daemon (verificato: zero occorrenze di `watchdog`/`throttle-engine`);
   la web UI non ne ha traccia (zero match in `web/`). L'unico riferimento in
   `cli/` è un commento a `pid1.js:546`.

**Come si usano i gruppi** (commenti canonici a `process_health.py:29-35`, resa
operativa in `scan()` `:226-245`):

| gruppo | semantica | azione a morte |
|---|---|---|
| `bridge-suite` | daemon detached, fuori dal respawn di pid1 | `PROC_DEAD_BRIDGE_SUITE` → `agent-watchdog.sh:506-515` esegue `start-agent.sh bridge` (idempotente), con anti-flap; oltre il cap → escalation |
| `tg-bridge` | opzionale, per-ruolo (O-58) | respawn del **solo** ruolo mancante (`agent-watchdog.sh:530-541`) |
| `pid1-child` | respawnato da pid1 | `dead_deep` → **solo escalation** |
| `daemon` | cloud daemon | `dead_deep` → escalation |
| `core` | pid1 stesso | `dead_deep` → escalation (informativo) |

**Cosa succede quando un `pid1-child` risulta morto.** `scan()` lo mette in
`dead` (`:227`) e in `dead_deep` (`:229`, che unisce `pid1-child|daemon|core`);
`--shell` lo esporta come `PROC_DEAD_DEEP` (`:257`); l'agent-watchdog lo passa a
`bridge_escalate` (`:547-549`) che manda al **CAPITANO** via `jht-tmux-send` un
messaggio `[WATCHDOG] …` (`:462-463`). Il commento a `:543-546` è esplicito: da
lì **non** si tenta il respawn, perché il processo verrebbe orfanato — la
riparazione spetta a pid1, e se resta morto il problema è più profondo. Stessa
regola insegnata al Mantenitore (`SKILL.it.md:31`: «NON provare a rilanciarli a
mano»). Nota: `all_ok=0` → exit 1, che è anche il segnale al Mantenitore.

**Casi speciali (gate).** Sono tutti pensati per non produrre falsi «morti»,
perché un falso positivo qui significa una escalation al Capitano ~1×/h a vuoto:

- `TELEGRAM_GATED = {"auto-report-loop"}` (`:90`, applicato a `:220-224`): pid1
  lo avvia solo con bot configurati → senza Telegram diventa `optional`.
- `cloud-daemon` → `optional` se il pairing è spento (`:116-133`, `:197-199`).
- `tg-bridge` → atteso **per ruolo con `bot_token`** (`:149-168`, `:204-216`);
  la riparazione tocca solo i ruoli mancanti.
- `dashboard` è stato **rimosso** dalla lista (`:63-65`) quando la web UI locale
  è stata ritirata: lasciare un atteso che pid1 non avvia più faceva scattare
  flap-cap e falsa escalation. È il precedente che dice che questa lista va
  tenuta in sincronia con pid1 in **entrambe** le direzioni.

Il file è anche il motivo per cui non si usa `grep MARKER /proc/*/cmdline`:
quel pattern fa **self-match** sull'argv del grep stesso (commento a `:253-255`,
e `.launcher/proc-kill.py:9-23`).

---

## 2. Il marker corretto

pid1 lancia lo script con `spawnLabeled('pager-unstick', '/bin/bash', [PAGER_UNSTICK_WATCHDOG_SCRIPT])`
(`pid1.js:811`, costante a `pid1.js:46 = '/app/.launcher/pager-unstick-watchdog.sh'`).
`spawnLabeled` usa `spawn(cmd, args)` senza shell (`pid1.js:360-361`), quindi la
cmdline del processo è esattamente:

```
/bin/bash /app/.launcher/pager-unstick-watchdog.sh
```

**Marker da usare: `pager-unstick-watchdog.sh`** (stessa forma dei fratelli:
`agent-watchdog.sh`, `doctor-watchdog.sh`, `auto-report-loop.sh`).

Verifiche fatte:

- **Nessuna collisione**: `count(marker)` è un semplice `marker in cmdline`
  (`process_health.py:185-186`). Nessuno degli 8 marker esistenti è sottostringa
  di questa cmdline e viceversa — in particolare `agent-watchdog.sh` **non** è
  sottostringa di `pager-unstick-watchdog.sh` (il prefisso è `unstick-`, non
  `agent-`). Un marker abbreviato tipo `watchdog.sh` collezionerebbe invece tre
  processi: da evitare.
- **Nessun self-match**: il marker vive nel *file* Python, non nell'argv del
  processo che scansiona (`:253-255`). Nemmeno i figli dello watchdog lo
  contengono: sono `tmux capture-pane …`, `grep -q 'pgup/pgdn to page'`,
  `jht-tmux-send <sess> "Continue where you left off."`, `sleep 20`.
- **Nessun falso positivo da log-tailing**: un `tail -f
  /jht_home/logs/pager-unstick-watchdog.log` **conterrebbe** il marker e
  farebbe risultare il watchdog vivo mentre è morto. È un difetto che il file
  già accetta per tutti gli altri (`agent-watchdog.log`, `doctor-watchdog.log`) —
  non introdotto qui, non un motivo per cambiare marker.
- **Nessun gate necessario**: pid1 chiama `startPagerUnstickWatchdog()`
  incondizionatamente (`pid1.js:827`), senza `hasBots`/provider/cloud — quindi è
  atteso **sempre**, come `agent-watchdog`. Invariante da tenere: se un domani
  lo spawn venisse gatato (per esempio sul solo provider Codex), il canary
  andrebbe gatato nello stesso commit, altrimenti si ripete il caso `dashboard`.

Repair path già funzionante senza modifiche: `python3 /app/.launcher/proc-kill.py
pager-unstick-watchdog.sh` (nessuna whitelist di marker in `proc-kill.py`), che è
la forma «uccidilo, pid1 lo rispawna» insegnata al Dottore
(`agents/dottore/dottore.it.md:78`).

---

## 3. Il precedente `throttle-engine` come checklist

Il daemon è entrato con **due** commit:

- `e16828144f` — *feat(throttle): the timer leaves the agent's process…* (10 file)
- `c0ec26971b` — *test(throttle): the six acceptance checks…* (2 file)

File toccati, tradotti in checklist per «un nuovo daemon di pid1», con lo stato
della PR #223:

| # | Cosa | Precedente throttle | Stato #223 |
|---|---|---|---|
| 1 | Lo script/daemon | `shared/skills/throttle_engine.py` | ✅ `.launcher/pager-unstick-watchdog.sh` |
| 2 | Spawn + respawn 5s + kill nello shutdown in pid1 | `cli/src/commands/pid1.js` (+44) | ✅ `pid1.js:806-827` e `:1221` |
| 3 | **Registrazione in `process_health.py` come `pid1-child`** | `shared/skills/process_health.py` (+7, righe `54-60`) | ❌ **assente** |
| 4 | Test che pinna la tupla nel sorgente del canary | `tests/test_throttle_engine.py:799-803` | ❌ assente |
| 5 | Test che pinna spawn/respawn/kill in pid1 | `tests/test_throttle_engine.py:780-796` | ❌ assente (la PR non ha alcun test) |
| 6 | Doc di stato che dichiara l'aggancio al canary | `docs/internal/roadmap/2026-07-30-ticket-throttle-engine-external.md:131-133` | ❌ nessun doc |
| 7 | Gate su halt/standby/working-hours quando il daemon *sveglia* un agente | integrato nel motore (vedi messaggio di commit: «Waking is spending, so the halt flags, standby and the working hours gate it») | ❌ assente (§4.3) |
| 8 | Tool/skill/`allowed-tools` + `.githooks/pre-commit` | `agents/_tools/throttle*`, allowlist file senza estensione | N/A (nessun comando utente, script `.sh`) |

Punti 3, 4, 5 sono la correzione minima; 6 è la prassi del repo; 7 è un difetto
separato ma della stessa famiglia (vedi §4).

---

## 4. Dove il nuovo watchdog è invisibile oggi

**4.1 Canary dei processi** — `shared/skills/process_health.py:36-67`. Il buco
principale. Nessuna riga, quindi `dead_deep` non lo nominerà mai, quindi né
l'escalation al Capitano (`agent-watchdog.sh:547-549`) né il passo 0 del
Mantenitore lo vedranno.

**4.2 Test** — nessuno. `git show --stat 11eca0aa9c` mostra 2 file, zero test.
Non esiste un `tests/test_process_health*.py`: la copertura del canary vive nei
test delle feature che vi si registrano (`tests/test_throttle_engine.py:799-803`,
`tests/test_tg_bridge_expected_roles.py`). Senza un test qui, la prossima
riscrittura di `EXPECTED` può cancellare la riga senza che niente si accorga.

**4.3 Registro dello standby a spesa zero** — `shared/skills/standby.py:34-44`
elenca *chi legge il flag*: sentinel-bridge, pacing-bridge, heartbeat-bridge,
`agent-watchdog.sh`, `doctor-watchdog.sh`, `stepcap-watchdog.py`. Il nuovo
watchdog non c'è, e infatti non legge nulla: `pager-unstick-watchdog.sh:36-56`
cicla su **tutte** le sessioni tmux e, oltre a `q`, invia
`jht-tmux-send "$s" "Continue where you left off."` (`:49`). In standby le
sessioni agente **restano vive ma mute** (`agent-watchdog.sh:668-672`): un nudge
in quella finestra riaccende la spesa che lo standby esiste per azzerare.
Simmetricamente manca il gate `.team-halted.flag`, che `tests/test_first_activation_gate.py:59-63`
pinna per entrambi gli altri watchdog. Il precedente è esplicito nel messaggio
di `e16828144f`: «Waking is spending, so the halt flags, standby and the working
hours gate it». Pin di riferimento per il test: `tests/test_team_standby.py:478-508`.

**4.4 Gate di prima attivazione** — `tests/test_first_activation_gate.py:31-38`
pinna che `ensureInitialTeamHalt()` preceda `startAgentWatchdog()` e
`startDoctorWatchdog()`. `startPagerUnstickWatchdog()` non è nella lista: oggi
l'ordine è di fatto corretto (parte dopo, `pid1.js:827`), ma non è protetto da
nessun test.

**4.5 Prompt del Mantenitore** — `agents/_skills/maintainer-sweep/SKILL.md:30` e
i 6 gemelli (`.it/.de/.es/.fr/.hu/.pt`) enumerano i `pid1-child` per nome
(«agent-watchdog, doctor-watchdog, auto-report-loop, cloud-daemon, pid1»).
L'elenco è **già stantio** (mancano `stepcap-watchdog` e `throttle-engine`, che
non lo aggiornarono): non è un bloccante per questa PR, ma vale una riga in un
giro di pulizia.

**4.6 Diagnostica del Dottore** — `agents/dottore/dottore.it.md:72-80` esegue
`stepcap-watchdog.py --health`, cioè la metà *difficile* della domanda («la
FUNZIONE è viva», leggendo la freschezza di un log). `pager-unstick-watchdog.sh`
non espone `--health` e il suo log si scrive **solo quando trova un pager**
(`:44-52`): una versione futura del TUI Codex che cambia il footer
(`pgup/pgdn to page` + `q to quit`) lo renderebbe un processo perennemente vivo e
perennemente inutile, e nessuno se ne accorgerebbe. Fuori scope per la
registrazione, ma è il gap che i commenti a `process_health.py:48-52` e `:54-59`
avvertono di non ripetere.

**4.7 Nessun aggiornamento richiesto altrove.** Verificati e negativi:
`cli/src/commands/{doctor,health,status}.js` (nessuna lista di daemon), `web/`
(nessun riferimento a watchdog), cloud sync / dashboard, `docs/internal/architecture/bridges.md`
(è la mappa dei soli bridge detached, `:1-5`), `shared/skills/log_archive.py:43-49`
(archivia solo storici `.jsonl`/`.csv`). Il `Dockerfile` fa `COPY . .` (`:158`),
quindi lo script è nell'immagine senza modifiche.

Minore, per completezza: `logs/pager-unstick-watchdog.log` (scritto dallo script,
`:29`) non ha rotazione — ma `agent-watchdog.log` è nella stessa condizione, e la
rotazione a 5MB di `spawnLabeled` (`pid1.js:376-381`) copre solo l'altro file,
`logs/pager-unstick.log`. Non è un difetto introdotto da questa PR.

---

## 5. Deve essere un `pid1-child` sorvegliato?

**Sì, senza dubbi.** L'argomento in tre passaggi:

1. **Cosa succede se muore.** Si torna al caso della PR: il pager resta aperto,
   l'agente non avanza «per ore» (docstring dello script, `:6-10`). E questo
   guasto è **invisibile per costruzione a ogni altro controllo**: la sessione
   tmux esiste (l'agent-watchdog è contento, `ensure_agent` non scatta), il
   processo dell'agente esiste, il TTL di 12h non è scaduto. L'unico altro
   canary «di progresso», `stepcap-watchdog`, guarda un fenomeno diverso (il cap
   di step, `process_health.py:48-52`). In altre parole: la morte di questo
   watchdog è **esattamente** la classe di guasto silenzioso per cui
   `process_health.py` è stato scritto.
2. **Costo di un falso positivo ≈ 0.** pid1 lo avvia incondizionatamente
   (`pid1.js:827`): non esiste una configurazione in cui è legittimamente
   assente. Nessun gate da scrivere, nessun rischio di ripetere il caso
   `dashboard` (`:63-65`) o `auto-report-loop` (`:90`).
3. **Costo di non registrarlo = un giorno di agenti fermi**, che sul piano
   economico è peggio della morte di un bridge (un bridge morto acceca il
   monitoraggio; qui si ferma la produzione).

**Gruppo corretto: `pid1-child`.** Non `bridge-suite`: non è detached e non lo
rispawna `start-agent.sh bridge` — metterlo lì farebbe eseguire al watchdog un
respawn della suite che non lo tocca, cioè un loop di riparazione inefficace, e
al Mantenitore un `start-agent.sh bridge` a vuoto. `pid1-child` dà la semantica
giusta: se è morto *nonostante* il respawn di pid1, il problema è pid1 →
**escalation al Capitano**, nessun tentativo di rianimazione manuale.

---

## 6. Proposta concreta (diff testuale, NON applicato)

### 6.1 `shared/skills/process_health.py`

```diff
@@ -46,6 +46,15 @@ EXPECTED = [
     ("agent-watchdog",     "agent-watchdog.sh",     "pid1-child"),
     ("doctor-watchdog",    "doctor-watchdog.sh",    "pid1-child"),
+    # 01/09: il watchdog che dismette il pager fullscreen del TUI Codex quando
+    # resta aperto in una tmux headless. Se muore, nessuno preme piu' `q` e si
+    # torna al guasto che esiste per chiudere: agente fermo per ore. E' un
+    # guasto INVISIBILE a tutto il resto — la sessione tmux c'e', il processo
+    # dell'agente c'e', il TTL non e' scaduto: nessun altro canary lo vede.
+    # pid1 lo avvia incondizionatamente (pid1.js:827) → nessun gate, atteso
+    # sempre. Come per stepcap/throttle qui c'e' solo la meta' facile della
+    # domanda (il PROCESSO e' vivo); l'altra meta' non e' interrogabile finche'
+    # lo script non espone un `--health`.
+    ("pager-unstick-watchdog", "pager-unstick-watchdog.sh", "pid1-child"),
     # 28/07: il watchdog del cap di step. Qui c'e' solo la meta' facile della
```

Nota di stile: il nome supera di 2 caratteri la colonna di `f"{r['name']:<20}"`
(`:271`) — solo cosmetico nell'output umano. In alternativa `"pager-unstick"`
(che coincide con la label di `spawnLabeled` e con `logs/pager-unstick.log`), ma
la convenzione dominante in `EXPECTED` è il nome derivato dallo script.

### 6.2 Test che pinna la registrazione

Nuovo file `tests/test_pager_unstick_watchdog.py` (il precedente mette il pin
nel test della feature; la PR #223 non ne ha uno, quindi va creato):

```python
"""Il pager-unstick-watchdog è un figlio di pid1 SORVEGLIATO.

Se muore, gli agenti headless restano fermi nel pager del TUI Codex — il guasto
che questo watchdog esiste per chiudere — e nessun altro canary se ne accorge:
la sessione tmux c'è, il processo dell'agente c'è. La seconda rete (per il caso
in cui sia rotto il respawn di pid1) è `process_health.py`. Stesso contratto
pinnato per il throttle-engine in tests/test_throttle_engine.py:799-803.
"""
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "shared" / "skills"
LAUNCHER_DIR = REPO_ROOT / ".launcher"


def test_il_canary_dei_processi_attende_il_pager_watchdog():
    src = (SKILLS_DIR / "process_health.py").read_text(encoding="utf-8")
    assert '("pager-unstick-watchdog", "pager-unstick-watchdog.sh", "pid1-child")' in src


def test_il_marker_corrisponde_alla_cmdline_che_pid1_produce():
    """pid1 lancia `/bin/bash /app/.launcher/pager-unstick-watchdog.sh` senza
    shell: il marker del canary deve essere una sottostringa di QUELLA cmdline,
    altrimenti il canary riporta un morto che è vivo (o viceversa)."""
    pid1 = (REPO_ROOT / "cli" / "src" / "commands" / "pid1.js").read_text(encoding="utf-8")
    assert "'/app/.launcher/pager-unstick-watchdog.sh'" in pid1
    health = (SKILLS_DIR / "process_health.py").read_text(encoding="utf-8")
    marker = "pager-unstick-watchdog.sh"
    assert marker in health
    assert marker in "/bin/bash /app/.launcher/pager-unstick-watchdog.sh"


def test_pid1_lo_avvia_lo_rispawna_e_lo_uccide_allo_shutdown():
    """Il canary presume che a rispawnarlo sia pid1: se questo aggancio salta,
    l'escalation `dead_deep` indicherebbe il colpevole sbagliato."""
    src = (REPO_ROOT / "cli" / "src" / "commands" / "pid1.js").read_text(encoding="utf-8")
    assert "startPagerUnstickWatchdog();" in src
    assert "pager-unstick-watchdog respawn after crashing" in src
    assert "pagerUnstickChild.kill(sig)" in src


def test_il_watchdog_non_e_gatato_da_telegram_ne_dal_cloud():
    """Atteso SEMPRE: nessun ramo condizionale davanti allo spawn. Se un domani
    lo si gata (es. solo provider Codex), il gate va aggiunto anche al canary —
    è il caso 'dashboard' di process_health.py:63-65."""
    src = (REPO_ROOT / "cli" / "src" / "commands" / "pid1.js").read_text(encoding="utf-8")
    start = src.index("startPagerUnstickWatchdog();")
    prev_line = src[:start].rsplit("\n", 2)[-2]
    assert "if" not in prev_line
```

### 6.3 Fuori dal minimo, ma raccomandato nella stessa PR

Gate di spesa (§4.3), sul modello di `agent-watchdog.sh:625-687`, perché il
nudge `Continue where you left off.` è a tutti gli effetti spesa:

```diff
@@ pager-unstick-watchdog.sh
+STANDBY_PY="${JHT_STANDBY_PY:-/app/shared/skills/standby.py}"
+TEAM_STANDBY_FLAG="$JHT_HOME/.team-standby.flag"
+TEAM_HALTED_FLAG="$JHT_HOME/.team-halted.flag"
+standby_active() { … stesso predicato unico di agent-watchdog.sh:625-634 … }
 while true; do
+  # `q` sblocca ed e' gratis; il nudge e' SPESA: in halt/standby si dismette
+  # il pager e basta (o si salta il giro), non si riaccende un agente che
+  # l'utente o il motore hanno messo giu'.
+  if [ -e "$TEAM_HALTED_FLAG" ] || standby_active; then sleep "$INTERVAL_SEC"; continue; fi
```

con il test corrispondente accanto a `tests/test_team_standby.py:478-508`, e la
riga da aggiungere all'elenco «chi legge il flag» di `shared/skills/standby.py:41-44`.
