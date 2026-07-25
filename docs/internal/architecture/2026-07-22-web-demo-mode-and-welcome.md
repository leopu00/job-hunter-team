# 🎭 Demo mode + wizard `/welcome` — design & decision record (2026-07-22 → 07-23)

> **Design lock.** Onboarding dell'utente cloud **nuovo**: chi arriva su
> jobhunterteam.ai, fa login e non ha ancora un team collegato non deve trovare una
> dashboard vuota. Il wizard `/welcome` lo porta o al setup vero o dentro una **demo
> interattiva** completa, scelta per categoria di lavoro.
>
> Tag: `[JHT-WEB-DEMO]` — lo trovi come marker nei commenti del codice.
> Superficie: `web/` soltanto, **solo sul deploy cloud**. Sul desktop l'onboarding è
> quello del gioco (vedi [`onboarding-flow.md`](onboarding-flow.md) e
> `game/docs/FIRST-RUN.md`); questo documento non lo tocca.

---

## 1. 🎯 Il problema

Prima del 22/07 un utente nuovo sul cloud vedeva, nell'ordine: login → dashboard a
zero → nessun indizio su cosa fare. Le pagine erano tutte corrette e tutte vuote.
Tre conseguenze concrete:

1. **Non si capisce cosa fa il prodotto.** La dashboard è il punto in cui JHT si
   spiega da solo (score, dossier, mappa, giudizi) — a zero righe non spiega niente.
2. **Non si capisce cosa manca.** Il dato arriva dal container sul PC/VPS
   dell'utente: senza quel pezzo il cloud resta vuoto per sempre, ma la pagina non lo
   diceva.
