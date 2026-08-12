# 🤝 Contratto fra i due owner del repo — branch, claim, verifica

**Versione 1 — 2026-08-12.** Fonte unica per [CROSS-BOUNDARY-CONTRACT-FREEZE]:
entrambi gli owner implementano e revisionano contro QUESTO documento, non
contro il ricordo di una conversazione. Il protocollo qui dentro è stato
deciso a voce il 12/08/2026 e fin qui non era scritto da nessuna parte — che è
esattamente il difetto che il ticket descrive.

Regola di modifica (§6): ogni cambiamento è una correzione esplicita che
supersede questa versione, e va annunciata prima di riprendere il lavoro.

---

## 1. 👥 Chi sono i due owner

| Owner | Macchina | Branch di lavoro | Linea di integrazione |
|---|---|---|---|
| **devN** (questa) | PC Leone, 4 worktree `dev1..dev4`, una sessione Claude per worktree | `dev1`, `dev2`, `dev3`, `dev4` | `integration` |
| **HQ** (altro PC) | secondo team, stesso repo remoto | `backend`, `game`, `fullstack-1`, `fullstack-2` | `hq-master` |

Stato di fatto al momento del congelamento (misurato, non dichiarato):
`hq-master` porta **2 commit** che `integration` non ha, `integration` ne
porta **26** che `hq-master` non ha. Le due linee **divergono oggi**, e questo
documento non finge il contrario: come e quando si riconciliano è una
decisione aperta (§7).

## 2. 🌳 I ruoli dei branch — chi scrive dove

| Branch | Ruolo | Chi ci scrive | Chi NON ci scrive |
|---|---|---|---|
| `master` | branch di Leone; fino al 12/08 era la linea di integrazione | **solo Leone** | nessun agente, di nessuna delle due macchine |
| `integration` | integrazione della macchina devN (nato il 12/08 a `b7631c14e2`) | **solo Leone**, mergiando i `devN` | gli agenti non ci committano né mergiano; ci fanno solo `git pull origin integration` |
| `hq-master` | linea di integrazione dell'altro PC | l'owner HQ | la macchina devN non lo tocca |
| `production` | deploya la produzione web | solo Leone | nessun agente |
| `devN` | lavoro di UNA sessione della macchina devN | la sessione che ci vive (commit+push diretti, mai PR) | le altre sessioni e l'altro PC |
| `backend`, `fullstack-1`, `fullstack-2` | lavoro dell'owner HQ | l'owner HQ | la macchina devN |
| `game` | congelato: 30 commit unici, protetto per T-018 | nessuno, fino a decisione | tutti |

Direzioni dei merge, oggi: `devN → integration` (li fa Leone);
`fullstack-* / backend → hq-master` (li fa l'owner HQ — direzione osservata
nella storia remota, es. `5693eac3b1`). Ogni altra direzione — in particolare
`hq-master ↔ integration` e la promozione verso `production` — **non ha oggi
un flusso deciso**: sta in §7, non qui.

## 3. 🏷️ Il claim di un ticket

Il claim è **il primo gesto del ticket, prima di toccare codice** — e viene
dopo la verifica del §4. Senza claim pushato, due macchine possono prendere lo
stesso ticket e scoprirlo a lavoro fatto.

```
git commit --allow-empty -m "WIP(<scope>): <cosa stai per fare> (<ID-TICKET>)"
git push origin <tuobranch>
```

- **L'ID del ticket va SEMPRE fra parentesi in coda**: è la chiave con cui un
  claim si cerca (§4). Un claim senza ID in coda è invisibile alla ricerca,
  cioè non è un claim.
- La convenzione non nasce qui: è quella già in uso nella storia remota
  (es. `6981e058dd` «WIP(db): note table keyed by origin — NOT FOR MERGE, two
  tests red (O-33)», `ffe47a1bb2`).
- Si continua a committare **a piccoli passi**, ogni commit intermedio può
  tenere il marcatore `WIP(...)`. Il marcatore si toglie **solo nel commit che
  chiude il ticket**.
- Lavoro incompleto si dichiara **nel messaggio del commit** — `NOT FOR
  MERGE`, `INCOMPLETO` — non in un posto esterno: un commit che sembra finito
  e non lo è fa danni a chi mergia. È già successo: il ramo marcato `NOT FOR
  MERGE` di O-33 è finito in master comunque, e il marcatore è ciò che ha
  permesso di capirlo a posteriori.

