# 💭 Pacing — idee di sofisticazione (questioni APERTE, future)

**Data:** 2026-06-25 · **Stato:** discusse, **NON implementate** — parcheggiate per dopo.
**Contesto:** emerse osservando il team Codex (betaA) che atterra il weekly al 100% ma NON
spalma uniforme dentro la giornata. Due idee, entrambe estensioni del **daily guardrail**
(C-19/S-09) e del **modello bridge→Sentinella** (vedi gli altri doc del 2026-06-25).

---

## 1. Even-spread giornaliero: daily guardrail da CAP → TARGET

**Osservazione:** dentro la finestra di lavoro da 12h il team NON ramppa liscio fino alla quota
giornaliera; front-loada (mattina = alert freschi + ramp giorno-1) e segue il dente di sega
delle finestre 5h. L'unico atterraggio pianificato è il **weekly** (al reset), non il giorno.

**Perché:** (a) l'unità operativa del pacing è la finestra **5h rolling**, non il giorno; (b) il
target è weekly-only (`sustainable_burn` flat, nessun "arriva al 14% per le 20:00"); (c) lavoro a
**lotti** + ramp del giorno-1.

**Idea:** oggi il `daily: oggi=Y% budget=X% cap=Z%` è usato solo come **tetto** (coast se
`oggi>cap`). Per l'even-spread aggiungere un **`daily_vel_target`** = pacizzare perché `oggi`
salga **linearmente fino a `budget` alla chiusura finestra** (come `vel_target` fa col weekly al
reset). Risultato: ramp liscio, atterra alla quota poco prima della chiusura, **output costante**
nella giornata invece che bunchato la mattina.

**Contro / priorità:** BASSA. Il weekly (ciò che conta per spreco/sforo) è già perfetto.
L'even-spread è soprattutto **uniformità d'output** (UX), non budget. E **front-loadare quando
c'è lavoro** è spesso *giusto* — forzare la goccia costante rischia di throttlare la mattina e
sotto-spendere il pomeriggio. Valutare DOPO aver visto il daily guardrail (cap) girare dal vivo.

---

## 2. Riserva di budget per le richieste utente (use-it-or-lose-it)

**Idea (utente):** tenere una **riserva** del weekly per le richieste utente (chat/CV/re-score/
ticket), **protetta durante la settimana**; se l'utente NON la usa, a fine ciclo viene **bruciata**
sul lavoro autonomo così non si spreca.

```
weekly = 100%
  ├─ target AUTONOMO ≈ 100% − R   (sourcing/analisi/scoring pacizzano QUI)
  └─ RISERVA R                     (cuscinetto richieste utente, tutta la settimana)
se a fine ciclo R è intatta → BURN-MODE la consuma l'ultimo giorno → atterra a 100%
```

**Buona notizia: metà esiste già.**
- Il "brucia l'ultimo giorno" = **BURN-MODE** (SOTTO-PACE + reset ≤~36h + spreco previsto →
  accelera). Se l'autonomo pacizza a `100%−R` e R resta intatta, il team è "sotto-pace vs 100%"
  → burn-mode la reclama da solo. Non va costruito.
- "Servire sempre l'utente" = già nella **flessibilità** C-19/S-09.
- Il cambiamento vero è **UNO**: far pacizzare l'**autonomo** a `100%−R` invece che a 100%.

**Nodi aperti (da decidere prima di implementare):**
1. **Non si separa burn-utente da burn-autonomo** — l'usage del rate-limit è UN numero solo.
   Quindi R è un **cuscinetto soft** (pacizza l'autonomo più conservativo, lascia headroom), NON
   contabilità precisa. Accettabile, ma da saperlo: riserva *statistica*, non portafoglio separato.
2. **R fisso o adattivo?** Inclinazione: **adattivo al ritmo di richieste osservato** — parte da
   ~0 (team in autonomia pura, come ora con `applied=0` → nessuno spreco) e cresce solo quando
   l'utente è attivo. Una R fissa grande su team autonomo = output autonomo sprecato tutta la
   settimana, poi un burn rushato di minor valore.
3. **Solo weekly** (reclamata l'ultimo giorno) **o anche un mini-cuscinetto giornaliero?**
4. **Tetto a R** (es. mai oltre 20-25%) per non affamare l'autonomo?

**Trade-off da non nascondere:** ogni punto di R = un punto di output autonomo in meno durante la
settimana, riconvertito in burn di fine ciclo (più frettoloso). Ha senso **solo se l'utente usa
davvero il team interattivamente**; per autonomia pura, R≈0 è ottimo.

**Decisione 2026-06-25:** lasciata APERTA per il futuro (utente). Rivalutare quando il team verrà
usato in modo interattivo / quando si vede il daily guardrail girare dal vivo.
