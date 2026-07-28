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