3. **La pagina `/onboarding` del web era stata rimossa** (commit `9adb01ae`,
   2026-07-18: l'onboarding è migrato nel gioco) — quindi non esisteva più nessuna
   superficie web che accompagnasse l'utente.

Vincolo di partenza, non negoziabile: **il web resta read-only sui dati veri**
(memoria `feedback_web_readonly_is_security`). La demo non può diventare una scorciatoia
per scrivere sul database.

---

## 2. 🧭 La decisione

Due pezzi distinti, che si incontrano solo nell'ultimo step del wizard.

**(a) `/welcome`** — wizard in 4 step, cloud-only:

| Step | Cosa chiede | Dove porta |
|---|---|---|
| `lang` | lingua della piattaforma (7 endonimi: Italiano, English, Español, Français, Deutsch, Magyar, Português) | step successivo |
| `status` | a che punto sei col setup: non ho scaricato · ho scaricato · il team gira · **sto solo dando un'occhiata** | "solo un'occhiata" salta dritto alla demo |
| `path` | la via d'uscita giusta per quello stato: scarica l'app · avvia il team · collega col pairing token | fuori dal wizard (o alla demo) |
| `demo` | quale delle 4 categorie vuoi vedere | attiva la demo e ricarica su `/dashboard` |

**(b) demo mode** — un dataset statico per **4 personas** (`software`, `marketing`,
`finance`, `design`), **56 posizioni ciascuna**, che alimenta *tutte* le superfici
dell'area riservata come se fossero dati veri.

Perché una demo con dati finti e non uno screenshot o un video: le superfici che
contano (filtri, ordinamenti, dettaglio posizione, mappa, `/swipe`, messaggi del
team) sono **interattive**. Un video le mostra, non le fa provare — e il giudizio
sulle posizioni è esattamente il gesto che si vuole far provare.

---

## 3. 🍪 Come è fatta: lo stato sta nei cookie, mai nel database

Tre cookie, tutti path `/`, `sameSite=lax`, TTL 1 anno:

| Cookie | Chi lo scrive | A cosa serve |
|---|---|---|
| `jht_demo_persona` | `POST /api/demo` (httpOnly) | persona attiva → è **l'interruttore** della demo |
| `jht_demo_feedback` | `POST /api/positions/[legacyId]/feedback` | overlay dei giudizi dati alle posizioni demo |
| `jht_welcome_seen` | wizard (skip o scelta demo) | non riproporre `/welcome` a ogni visita |

`DELETE /api/demo` (banner "Esci dalla demo") cancella persona + giudizi e **tiene**
`jht_welcome_seen`: uscire dalla demo non deve rimettere l'utente nel wizard.
Cambiare persona invalida i giudizi della precedente (i `legacy_id` sono altri).

Il feedback demo nel cookie è un `{ "<legacyId>": { a: action, s: score } }` compatto,
con cap difensivo a 150 voci (un cookie ha ~4 KB di budget; le posizioni giudicabili
sono qualche decina, il cap non scatta mai in pratica). La semantica è la stessa del
feedback reale — **event-log, l'ultimo prevale** — solo che qui l'ultimo è anche
l'unico che si conserva. `demoVerdictOf()` in `lib/demo/mode.ts` replica la mappatura
a 4 livelli di `getVerdictMapByLegacyId()`, così `/swipe` e le card mostrano gli stessi
bollini del path reale.

---

## 4. 🔌 Il punto di innesto: un ramo in testa a `lib/queries.ts`

**La regola.** In ogni funzione di `web/lib/queries.ts` il ramo demo sta **in testa** e
vince su tutto (local e cloud):

```ts
const dp = await activeDemoPersona();
if (dp) return demo.demoPositions(dp, opts);
```

Sono ~20 punti di innesto (dashboard stats, posizioni, dettaglio, distribuzioni,
facet, coordinate mappa, località, swipe deck, messaggi, attività del team…), ognuno
con la sua funzione gemella in `web/lib/demo/queries.ts`.

Perché in testa e non in fondo: se il ramo demo fosse valutato dopo i controlli
local/cloud, ogni nuova diramazione di deploy potrebbe scavalcarlo e far comparire
dati veri (o un errore di connessione) dentro una sessione demo. Con il ramo in testa
l'invariante è banale da verificare leggendo le prime righe di ogni funzione.

`activeDemoPersona()` risponde `null` fuori dal cloud (`isCloudDeploy()`) e quando
`cookies()` viene chiamata fuori dal request scope (build/prerender) — quindi la demo
non può accendersi per sbaglio in un contesto statico.

**Override per test:** `JHT_WEB_DEMO_PERSONA=<persona>` forza la persona senza passare
dal wizard (stesso pattern di `JHT_WEB_DASHBOARD_DEMO`). È il modo con cui si collauda
la demo in locale su `next dev`.

---

## 5. ✍️ Le scritture: no-op esplicito, non un blocco

Le API di scrittura riconoscono gli id demo e **rispondono come farebbe il path
reale**, senza toccare Supabase:

- posizioni demo: `id` = `demo-<persona>-NNN`, `legacy_id` nel range **9000–9399**
  (`isDemoPositionId()` / `isDemoLegacyId()` in `lib/demo/data.ts`);
- messaggi demo: `id` con prefisso `demo-msg-`.

Route con ramo demo: `positions/[legacyId]/feedback` (scrive nel cookie overlay),
`positions/[legacyId]/user-exclude`, `positions/[legacyId]/summary`, `positions/seen`,
`applications`, `pending-messages/[id]/ack`, `pending-messages/[id]/reply`,
`profile/files`.

Perché no-op *silenzioso* e non `403`: il client (FeedbackButtons, SwipeDeck, drawer
messaggi) non deve sapere di essere in demo. Un errore visibile romperebbe la
dimostrazione proprio nel gesto che si vuole mostrare. La conseguenza è che il
prodotto reagisce, ma nulla esce dalla sessione dell'utente.

---

## 6. 🌍 Contenuti e localizzazione

- **Seed:** `web/lib/demo/seeds/<persona>.ts` — 56 posizioni con tutti i campi che le
  pagine consumano (score e breakdown per dimensione, highlight, dossier azienda,
  località e coordinate, sorgente, date).
- **Annunci in inglese di proposito:** un annuncio reale è quasi sempre in inglese;
  tradurlo avrebbe reso la demo meno credibile, non più chiara.
- **Voce degli agenti localizzata:** le parti scritte *dal team* (rationale dello
  Scorer, note del Critico, pro/contro) hanno l'italiano nei seed e un overlay per
  ogni altra lingua in `seeds/i18n/<persona>.<locale>.ts` — 4 personas × 6 locali = 24
  file, indicizzati da `seeds/i18n/index.ts`. `expand(key, seed, locale)` applica
  l'overlay e memoizza per `persona:locale`.
- **Profilo candidato** (`lib/demo/profile.ts`): uno per persona, così anche
  `/profile` è dimostrabile. Contenuti in inglese come un CV vero, nomi e contatti
  palesemente fittizi.

---

## 7. 🚩 Come si capisce che è una demo

Richiesta esplicita dell'utente (22/07): **i dati finti devono essere etichettati
sempre, non solo all'ingresso.**

- `DemoBanner` è renderizzato dal **layout protetto**, quindi è sotto la navbar su
  *ogni* pagina dell'area riservata, con le due uscite: "collega il tuo team" e "esci
  dalla demo".
- Il promemoria di pairing (UserMenu / Impostazioni) è pilotato da `hasSyncedData()` —
  che è deliberatamente **non** demo-aware: conta le posizioni **vere** dell'utente
  (head-count con RLS). Così, appena il primo sync reale arriva, il promemoria sparisce
  anche se la demo è ancora accesa. `cache()` di React garantisce una sola query per
  richiesta anche se layout e pagina la chiamano entrambi.

---

## 8. 🔗 Ingressi e uscite

- **Ingresso automatico:** `dashboard/page.tsx` — utente cloud senza dati e senza
  `jht_welcome_seen` → redirect a `/welcome`.
- **Ingresso manuale:** voce nel menu utente (`/welcome`); `?preview=1` mostra il
  wizard completo anche a chi ha già un team collegato, per rivederlo senza scollegare
  niente.
- **Uscita:** banner → `DELETE /api/demo`, oppure il primo sync reale (che spegne il
  promemoria ma **non** la demo: la persona resta finché l'utente non esce, così non
  gli si smonta la pagina sotto i piedi a metà lettura).

---

## 9. ⚖️ Alternative scartate

| Alternativa | Perché no |
|---|---|
| Seed di righe finte su Supabase per l'utente nuovo | Sporca il database vero con dati non suoi, va poi ripulito al primo sync, e apre la porta a scritture demo che diventano scritture reali. |
| Screenshot / video sul posto della dashboard | Non fa provare i filtri, il dettaglio e il giudizio — cioè proprio ciò che si vuole mostrare. |
| Demo come utente Supabase condiviso | Un account condiviso è scrivibile da chiunque; e la sessione demo diventerebbe un canale di scrittura verso dati veri di qualcun altro. |
| Blocco `403` sulle scritture in demo | L'errore compare esattamente nel gesto che stai dimostrando. Il no-op che risponde come il path reale mostra il comportamento senza propagarlo. |

---

## 10. 🚧 Aperto

- **Copertura e2e**: `/welcome` e il ramo demo non hanno spec Playwright
  (`e2e/tests/` è fermo al 03/07 e comunque non gira in CI). `JHT_WEB_DEMO_PERSONA`
  esiste apposta per renderli testabili senza passare dal wizard.
- **Cookie e privacy**: i tre cookie sono tecnici e per-sessione utente; la pagina
  pubblica *privacy-and-security* li dichiara dalla revisione del 2026-07-24.
- **Manutenzione dei seed**: ogni campo nuovo consumato dalle pagine va aggiunto ai 4
  seed, altrimenti la demo mostra un buco dove i dati veri hanno un valore. Non c'è
  (ancora) un test che lo verifichi: è il candidato naturale a un check di schema sui
  seed.

---

## 📚 Collegati

- [`2026-07-21-web-sync-realtime-rework.md`](2026-07-21-web-sync-realtime-rework.md) — la sync che porta i dati veri quando il team esiste
- [`2026-06-15-interaction-planes-redesign-design.md`](2026-06-15-interaction-planes-redesign-design.md) — perché il web è read-only e l'interazione vive nell'app nativa
- [`onboarding-flow.md`](onboarding-flow.md) — la sequenza canonica di onboarding del prodotto (lato container/app)
