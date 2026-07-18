# 🧨 Timebomb `config_ready`: nome-vendor vs nome-CLI del provider — postmortem 2026-07-18

Una VPS di produzione (team su Anthropic/Claude) è rimasta con la **pipeline morta per ~44 ore senza che nessuno se ne accorgesse**: solo i processi di manutenzione giravano, mentre **CAPITANO e MENTOR non sono mai stati ricreati**. Il team di manutenzione e il daemon cloud continuavano a lavorare, dando l'illusione di una VPS "viva" che in realtà non produceva nulla. **Nessun watchdog ha loggato una sola riga**: fallimento totalmente silenzioso.

La causa è un **mismatch di stringa** tra due parti dello stesso codice: il comando di switch provider scrive in `active_provider` il **nome-vendor** (`openai`, `anthropic`), ma `config_ready()` nell'`agent-watchdog` conosceva solo i **nomi-CLI** (`codex`, `claude`). Un valore fuori-mappa faceva ritornare `config_ready` **false in silenzio**, disabilitando il respawn del core team. Difetto **latente e innocuo finché le sessioni tmux restavano vive**, **detonato al primo reboot** (in questo caso un riavvio per un upgrade RAM che ha azzerato tutte le sessioni).

Una **seconda VPS** (team su OpenAI/Codex) era **armata con lo stesso difetto** (`active_provider="openai"` vs enum atteso `codex`) ma non ancora detonata: il crew era vivo solo perché non c'era stato un reboot dopo lo switch. Sarebbe morta identica al primo restart.

Perdita dati **nulla** (il DB locale resta autoritativo e integro; solo zero *nuova* produzione). Fix **preparato e committato su `dev6`**; il deploy sull'immagine è gated (rebuild+redeploy). Le VPS live sono state sbloccate applicando lo stesso fix a caldo, **senza modificare i valori del provider** (che sono corretti).

---

## Impatto

| Dimensione | Effetto |
|---|---|
| Pipeline (VPS Anthropic) | **Ferma ~44h**: ultimo Capitano/produzione prima del reboot, poi zero respawn |
| Seconda VPS (OpenAI) | **Bomba armata, non detonata**: sarebbe morta al primo reboot |
| Rilevabilità | **Nessuna**: 0 righe di log, nessun errore, nessun flag di halt, auth valida |
| Illusione di "vita" | Manutenzione (Dottore/Mantenitore) + daemon cloud attivi → sembrava sana |
| Perdita dati permanente | **Nessuna** — DB locale integro |

---

## Causa radice

### Il mismatch di naming

Nel codebase il provider ha **due registri di nomi** usati in modo incoerente:

| Provider | Nome-vendor (scritto da `jht providers use`) | Nome-CLI storico | Marker credenziali |
|---|---|---|---|
| OpenAI | `openai` | `codex` | `$JHT_HOME/.codex/auth.json` |
| Anthropic | `anthropic` | `claude` | `$JHT_HOME/.claude/.credentials.json` |
| Moonshot | `kimi` | `kimi` | `$JHT_HOME/.kimi/credentials/kimi-code.json` |

`kimi` coincide nei due registri → mai in pericolo. `openai`/`anthropic` **no**: `config_ready()` mappava solo `{kimi, claude, codex}`.

### Il fallimento silenzioso

`config_ready()` in `.launcher/agent-watchdog.sh` faceva:

```python
prov = (config.get('active_provider') or '').strip().lower()   # es. "anthropic"
markers = {'kimi': ..., 'claude': ..., 'codex': ...}
has_creds = bool(prov) and os.path.exists(markers.get(prov, ''))
# markers.get("anthropic") -> ''  ->  os.path.exists('') -> False  ->  has_creds False
sys.exit(0 if (prov and has_creds) else 1)                       # -> exit 1 (FALSE)
```

Il loop principale del watchdog:

```sh
if config_ready; then
  ... ensure_agent(capitano, mentor, ...) ...   # respawn del core team
else
  :                                             # <-- ramo SILENZIOSO ("niente spam")
fi
```

