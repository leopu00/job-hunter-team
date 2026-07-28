# TICKET — Auto-aggiornamento della CLI del provider all'avvio

**Stato**: da implementare · **Tag**: `[PROVIDER-CLI-AUTOUPDATE]` ·
**Correlato**: `[PROVIDER-MODEL-DRIFT]` in `BACKLOG.md`

---

## Problema

Una VPS in produzione girava su una CLI ferma a una versione precedente, e il modello usato
era una generazione indietro rispetto a quello disponibile dal provider da **undici giorni**.
Nessuno se n'era accorto perché **nessun componente ha quel compito**:

- il **Mantenitore** cura l'infrastruttura (container, dipendenze, disco, RAM, browser,
  runtime) — il suo prompt non nomina mai provider o modelli
- il **Dottore** cura la salute degli agenti (sessioni vive, contesto, respawn)
- `jht providers update <p>` esiste e funziona, ma **si aggiorna solo se un umano lo lancia**

Costo concreto misurato: due agenti si sono impantanati a 565k e 168k token contro una
finestra da 262k e hanno richiesto un intervento manuale. La versione più recente del modello
offre una finestra da 1M — quel blocco non sarebbe avvenuto.

---

## Cosa deve fare

**All'avvio del container**, prima che il team parta, il sistema aggiorna da sé la CLI del
provider attivo, e lascia traccia di cosa ha fatto.

### Comportamento richiesto

1. Legge il provider attivo da `jht.config.json` (`active_provider`).
2. Registra la **versione installata** prima dell'aggiornamento.
3. Esegue l'update per quel solo provider — la logica esiste già in
   `cli/src/commands/providers.js::handleUpdateInContainer()` (npm per claude/codex,
   `uv tool install --force` per kimi).
4. Registra la **versione dopo**, e logga esplicitamente se è cambiata.
5. **Solo dopo**, avvia bridge e team.

### Punto di aggancio

`cli/src/commands/pid1.js` — è l'entrypoint del container e già orchestra bridge, watchdog e
cloud daemon in base alla modalità (`vps` / `vps senza cloud` / `local`). L'update va inserito
**prima** dell'avvio dei bridge.

---

## Vincoli non negoziabili

**Fail-safe.** Se l'update fallisce — rete assente, registry irraggiungibile, versione rotta —
il container **deve partire lo stesso** con la CLI già presente. Un aggiornamento non riuscito
non può impedire al team di lavorare: logga l'errore e prosegui. Questa è la regola più
importante del ticket.

**Solo il provider attivo.** Non aggiornare i tre CLI a ogni avvio: è banda e tempo sprecati,
e allunga il boot per nulla.

**Non cambia il modello.** L'aggiornamento riguarda **la CLI**, non il modello in uso. Passare
a un modello nuovo cambia costi, comportamento e finestra di contesto: resta una decisione
dell'utente. Se dopo l'update il CLI espone un modello più recente di quello attivo, va
**segnalato al Capitano come finding**, non applicato.

**Non a metà lavoro.** Solo all'avvio del container. Un update mentre gli agenti girano
sostituisce il binario sotto processi vivi.

**Disattivabile.** Una variabile d'ambiente (es. `JHT_PROVIDER_AUTOUPDATE=0`) deve poterlo
spegnere: serve per riprodurre un bug su una versione precisa, e per chi non vuole che il
boot dipenda dalla rete.

---

## Criteri di accettazione

Il test è diretto: si deploya il container nuovo su una VPS che ha una CLI vecchia e si
osserva l'avvio.

| # | Verifica | Atteso |
|---|---|---|
| 1 | Avvio con CLI obsoleta | la CLI risulta aggiornata **prima** che parta il primo agente |
| 2 | Log di avvio | contiene versione **prima → dopo**, e dice esplicitamente se non è cambiata |
| 3 | Avvio senza rete | il container parte comunque, l'errore è loggato, il team lavora |
| 4 | Provider attivo `kimi` | vengono aggiornati **solo** i pacchetti di kimi |
| 5 | Modello | resta quello di prima; un'eventuale versione più recente è **segnalata**, non applicata |
| 6 | `JHT_PROVIDER_AUTOUPDATE=0` | nessun tentativo di update, avvio invariato |
| 7 | Secondo riavvio consecutivo | riconosce che è già aggiornato e non reinstalla |

---

## ⚠️ Aggiornamento dopo il primo test in campo (2026-07-28)

L'auto-update **funziona** — log corretto, solo il provider attivo, modello non toccato — ma
il test ha mostrato che **non basta a mantenere aggiornato il modello**, che era lo scopo per
cui il ticket è nato.

La CLI era già all'ultima versione, eppure il team girava su una generazione precedente. Il
motivo è che **la CLI del provider si scrive un pin al primo login** e non lo rivede mai più:

