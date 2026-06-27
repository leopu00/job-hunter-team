# 🔴 betaC — sentinel-bridge morto dalle 08:00, nessun auto-recovery

**Data:** 2026-06-27 ~16:00 UTC
**VPS:** betaC (`203.0.113.10`, `ubuntu-2gb-hil-1-betaC`, user `9996e20c…`, provider Codex/gpt-5.5)
**Severità:** 🟠 Media — non blocca il team (degrada in coast prudente), ma **lascia la Sentinella + il pacing ciechi sull'usage finché il container non riparte**.
**Natura:** osservazione READ-ONLY. Nessun intervento a caldo (regola "team in osservazione = sola lettura"). Finding per il CODICE.

---

## TL;DR

1. Il **sentinel-bridge** (processo Python che alimenta il monitor usage) è **crashato alle 08:00** con un'eccezione **non gestita** (`subprocess.TimeoutExpired` su `jht-tmux-send SENTINELLA`).
2. I bridge sono lanciati **`setsid` detached** → **non** sono figli di pid1 → il **respawn-on-crash di pid1 NON li copre**.
3. **Nessun watchdog li sorveglia**: `agent-watchdog` respawna gli *agenti* (tmux), non i *bridge* (processi Python). `doctor-watchdog`/`bridge-control` non li toccano.
4. **Risposta alla domanda "al reset del turno torna su da solo?" → NO.** Né il cambio di `work_phase`, né il reset weekly, né il refresh-context della Sentinella rilanciano il bridge. **Solo un restart del container** (`docker compose up -d` / reboot / crash di pid1) lo fa ripartire, perché è pid1 a spawnarlo al boot.

---

## Causa-radice (dal log `/tmp/sentinel-bridge.log`)

Ultimo tick sano alle `08:00:00`, poi:

```
Traceback (most recent call last):
  File "/app/.launcher/sentinel-bridge.py", line 1684, in <module>
    main()
  File "/app/.launcher/sentinel-bridge.py", line 1609, in main
    jht_tmux_send(SENTINELLA, "[BRIDGE TICK] ts=08:00:00 usage=36% … weekly=50% …")
  File "/app/.launcher/sentinel-bridge.py", line 430, in jht_tmux_send
    return subprocess.run(["jht-tmux-send", session, text], capture_output=True, timeout=15).returncode == 0
  …
subprocess.TimeoutExpired: Command '[...]' timed out after 15 seconds
```