Con `config_ready=false`, il ramo `else` **non faceva nulla e non loggava nulla**. Le credenziali erano presenti e valide (`.claude/.credentials.json` c'era): **mancava solo il match della stringa**. Da qui: nessun respawn, nessun log, per 44h.

### Perché latente → detonato

`config_ready` gatea solo la **(ri)creazione** degli agenti, non le sessioni già vive. Finché CAPITANO/MENTOR restavano su (dallo switch provider in poi), tutto sembrava normale. Il **reboot per l'upgrade RAM** ha ucciso tutte le sessioni tmux; al riavvio, pid1 fa il kick di ASSISTENTE una volta (per questo ASSISTENTE/SENTINELLA erano vivi), ma CAPITANO/MENTOR dipendono dal loop `ensure_agent` del watchdog — bloccato da `config_ready=false`. Il **doctor-watchdog** (Dottore/Mantenitore) non usa `config_ready`, per questo la manutenzione continuava: illusione di vita.

### Il differenziale (perché solo 2 VPS su 4)

| VPS (provider) | `active_provider` | `config_ready` pre-fix | Esito |
|---|---|---|---|
| Anthropic/Claude (sana) | `claude` | exit 0 | crew rispawnabile ✅ |
| Moonshot/Kimi | `kimi` | exit 0 | crew rispawnabile ✅ |
| Anthropic/Claude (guasta) | `anthropic` | **exit 1** | **crew morto dopo reboot** 🔴 |
| OpenAI/Codex | `openai` | **exit 1** | **bomba armata** 🔴 |

Le due VPS switchate di recente avevano il nome-vendor; le altre due erano su `claude`/`kimi` (accettati). Prova che i valori vendor **funzionano a runtime**: la VPS guasta ha operato correttamente su `active_provider="anthropic"` per ~24h (produzione reale) prima del reboot — l'unico componente che rifiutava quel valore era `config_ready`.

---

## Fix

### 1. `config_ready()` accetta entrambi i registri (`.launcher/agent-watchdog.sh`)

`markers` mappa ora sia i nomi-vendor sia i nomi-CLI allo stesso marker di credenziali:

```python
markers = {
  'kimi':      f'{jht_home}/.kimi/credentials/kimi-code.json',
  'claude':    f'{jht_home}/.claude/.credentials.json',
  'anthropic': f'{jht_home}/.claude/.credentials.json',
  'codex':     f'{jht_home}/.codex/auth.json',
  'openai':    f'{jht_home}/.codex/auth.json',
}
```

Nessun valore provider valido viene più rifiutato, indipendentemente dal registro.

### 2. Il ramo `else` non è più silenzioso (`.launcher/agent-watchdog.sh`)

Un `config_ready=false` **persistente** (oltre una grace di ~5 min, che copre il boot/wizard iniziale) ora **logga loud** il valore di `active_provider` e che il respawn è sospeso, con re-log periodico e un messaggio di recovery quando torna pronta. È l'assenza di questo log ad aver reso il guasto invisibile per 44h. Soglia configurabile via `JHT_CONFIG_NOT_READY_GRACE_TICKS`.

### 3. Validazione wizard allineata (`cli/wizard/setup-helpers.js`)

`validProviders` mescolava i registri (`['claude','openai','kimi']`): un `active_provider` vendor-canonico come `anthropic` veniva rifiutato. Esteso a `['claude','anthropic','openai','codex','kimi']` (additivo, nessuna regressione).

### Sblocco delle VPS live

Le VPS in produzione girano l'immagine deployata (fix non ancora baked). Sono state sbloccate applicando **a caldo** lo stesso fix a `config_ready` nel container, **senza toccare `active_provider`** (i valori vendor sono corretti). Dopo il patch il watchdog rispawna il core team entro un tick (~30s).

---

## Confusione residua da riconciliare (follow-up, NON in questo fix)

Il doppio-registro vendor/CLI è presente in più consumer, oggi tolleranti ma disallineati. Da centralizzare in **un'unica funzione di normalizzazione** provider → nome canonico, riusata ovunque:

- `shared/providers/loader.js` (risoluzione `providers.<name>`)
- `shared/skills/provider_capacity.py`, `token-meter.py`, `window_ratio_meter.py`, `check_usage.py` (metering/capacity; alcuni test scrivono `openai`, altri `claude`)
- `shared/llm/factory.py`
- il comando `jht providers use` (decidere se scrivere il nome-vendor canonico e adeguare tutti i lettori)

Finché non centralizzato, la regola difensiva è: **ogni lettore di `active_provider` accetta sia il nome-vendor sia il nome-CLI**.

---

## Timeline (UTC)

| Quando | Evento |
|---|---|
| Switch provider (giorni prima) | `active_provider` scritto col nome-vendor → difetto latente, invisibile (sessioni vive) |
| Reboot per upgrade RAM | Tutte le sessioni tmux azzerate → detona: `config_ready=false` blocca il respawn |
| Boot successivo | pid1 kicka ASSISTENTE; CAPITANO/MENTOR NON rinascono (watchdog gated). 0 log |
| ~44h | Pipeline ferma; manutenzione + daemon cloud attivi mascherano il guasto |
| Rilevazione | Analisi manuale della flotta: crew assente, `config_ready` exit 1, `active_provider` fuori-mappa |
| Fix | `config_ready` accetta i nomi-vendor + ramo `else` loud + `validProviders` esteso; VPS live patchate a caldo |

---

## Lezioni

1. **Un mismatch di stringa può uccidere un team in silenzio.** Ogni gate che sospende un comportamento critico deve **loggare loud** quando resta attivo oltre una grace ragionevole. Il silenzio "anti-spam" ha nascosto il guasto per 44h.
2. **Due registri di nomi per la stessa cosa = debito latente.** Vendor (`openai`/`anthropic`) vs CLI (`codex`/`claude`): va centralizzata la normalizzazione, non replicata la mappa in ogni file.
3. **Un difetto latente detona a un trigger banale** (un reboot di manutenzione). Dopo ogni operazione che azzera le sessioni (upgrade/reboot/redeploy) va verificato che il **core team rinasca**, non solo che il container sia `running`.
4. **Serve un watchdog di produzione** che allarmi se il core team (Capitano) è assente oltre N minuti in una VPS attiva: qui nessun meccanismo aveva l'autorità/visibilità per accorgersene (la Sentinella è advise-only e loggava "No CAPITANO to advise").