```toml
# $JHT_HOME/.kimi/config.toml — scritto al login, mai aggiornato
default_model = "kimi-code/kimi-for-coding"

[models."kimi-code/kimi-for-coding"]
  provider         = "managed:kimi-code"
  max_context_size = 262144
  display_name     = "K2.7 Coding"
```

Due conseguenze, entrambe osservate:

1. **Il modello resta quello del giorno del login.** Se il provider promuove un nuovo default,
   il team non lo prende: continua a puntare all'alias fotografato. Aggiornare la CLI non
   sposta nulla.
2. **Anche le capability sono congelate.** `max_context_size = 262144` è esattamente la
   finestra contro cui due agenti si sono bloccati (565k e 168k token). Il modello nuovo ne
   dichiara 1M: finché quel blocco resta, il team lavora con un quarto della finestra reale
   *anche se il modello sotto fosse cambiato*.

**JHT non è responsabile del pin**: `start-agent.sh` non passa `--model` per kimi/codex
(*"il model override non è ancora cablato"*) e lascia deliberatamente il default al provider.
Il pin lo scrive la CLI.

### Cosa aggiungere al ticket

All'avvio, dopo l'update della CLI e **prima** dello spawn degli agenti:

- rilevare se il config del provider contiene un pin di modello/capability scritto in un login
  precedente;
- se il default del provider è cambiato, **invalidare il pin** (rimuovere `default_model` e il
  blocco `[models."…"]`) così la CLI lo riscrive con i valori correnti al primo uso;
- **riportarlo al Capitano come finding**, con vecchio e nuovo modello: un cambio di modello
  altera costo, comportamento e finestra: l'utente deve saperlo, anche quando è desiderato.

Vincoli aggiuntivi:

- **Verificare prima di invalidare.** Se l'alias nuovo non è disponibile sul piano
  dell'account, cancellare il pin lascia la CLI senza modello e **il team non parte**. Il
  controllo va fatto contro ciò che l'account espone davvero, non contro l'ultimo modello
  annunciato dal provider.
- **Fail-safe come il resto del ticket**: in caso di dubbio si tiene il pin esistente e si
  segnala. Un team che lavora su un modello vecchio è enormemente meglio di un team fermo.
- Se un domani si volesse *fissare* deliberatamente un modello (per riprodurre un bug, o per
  costo), quello **sì** deve essere un flag esplicito di JHT — ed è l'unica cosa che deve
  impedire l'aggiornamento automatico.

## 🔴 FOLLOW-UP dopo il test in campo delle 15:55 (2026-07-28)

Il passo `model-pin` ha girato in produzione e **non ha aggiornato**, pur essendo il modello
nuovo pienamente disponibile. Due difetti distinti, entrambi da correggere: così com'è, il
passo non promuoverà **mai** un modello.

### 1. Il probe dà falso negativo

Log reale del boot:

```
[model-pin] kimi: pin trovato → `kimi-code/kimi-for-coding`, ctx 262144, "K2.7 Coding"
[model-pin] probe: kimi --config-file <copia> info
[model-pin] probe: kimi --config-file <copia> --quiet -p ok
[model-pin] kimi: verifica INCONCLUSIVA (--quiet -p ok exit 1
            — To resume this session: kimi -r f5c7339d-…) — pin lasciato com'è
```

Ma lo stesso modello, provato a mano un minuto dopo:

```
$ kimi --model kimi-code/k3 --quiet -p "rispondi solo: ok"
ok
--- exit: 0 ---
```

**Il modello risponde.** Da indagare perché il probe ottiene exit 1: la riga
`To resume this session: …` compare **anche sui successi**, quindi non è un indicatore di
errore e non va usata come tale. Ipotesi da verificare: un prompt di una sola parola (`ok`)
produce un turno che la CLI chiude in modo diverso, oppure la copia del config senza pin
lascia la CLI senza modello risolto e il fallimento è della *copia*, non del modello.

Finché il probe non distingue "il modello non è disponibile" da "il probe non ha saputo
chiederglielo", l'esito è sempre INCONCLUSIVO e il passo resta decorativo.

### 2. Invalidare il pin non basta: va **sostituito**

L'approccio attuale rimuove `default_model` e si aspetta che la CLI lo riscriva aggiornato.
Non funziona: la CLI lo riscrive puntando **di nuovo al vecchio alias**, perché quello è il
default del piano. Osservato: dopo il boot il file era di nuovo `kimi-for-coding`.

Ciò che ha funzionato davvero è stata la **sostituzione esplicita**:

```bash
sed -i 's|^default_model = .*|default_model = "kimi-code/k3"|' $JHT_HOME/.kimi/config.toml
# poi kill dei core + jht team start → agent (K3 ●), contesto 262144 → 1048576
```