- `jht_tmux_send()` (≈riga 430) chiama `subprocess.run(..., timeout=15)` **senza try/except**.
- I suoi call-site dentro il `while True` di `main()` (invio del BRIDGE TICK alla Sentinella) **non** lo proteggono.
- L'unico handler esterno è `except KeyboardInterrupt` (riga ~1644) → **non** intercetta `TimeoutExpired`.
- Risultato: un singolo `jht-tmux-send` che impiega >15s (pane SENTINELLA momentaneamente occupato/bloccato mentre l'agente elaborava) **abbatte l'intero bridge** in modo permanente.

> Nota: altri punti del file gestiscono correttamente `except (subprocess.TimeoutExpired, OSError)` (es. il fetch dell'usage). Il bug è l'**incoerenza**: il send verso tmux — l'operazione più soggetta a hang — è l'unica non protetta.

---

## Architettura di lancio e sorveglianza (perché non torna su)

| Componente | Chi lo lancia | Respawn on-crash? |
|---|---|---|
| `agent-watchdog`, `auto-report-loop`, `doctor-watchdog` | pid1 come **child** | ✅ sì (pid1, respawn 5s) |
| **sentinel-bridge / pacing-bridge** | pid1 → `start-agent.sh bridge`, **`setsid` detached** | ❌ **no** (non sono child di pid1) |

- `start-agent.sh` (ramo `bridge`) è **idempotente in avvio** (kill via scan `/proc/*/cmdline` + setsid), ma è "spara-e-dimentica": **non** ha un loop di health-check. È pensato per essere ri-eseguito al boot/redeploy, non per vigilare.
- `agent-watchdog.sh`: `AGENTS=(assistente capitano mentor sentinella)` + `maybe_refresh_sentinella` → opera **solo sulle sessioni tmux degli agenti** (kill+recreate per età del contesto). **Non conosce i processi bridge.**
- `bridge-control.sh`: solo helper di kill (nessun loop, nessun respawn).
- Config-watcher in `pid1.js`: rilancia i bridge **una sola volta** e solo se erano stati *skippati al boot* per `active_provider`/bot mancanti. Qui erano partiti regolarmente → il watcher si è già chiuso.

### Cosa NON lo rimette su (la domanda diretta)
- **Cambio `work_phase`** (ON→OFF alle 18:00, ecc.): è un *valore di stato calcolato dal bridge stesso*, non un evento di lifecycle. A bridge morto non lo calcola nemmeno nessuno. ❌
- **Reset weekly** (Codex, 02/07 06:00): evento di quota, non di processo. ❌
- **Refresh-context Sentinella** (agent-watchdog, per età): fa kill+recreate della **sessione tmux `sentinella`** (è ciò che ha ricreato `SENTINELLA` alle 15:25), eseguendo `start-agent.sh sentinella` — **ruolo diverso da `bridge`**. Rinfresca la chat dell'agente, non risuscita il processo Python. ❌

### Cosa lo rimette su
- **Solo un re-run di pid1**: `docker compose up -d` (redeploy), reboot della VPS, o crash/restart di pid1. Al boot pid1 esegue `spawnSentinelPacingBridge()` → bridge di nuovo attivo.

---

## Impatto a cascata (osservato)

Il `pacing-bridge` è un processo **separato e VIVO** (pid 1478) ma **legge `sentinel-data.jsonl`**, che il sentinel-bridge ha smesso di scrivere alle 08:00. Quindi:

- `sentinel-data.jsonl` **congelato alle 08:00** → ultimo usage noto: **weekly 50%, finestra 5h 36%, SOTTOUTILIZZO**.
- `pacing-bridge` → `last_report: {ok:false, error:"insufficient_samples"}` (non ha campioni freschi su cui calcolare il ratio).
- **Conseguenza netta:** sia il **monitor usage** (tick alla Sentinella) sia la **guida di pacing** (al Capitano) sono **fuori uso** su betaC da ~8h. Il team non riceve dati → ripiega su **COAST conservativo**. È *safe* (non sfora), ma è una decisione *al buio*, non data-driven. Spiega anche perché nel pane del Capitano le ricalibrazioni citano `insufficient_samples`.

> Il `50%` weekly riportato per betaC è quindi l'ultima lettura **certificata** (08:00); il valore reale ora è verosimilmente ~50-55% (burn ~3-5%/h sceso a zero in coast), ma **non monitorato live**.

---

## Fix proposti (codice, NON a caldo)

In ordine di robustezza:

1. **Rendere `jht_tmux_send` a prova di hang** (minimo indispensabile): avvolgere il `subprocess.run(..., timeout=15)` in `try/except (subprocess.TimeoutExpired, OSError): return False`. Un send lento degrada a "tick saltato", non a crash del bridge. *(Allinea il send all'handling già usato per il fetch usage.)*
2. **Guardia esterna nel `while True` di `main()`**: `try: <corpo tick> except Exception as e: log(...); time.sleep(...) ; continue` — qualsiasi eccezione imprevista non deve mai terminare il loop. Difesa in profondità.
3. **Supervisione dei bridge** (la lacuna strutturale): un health-check periodico che, se `grep -l sentinel-bridge.py /proc/*/cmdline` è vuoto e non c'è `.team-halted.flag`, ri-esegue `start-agent.sh bridge`. Candidati: estendere `agent-watchdog.sh` (aggiungere una `maybe_respawn_bridges`) o un mini loop dedicato spawnato da pid1 **come child** (così eredita il respawn-on-crash). Questo è l'analogo, per i bridge, del gap "Sentinella nel watchdog" già chiuso per gli agenti.

**Priorità:** #1 è banale e chiude la causa immediata. #3 chiude la classe di problemi (qualsiasi morte del bridge, non solo questa).

---

## Il Mantenitore copre questo caso? — NO (gap + ironia)

Domanda naturale: il **Mantenitore** (👷‍♂️ infra-health, one-shot giornaliero) è istruito a rianimare un bridge morto? **No, oggi non lo è.**

- **Scope errato per coincidenza.** Il suo canary mission-critical (`maintainer-sweep` step 1, via `tool_health.py`) copre **browser/Playwright/`linkedin_check.py`** — i *tool* esterni — **non** i *processi bridge del team*. Nella checklist non c'è alcun "il sentinel-bridge/pacing-bridge è vivo?" né un respawn per loro.
- **Cadenza inadatta al recovery.** Gira **1×/giorno**. Oggi su betaC ha girato alle **06:05**, *prima* del crash delle 08:00 → non poteva vederlo; la prossima passata è domani ~06:00. Un bridge che muore alle 08:00 resterebbe giù ~22h anche se il canary lo coprisse.
- **Ironia.** Il Mantenitore **legge `vitals.jsonl`** per la correlazione picchi RAM/CPU — ma `vitals.jsonl` è **scritto dal sentinel-bridge**. A bridge morto, anche i vitals sono congelati: il Mantenitore consumerebbe dati fermi **senza accorgersene**.
- **Eppure è il proprietario concettuale giusto.** La sua *ragione d'essere* è ESATTAMENTE questo failure mode: il bug `libatk` (un processo critico morto in silenzio per ore, scoperto solo a valle con `new=0`). E **M-01** vieta di toccare le *sessioni agente*, ma i bridge sono *processi infra*, non sessioni → rianimarli **rientra** nel suo dominio, non lo viola.

**Conseguenza per il fix #3 — separare i due ruoli:**
- **Recovery automatico e veloce → watchdog** (loop continuo): è il layer giusto per il respawn (`maybe_respawn_bridges` in `agent-watchdog.sh`, oppure un mini-supervisor spawnato da pid1 *come child*). Riporta il bridge su in secondi, non in ore.
- **Detection + trend giornaliero → Mantenitore**: aggiungere al `maintainer-sweep` un check di **liveness dei processi del team** (`grep -l {sentinel,pacing}-bridge.py /proc/*/cmdline`) → se manca, lo segnala/logga nel trend e — coerente con M-03/M-04 — lo ripara via il canale canonico. Così la morte silenziosa di un bridge diventa visibile come lo è oggi un tool rotto.

In sintesi: **il watchdog deve rianimarlo subito; il Mantenitore deve accorgersene e tracciarlo.** Oggi nessuno dei due lo fa per i bridge.

---

## ✅ Risoluzione (2026-06-27 ~16:55 UTC)

1. **Fix del codice (causa-radice)** — `jht_tmux_send` ora avvolge `subprocess.run(..., timeout=15)` in `try/except (subprocess.TimeoutExpired, OSError) → return False`. Un tmux-send bloccato degrada a "tick saltato", non abbatte più il bridge. Protegge **tutti** i call-site in un colpo (fix nell'helper, non nei singoli punti). Commit su dev3 — **permanente al prossimo build dell'immagine**.
2. **Hotfix sul container betaC** — stessa guardia applicata in-place al file `/app/.launcher/sentinel-bridge.py` dentro il container (`py_compile` OK), poi **bridge riavviato** via `start-agent.sh bridge` (path ufficiale idempotente). Validato: `sentinel-bridge` pid vivo, primo tick alle **16:55:02 OK**, `sentinel-data.jsonl` di nuovo fresco, `weekly_usage` letto live (51%). Il pacing torna a campionare e uscirà da `insufficient_samples` man mano che accumula tick.
   - ⚠️ L'hotfix in-container è **effimero**: a un futuro `docker compose up -d` viene rimpiazzato dalla versione dell'immagine → la persistenza è garantita solo quando l'immagine `:latest` viene ribuildata da dev3 (fix #1).
3. **Resta da fare (strutturale, fix #3)** — il respawn dei bridge nel watchdog + liveness-check nel `maintainer-sweep`. Questa risoluzione chiude *questa* causa, non la classe "bridge muore → nessuno lo rialza".

## Stato attuale (al momento dell'analisi)

- betaC: container `:latest` up 24h, team al completo, **in COAST** (coda vuota), **sentinel-bridge DOWN da 08:00**, pacing in `insufficient_samples`. Nessun intervento eseguito.
- betaB (`203.0.113.20`, Kimi): bridge **vivi e freschi** (sentinel-data aggiornato alle 16:00, weekly 95% a fine ciclo) — **non** affetto. Conferma che è un crash transiente specifico di betaC, non un bug deterministico.