## 4. 🔍 Come si verifica un claim, PRIMA di prendere un ticket

Il comando canonico è lo strumento, non una procedura a mano:

```
git fetch --all --prune
python3 scripts/branch_census.py --claim <ID-TICKET> --base origin/integration
```

I verdetti sono cinque, e ognuno ha una condotta:

| Verdetto | Significato | Cosa fai |
|---|---|---|
| `LIBERO` | nessun commit remoto nomina l'ID, e la copia dei ref è allineata | claim (§3) e lavora |
| `TUO` | claimato solo sul tuo branch | prosegui |
| `CLAIMATO` | l'ID compare su un branch altrui, non integrato | **fermati e chiedi a Leone**, non lavorarci |
| `FATTO` | tutti i commit che lo nominano sono già nella base | il ticket risulta chiuso: segnalalo invece di rifarlo |
| `IGNOTO` | la ricerca non è conclusiva | §5 |

Nota su `--base`: il default dello script è ancora `origin/master`; per la
macchina devN la base giusta è `origin/integration` e va passata esplicita.
Un claim dell'owner HQ mergiato in `hq-master` ma non in `integration` risulta
`CLAIMATO`, non `FATTO` — ed è il comportamento giusto: quel lavoro esiste,
solo non da questa parte del confine.

## 5. 🛑 Semantica fail-closed del contratto

Quando la verifica **non è conclusiva, ci si ferma e si chiede a Leone. Non si
indovina.** È la stessa regola già applicata dal census dei branch, dai path
del database e dal freno settimanale — e lo script la implementa già:

- «non ho trovato niente» vale come `LIBERO` **solo se** la copia dei ref
  remoti è allineata (verificata via `ls-remote`). Copia indietro o fetch
  fallito → `IGNOTO`, con l'istruzione di rifare `git fetch --all --prune`.
  Dire «libero» per ignoranza è il modo in cui due macchine finiscono sullo
  stesso ticket.
- «ho trovato un claim» resta valido **anche con la copia indietro**: trovarlo
  è prova positiva, e una copia stantia non la smentisce.
- ID ambiguo (più claim su branch diversi, o git che non sa dire se sono in
  base) → `IGNOTO`, fermarsi e chiedere.
- `--no-remote-check` esiste ed è una **deroga esplicita** dichiarata in testa
  al report: si usa solo sapendo di accettare i propri ref di tracking come
  autorità, mai come default.

## 6. 📌 Versione e regola di modifica

- Questo documento è **versionato dentro il repo**: la storia di git è la
  storia del contratto.
- Ogni modifica è una **correzione esplicita che supersede la versione
  precedente**: si alza il numero in testa, si scrive cosa cambia e perché, e
  si **annuncia all'altro owner prima di riprendere il lavoro** a cavallo del
  confine. Niente modifiche silenziose che l'altra parte scopre a merge
  fallito.
- Varianti concorrenti del protocollo non entrano nei branch: finché una
  correzione non è qui dentro, vale la versione scritta.

## 7. ❓ Decisioni aperte (di Leone, non inventate qui)

1. **Chi riconcilia `hq-master` e `integration`, in che direzione e con che
   cadenza.** Oggi le linee divergono (+2 / +26) e nessun flusso è deciso.
2. **La promozione verso `production`**: chi la fa, da quale branch, con che
   criterio. Oggi `production` è 21 commit dietro `master`.
3. **Il destino del branch `game`** (30 commit unici, congelato per T-018):
   merge o abbandono — è la decisione che il census rifiuta, giustamente, di
   prendere da solo.

## 8. ⚠️ Stato di fatto, non di diritto

Cose vere oggi che il contratto NON dà per risolte:

- il protocollo di claim è adottato dalla macchina devN **da oggi**; i commit
  più vecchi di oggi non lo rispettano e la ricerca per ID non li vede.
- la base di `branch_census.py` va passata a mano (§4): il default punta
  ancora a `master`.
- questo documento è stato scritto dalla parte devN del confine: l'owner HQ
  non l'ha ancora **né letto né confermato**. Finché non succede, è un
  contratto firmato da uno — la conferma è il primo lavoro a cavallo del
  confine su cui giudicarlo.