Quindi il passo deve: leggere gli alias che il config **già elenca** (`[models."…"]` — nel caso
reale erano `kimi-for-coding`, `kimi-for-coding-highspeed`, `k3`, `k3-256k`), scegliere il
migliore disponibile, e **scriverlo**. Non cancellare e sperare.

Criterio per "migliore": non il nome, che cambia a ogni generazione, ma le **capability
dichiarate nel config stesso** — a parità di famiglia, la `max_context_size` più alta. Nel caso
osservato `k3` (1048576) contro `k3-256k` (262144): stesso modello, finestra diversa.

### 3. Nota operativa

Il cambio richiede un **riavvio delle sessioni**: gli agenti leggono il pin all'avvio, quindi
finché non ripartono continuano sul vecchio modello anche a config aggiornato. Il passo gira
già prima degli spawn al boot, quindi in quel percorso è coperto — ma un `model-pin` lanciato a
mano su un team vivo non ha effetto finché qualcuno non riavvia.

### Come è stato implementato l'addendum (`cli/src/commands/model-pin.js`)

Il passo gira dentro `jht providers autoupdate`, subito **dopo** l'update della CLI (la verifica
la deve fare la CLI nuova) e **prima** di qualunque spawn, perché ogni sessione legge il pin
all'avvio. Invocabile anche a mano: `jht providers model-pin [--dry-run]`.

**La verifica prima di invalidare** — non si confronta con "l'ultimo modello annunciato dal
provider", che non sa niente del piano di questo account. Si esegue **la stessa identica
mutazione su una copia del config** (`kimi --config-file <copia-senza-pin>`) puntando alla share
dir **vera**, quindi con le credenziali vere: se lì la CLI risolve un modello concreto con le sue
capability, la stessa mutazione sul file vero produrrà uno stato funzionante — è una prova per
costruzione, non un'inferenza. Ladder: `info` (locale, costo zero) e, solo se non basta,
`--quiet -p "ok"` (un turno minimo, che prova anche che il modello **risponde** su questo piano).
Le credenziali **non** vengono copiate: un refresh OAuth nella copia potrebbe ruotare il refresh
token e invalidare quello vero, cioè fare al team un danno peggiore del pin.

**Se la verifica non è conclusiva** (CLI che non riscrive, rete assente, timeout, 429, credenziali
mancanti) non si tocca **niente** e parte solo il finding. Stessa cosa con `JHT_MODEL_PIN=<x>`,
il flag esplicito di pinning deliberato — l'unica cosa che impedisce l'aggiornamento automatico.
`JHT_PROVIDER_AUTOUPDATE=0` continua a spegnere tutto il passo di boot.

**Copertura per provider** — i tre non pinnano allo stesso modo:

| Provider | Dove pinna | Cosa fa JHT |
|---|---|---|
| kimi | `$JHT_HOME/.kimi/config.toml` — `default_model` + `[models."…"]` scritti al login | rileva, verifica, **invalida** (backup `*.bak-model-pin-<ts>` + scrittura atomica) |
| codex | `$JHT_HOME/.codex/config.toml` — `model = "…"`, solo se scelto da TUI/mano | **solo segnalato**: il default sta nel binario e non viene riscritto nel file (invalidazione non verificabile), e lo stesso file contiene le entry `trust_level` degli agenti |
| claude | — | **non applicabile**: `start-agent.sh` passa `--model opus\|sonnet` a ogni spawn e gli alias seguono la generazione |

Due guardie che valgono per un passo che gira **a ogni boot**: il finding non si ripete finché la
situazione è la stessa, e se dopo un'invalidazione la CLI ri-pinna un valore identico non si
riscrive il config all'infinito — si smette e resta il finding già consegnato.

## Note per chi implementa

`handleUpdateInContainer()` è già il percorso giusto quando `IS_CONTAINER=1`: scrive in
`/jht_home/.npm-global` (bind-mount) per npm, e in `/opt/jht-deps` per uv, quindi
l'aggiornamento **persiste fra riavvii** senza rifare il lavoro ogni volta — il criterio 7 si
soddisfa da solo se si riusa quella funzione invece di reinventarla.

⚠️ Attenzione al PATH: i binari installati via `uv tool` finiscono in
`/opt/jht-deps/npm-global/bin`, che **non era** nella lista di `JHT_SPAWN_PANE_PATH` — è stato
il motivo per cui Dottore e Mantenitore non partivano più (`fix(spawn)`, 2026-07-28). Se
l'update cambia la posizione di un binario, quella lista va verificata.

Il tempo aggiunto al boot va misurato: se l'update richiede più di qualche decina di secondi,
conviene farlo **in parallelo** all'avvio dei bridge e far attendere solo lo spawn degli
agenti, invece di ritardare tutto il container.
