# Bug strategici team — sessione 2026-05-16 → 17

**Fonti**:
- conversazione utente ↔ @Capitano via Telegram dalle 17:27 alle 00:03, ricostruita
  da `/jht_home/.kimi/user-history/<md5>.jsonl` + estrazione di 38 risposte uniche
  del Capitano dai `wire.jsonl` delle sessioni Kimi.
- conversazione utente ↔ @Mentor dalle 23:38 alle 00:28 (6 messaggi utente, 6
  risposte Mentor), stessa pipeline di estrazione su md5 di `/jht_home/agents/mentor`.

I bug qui sotto sono **strategici / comportamentali**, non infrastrutturali.
Tutti i fix di infra (kimi auth, welcome, sync banner, sentinel ticks → Supabase)
sono già stati chiusi nei commit di ieri.

---

## 🐛 1. Voice / Photo dal tg-bridge: niente Whisper / OCR / Vision

**Sintomi**:
- 19:14 — utente manda nota vocale di 2s al @Capitano. Bridge salva
  `/jht_home/profile/inbox/voice-AwACAgQAAx.ogg` (59 KB) ma nessuno la
  trascrive.
- Risposta Capitano (msg #13): *"Ricevuto vocale (2s). Non posso processare
  audio da CLI. Scrivimi il messaggio, ti rispondo subito."*
- 00:08 — utente manda **screenshot della pagina `/positions`** (`photo-AgACAgQAAx.jpg`,
  67 KB) col contenuto delle "14 most recent" posizioni.
- Risposta Capitano (msg #36): *"Ricevuta foto (67KB). Non ho OCR disponibile,
  descrivimi cosa c'è o scrivimi il testo."*

⚠️ **Aggravante — hallucination post-correzione utente**: dopo che l'utente
ha descritto a parole il contenuto, Capitano (msg #37) ha risposto *"Vedo
la dashboard. Stato confermato: ✅ 2 READY, 📝 2 WRITING, ⭐ 10 SCORED…"*.
Non l'ha vista — stava solo descrivendo dati che conosceva già dal DB
locale. La frase "Vedo la dashboard" è una piccola allucinazione (Kimi
non si è auto-corretto).

**Causa**: `tg-bridge.py` scarica l'allegato ma non chiama Whisper (voice),
OCR (testo in immagini), o Vision API (interpretazione di screenshot/grafici).
Il messaggio iniettato nel tmux dell'agente è solo il **path** del file, non
il contenuto trascritto/visto.

**Fix proposto**:
- Voice: chiamare Whisper (locale `whisper.cpp` oppure remoto Moonshot/OpenAI)
  appena scaricato il file → iniettare `[TG-VOICE] transcript="…"` nel pane.
- Photo: pipeline duale. (a) Vision LLM (Kimi-vl / GPT-4o-mini) per "cosa c'è
  nella foto" — descrizione semantica. (b) OCR Tesseract se serve testo
  estratto verbatim.
- Fallback se STT/OCR/Vision fallisce: lasciare il path + un flag esplicito
  `[TG-DOC unprocessed]` così l'agente sa di NON inventare descrizioni.
- Aggiungere al prompt agente la regola: *"se ricevi un allegato e NON c'è
  transcript/OCR/vision-description nel marker, NON inventare contenuto.
  Chiedi all'utente."*

**Priorità**: alta. È il canale principale dell'utente (telefono).

---

## 🐛 2. Sentinella ipersensibile: freeze totale + kill invece di throttle progressivo

**Sintomi**:
- 22:45 Bridge segnala `usage=20% proj=207.27%` → Sentinella `[EMERGENZA]
  FREEZATO IL TEAM. Throttle: 4 (ordina jht-throttle 600 --reason 'freeze
  EMERGENZA')`.
- 22:54 (post-freeze) proj risale momentaneamente a 128% → Sentinella `[URG]
  Esegui freeze_team.py SUBITO + kill anche i Sonnet rimasti. Niente più
  operativi fino a reset finestra.`
- 23:30 bridge mostra `proj=115% trend SCENDE_OK` → Sentinella continua a
  bloccare tutto.

**Causa**: la Sentinella reagisce a picchi singoli con azioni binarie
(freeze totale → kill) invece di modulare throttle in base al trend.
Risultato: il team resta congelato per >3h per un picco che era già in
discesa, sprecando budget.

**Capitano stesso ammette** (msg #33):
> *"La Sentinella ha reagito a un picco di 128% quando il bridge mostrava
> già MARGINE (sotto target) e trend in discesa. Ordine di killare era
> eccessivo — cooldown sarebbe bastato."*

**Fix proposto** — Sentinella deve gestire 4 livelli e fare hysteresis:
| Livello | Trigger | Azione |
|---|---|---|
| 0 OK | proj < 95% & trend NEUTRO | nulla |
| 1 ATTENZIONE | 95 ≤ proj < 110% | throttle worker x2 (90s → 180s) |
| 2 SFORO | 110 ≤ proj < 150% & trend ↑ | throttle x4 + scout pause |
| 3 EMERGENZA | proj ≥ 150% & trend ↑ persistente (3 tick) | freeze tutto |

Nessun **kill** dei processi, solo throttle. `freeze_team.py` deve essere
reversibile via un `[UNFREEZE]` quando il trend è SCENDE_OK per 2 tick.

**Priorità**: alta. Bug più impattante della sessione.

---

## 🐛 3. Capitano paralizzato dalla regola C-01 ("Sentinella ha priorità assoluta")

**Sintomi**:
- Bridge mostra `MARGINE — possiamo accelerare del 25%` ma Capitano non
  riparte perché Sentinella ha ordinato `Niente più operativi fino a reset`.
- Utente forza con messaggi ripetuti (msg utente 23:35 / 23:36 / 23:41 /
  00:00 / 00:03), Capitano risponde sempre "non posso disobbedire a C-01".

**Citazione Capitano** (msg #27):
> *"Le regole dicono di seguire la Sentinella, ma non di restare paralizzati
> quando i dati del bridge dicono che si può accelerare."*

**Causa**: `agents/capitano/capitano.md` ha la regola C-01 come assoluta,
senza override utente. L'utente che dà ordine esplicito via TG dovrebbe avere
**priorità massima** (è il "proprietario" del sistema), ma non c'è una
gerarchia documentata.

**Fix proposto** — gerarchia esplicita in `capitano.md`:
1. **Utente diretto via [TG] / [CHAT]** (massimo) — override su tutto
2. **Sentinella** — autorità sul budget, ma non sull'apply finale
3. **Bridge tick** — info per decisioni autonome
4. **Auto-pilot Capitano** — solo se nessuno dei sopra è attivo

Quando l'utente dice "riparti", Capitano deve poter disobbedire alla
Sentinella, accettando il rischio (`[@capitano -> @system] [OVERRIDE]
ripresa su ordine utente, ignoro sentinella`).

**Priorità**: media. Da fare insieme al #2.

---

## 🐛 4. Performance band 85-95% non rispettata → spreco budget

**Sintomi**:
- Sessione chiude al **30-35% di usage** (vs target 90-95% per finestra).
- Utente lo segnala esplicitamente (msg utente 23:37):
  > *"Devi sempre raggiungere il target di 90-95% ad ogni finestra. Non
  > la hai come regola tra i tuoi file?"*
- Capitano risponde (msg #28): *"Hai ragione. Regola AGENTS.md § Performance
  band 85-95% — chiudere sotto 85% è spreco."*

**Causa**: la regola esiste in `AGENTS.md` ma è dominata dalla C-01 (vedi
bug #3). Quando Sentinella ordina freeze, Capitano non considera più il
target 85-95%.

**Fix proposto**: dopo che #3 è risolto, il Capitano deve avere un loop
"termostato":
- proj < 85% al midpoint della finestra → **accelera** (azzera throttle
  worker, riapri Scout)
- 85 ≤ proj < 95% → mantieni ritmo
- proj > 95% → **rallenta progressivo** (throttle worker x1.5)
- proj > 110% → vedi #2 (Sentinella)

**Priorità**: media. Effetto secondario di #2 + #3.

---

## 🐛 5. Bridge latency al boot ("non ha ancora emesso il primo campione")

**Sintomi**:
- 17:27 utente chiede consumo → Capitano risponde (msg #2): *"Bridge non
  ha ancora emesso il primo campione — team appena avviato. Ti do il numero
  non appena la Sentinella fa il primo poll (pochi minuti)."*
- 17:28 utente insiste → Capitano (msg #4): *"Bridge muto perche' la
  Sentinella non e' ancora accesa. La avvio ora, tra 2-3 min ho il numero
  esatto."*

**Causa**: `sentinel-bridge.py` non è avviato automaticamente da `pid1` al
boot — partiva solo come parte del bootstrap completo team-wide. Bug noto e
**già fixato in parte**: ora pid1 lancia il bridge se config presente, ma c'è
ancora un cold start di ~3 min in cui il primo tick non è disponibile.

**Fix proposto**: ridurre la cadenza del primo poll a 30s post-boot (poi
tornare a 3 min). Oppure il Capitano deve dire all'utente "primo dato fra
N minuti" con countdown esplicito invece di "pochi minuti".

**Priorità**: bassa. Già migliorato, è solo UX.

---

## 🐛 6. Risposte Capitano fuori scope (Giovanni Odazzi)

**Sintomi**:
- Utente chiede info su "Giovanni Odazzi" (test/troll).
- Capitano (msg #17) chiede "è qualcuno che dovrei conoscere per la tua
  candidatura?".
- All'insistenza utente, risponde con biografia completa del pittore barocco
  (msg #18): 1663-1731, San Giovanni in Laterano, ecc. + finale *"Cosa
  c'entra con la tua ricerca lavoro?"*.

**Causa**: il Capitano non ha un guardrail "stay on topic". Risponde a
qualsiasi domanda perché Kimi è LLM general purpose.

**Fix proposto** (debole, opzionale): aggiungere al prompt capitano una
regola "domande fuori scope (cultura generale, opinioni personali, ecc.)
→ rispondi brevemente che ti occupi solo della ricerca lavoro e cosa
puoi fare per quella".

**Priorità**: bassa. È più una scelta di prodotto che un bug.

---

## 🐛 7. Storico/transcript NON sincronizzato in Supabase

**Osservazione**: questa intera analisi è stata fatta accedendo via SSH al
`wire.jsonl` di Kimi sulla VPS. La conversazione utente↔agente NON è
visibile sulla dashboard cloud (`jobhunterteam.ai/team/capitano` non ha la
chat-history). L'utente potrebbe voler rivedere cosa ha scritto al
Capitano senza scrollare Telegram.

**Fix proposto**: estendere il cloud daemon push per includere anche le
ultime N entries (es. 100) della history del Capitano (e altri user-facing)
in una tabella `agent_messages(user_id, agent, ts, direction, body)`. Pagina
`/team/<agent>` web mostra la conversazione come una chat.

**Priorità**: media. Migliora drasticamente l'UX cloud.

---

## ✨ 8. (Falso bug) Generazione PNG/grafici — **funziona**

**Smentita**: il Capitano sa generare PNG via matplotlib di propria
iniziativa, e ha iterato 3 versioni del grafico richiesto:

1. `/tmp/usage_chart.png` (23:29, 10 KB) — primo abbozzo
2. `/tmp/usage_chart_v2.png` (00:11, 13 KB) — seconda iterazione
3. `/tmp/budget_chart.png` (00:18, 22 KB) — **versione finale mandata
   all'utente**, con linea retta rossa target esattamente come richiesto

Il grafico finale mostra:
- Linea blu: usage reale (campionato dal bridge, 0→43% in 2h)
- Linea rossa retta: trend medio richiesto per chiudere al 95% alle 03:11
- Punto giallo: now (00:13, usage 43%)
- Punto rosso: target chiusura (03:11, 95%)
- Background a zone (verde sotto 95%, rosso sopra)
- Annotation: `v_media=17.6%/h → 95.0% @ 03:11`

**Mio errore di analisi** nel writeup precedente: avevo letto solo
le risposte 37-41 (descrizioni a parole post-photo), pensando che il
Capitano non avesse risposto al grafico. In realtà la generazione era
avvenuta in parallelo via `Shell(matplotlib ...)` e l'invio via
`jht-telegram-send --photo budget_chart.png` (o equivalente). Conferma
che `jht-telegram-send` supporta già `sendPhoto` di Bot API.

**Implicazione positiva**: gli agenti hanno tool potenti (matplotlib,
PIL, ecc.) e li usano. Non serve aggiungere skill `generate-chart`
formale — basta documentare il pattern come reference.

**Possibile miglioramento (opzionale)**:
- Allegare al filesystem `/jht_user/output/charts/` invece di `/tmp/`
  così i grafici vengono persistiti + sincronizzati al cloud.
- Skill formale che documenta il pattern matplotlib → Telegram per gli
  altri agenti che potrebbero volerlo usare (Mentor digest settimanale,
  Scout report visivi).

---

## ✅ 9. ~~Submit-application skill mancante~~ — **FALSO BUG, decisione di design "user-curated apply"**

> **STATUS: NON È UN BUG.** Smentito dall'utente in revisione 2026-05-17:
>
> *"Le applicazioni non le manderemo mai in automatico, ma le manda
> sempre l'utente. Ha il CV, ha il link per la candidatura, e dovrà fare
> lui la parte della candidatura. Così non vengono mandate troppe
> candidature massivamente, ma solo quelle selezionate che sono su
> misura per l'utente che sceglierà lui quale mandare."*

### 🎯 Filosofia di prodotto

JHT è un **CV-tailoring assistant**, NON un **auto-applier massivo**.
Differenza intenzionale rispetto a tool come Sonara/LazyApply che
spammano centinaia di candidature/giorno con CV generici:

| JHT (design intenzionale) | Auto-applier massivi (anti-pattern) |
|---|---|
| 12 CV su misura, utente sceglie chi mandare | 200 CV generici al giorno |
| Risposte HR di qualità (CV calibrato) | Risposte = ghost o spam filter |
| Reputazione candidato intatta | Reputazione spam su LinkedIn/ATS |
| Utente controlla il funnel | Utente perde controllo del proprio brand |

### 📋 Comportamento corretto del team

Il team **deve** fermarsi a `applications.status='ready'`. Da lì
l'utente:
1. Apre `/ready` sulla dashboard web
2. Scarica CV + cover letter (PDF già pronti su Drive o locale)
3. Clicca link offerta → fa apply manuale sul portal/form/email
4. Marca manualmente come "inviata" sul JHT (futura UI / o auto-detect
   via Gmail tracking)

### ⚠️ Implicazioni per altri bug

Bug che erano stati documentati come "bloccati da #9" vanno ripensati:

- **#20** (`/reports` mock): NON serve attendere submit-application. Il
  report deve mostrare il funnel reale: CV generati / scaricati /
  cliccato link offerta / utente ha marcato "inviata". Necessità di
  tracking lato utente (mark-as-sent button + Gmail integration
  futura).
- **#21** (draft→ready promotion): resta **valido e prioritario** —
  serve comunque per mostrare correttamente CV PRONTI all'utente, anche
  in modalità user-curated apply.
- **#10** (Mentor → Capitano channel): resta valido — utile per
  insight strategici inter-agente anche senza auto-apply.

### 🔧 Eventuali skill **lato dashboard** (non bug, future feature)

Se in futuro si volesse aiutare l'utente nel manual apply senza
automatizzarlo, possibili UI affordances:

- **Bottone "Apri link offerta"** già visibile su `/ready`
- **Bottone "Download CV + CL"** in 1 click
- **Bottone "Marca come inviata"** che cambia status a `sent` (manuale)
- **Pre-fill template email** (mailto: con subject/body precompilato
  dal Critic)

Tutto **lato UI**, niente sul backend agente.

### 🗑️ Cancellazione bug

Il bug #9 originale richiedeva: nuova skill backend, credenziali SMTP,
Playwright ATS, LinkedIn cookies, schema `applications.status` esteso,
safety gate Telegram, modalità autopilot. **Tutto da cancellare** —
nessuna di queste implementazioni va fatta.

**Lezione**: il "fix" più potente per un bug è scoprire che non è un
bug. Riduce backlog di ~2 settimane di lavoro inutile.

---

## 🐛 10. Mentor identifica problemi ma non ha canale verso Capitano

**Sintomi**: Mentor scrive 3 volte (msg #2, #5, #6) *"parlane con il
Capitano"* riferendosi alla pipeline. Ma il Mentor stesso non ha modo di
inviare un `[REQ]` o `[INFO]` al pane CAPITANO — può solo parlare con
l'utente via Telegram.

**Causa**: nel prompt del Mentor (`agents/mentor/mentor.md`) la skill
`tmux-send` non è inclusa. Confronto skill list:

| Agente | tmux-send? |
|---|---|
| capitano | ✅ |
| analista, scorer, critico, scrittore | ✅ (intra-pipeline) |
| mentor | ❌ (solo `telegram-send` + `chat-web`) |
| sentinella | ✅ (manda ordini al capitano) |

Mentor è isolato per design — è un **osservatore strategico**, non un
operatore — ma la conseguenza è che insight come *"i draft non partono"*
muoiono se l'utente non agisce da middleware.

**Trade-off di design**:
- **Pro separazione attuale**: Mentor non interferisce con loop operativo,
  utente resta in controllo, evita "echo chamber" tra agenti.
- **Contro**: insight cronicamente persi (utente non sempre online,
  Telegram facile da scrollare via).

**Fix proposto** (ipotesi alternative):
- **(a)** Aggiungere skill `tmux-send` al Mentor MA limitata a un solo
  destinatario: `CAPITANO`, e solo tipo `[INFO]` (mai `[REQ]` o `[URG]`).
  Capitano può ignorare se in conflitto con direttive utente.
- **(b)** ~~Non toccare il Mentor, ma risolvere il bug #9~~ —
  **smentito**: per design l'apply è user-curated, non automatizzato
  (vedi #9 declassato). L'insight Mentor resta utile, deve arrivare
  all'utente via Telegram (già funziona).
- **(c)** Lasciare così, documentare il pattern: *"Mentor produce solo
  testo, l'utente è il transport layer"*.

**Priorità**: bassa-media. Resta valido come canale di insight Mentor
verso Capitano per micro-azioni operative (es: "promuovi 5 posizioni
40-49 in parking"). Non è urgente.

---

## ✨ 11. Insight positivo — Mentor è il miglior agente conversazionale

**Osservazione neutra dalla sessione**: zero spam, 6 risposte ognuna densa
di valore numerico, sempre nome utente "Leone", silenzio M-01 dopo emoji
di ack, accetta reframe utente (msg #6 "dimmi cosa migliorare non cosa non
va bene") senza moralismi mantenendo il proprio stile *"misurato, numeri
prima delle opinioni"*.

Pattern emergente: il Mentor ha lo **stile conversazionale più
allineato alla regola M-01/M-02** del team. Vale la pena studiarne il
prompt come reference per migliorare Capitano (msg #17/#18 con
Giovanni Odazzi mostrano che il Capitano è meno disciplinato sullo
stay-on-topic, vedi bug #6).

**Non un bug**, è un piccolo paragone di reference per future iterazioni
del prompt Capitano.

---

## 🐛 12. Hit-rate Scout — comportamento da inserire nelle istruzioni base agenti (REVISIONE 14:30 UTC)

### 📊 Nuova misura empirica (snapshot DB 14:30 UTC, +13h dal Mentor)

| Metrica | Mentor 00:12 UTC | Adesso 14:30 UTC | Delta |
|---|---|---|---|
| `positions` totali | 27 | **90** | +233% |
| `applications` create | 9 | **31** | +244% |
| Critic PASS | 2 | **13** | **+550% ⬆️** |
| Aziende PASS distinte | 2 (Bending, Rinse) | **11** | +450% |
| `hit_rate(PASS/positions)` | 7% | **14%** | **×2 ⬆️** |
| `hit_rate(PASS/applications)` | 22% | **42%** | **×2 ⬆️** |

**Aziende PASS attuali** (DB live, ordine score Critic):
1. Sisal — Trainee Data Analytics ⭐ 7.5/10 (NUOVO)
2. Prima — Junior Software Engineer ⭐ 7.5/10 (NUOVO)
3. Bending Spoons — Graduate SWE 6.5
4. LC-Service — Sviluppatore Python-SQL 6.5 (NUOVO)
5. Gr4vy — Python Backend Junior 6.5
6. Rinse — Software Engineer 6.0
7. Company 033 × 3 (Data Engineer, Observability, Commercial) 5.5 (NUOVO)
8. MLabs, Gr4vy #2, Leadtech, HAOBORN, Initialize — tutti 5.5/5.0 (NUOVI)

### 🤔 Conclusione: il sistema STA migliorando da solo

L'ipotesi originale del bug *"hit-rate non migliora, manca loop
Critic→Scout"* è **smentita dai numeri**. In 13h il sistema ha:
- raddoppiato hit-rate posizione (7% → 14%)
- raddoppiato hit-rate application (22% → 42%)
- decuplicato aziende PASS distinte (2 → 11)
- aggiunto sorgenti nuove (Scout-2 autorizzato LinkedIn alle 13:23
  post-RESET, ha sweep 3 fonti)

Senza alcun loop esplicito di feedback Critic→Scout. Probabili cause:
1. **Pool size effect**: + posizioni = + chance statistica di PASS
2. **Auto-correzione utente**: utente ha spinto Capitano *"devi
   riempire la coda"* (10:28) → Capitano ha autorizzato fonti nuove
3. **Regression to mean**: le aziende che producono PASS sono quelle
   "standard" (Python junior senza laurea/stack esotico) — emergono
   naturalmente all'aumentare del pool

### 📋 Pattern rejection attuale (16 REJECT analizzati dal DB)

| Categoria esclusione | Conteggio | % |
|---|---|---|
| `[STACK]` mismatch (Go, K8s, Company 106, Docker, AWS, Rust, FastAPI) | 9 | 56% |
| `[LAUREA]` (Master STEM, degree obbligatorio) | 2 | 13% |
| `[SENIORITY]` (Graduate programs, anni esp.) | 2 | 13% |
| `[LINK]` morto | 1 | 6% |
| TEST insert (debug Scout-2) | 1 | 6% |
| Generico (`ESPERIENZA_RICHIESTA: non specificato`) | 1 | 6% |

**Insight**: STACK domina al 56%. L'Analista upstream **sta già usando**
questo segnale per filtrare, perché le esclusioni sono coerenti con i
verdetti Critic. C'è già un loop implicito, anche se non strutturato.

### ✏️ Riformulazione del bug — istruzioni base, non skill ad-hoc

**Decisione utente** (verbatim, questa sessione):
> *"comunque l'abbiamo comunicato a noi, quindi dovrebbe essere nelle
> loro istruzioni di base questo comportamento, senza che noi lo
> diciamo"*

Il bug si trasforma da **"manca skill scout-strategy ε-greedy"** a
**"il comportamento exploration↔exploitation deve essere nelle
istruzioni di base degli agenti, non una skill esterna"**.

### 🔧 Fix proposto (rivisto)

#### A. Aggiungere a `agents/scout/scout.md` (regola base Scout)

```
## Exploration vs Exploitation (regola SC-05)

Per ogni sweep:
- 70-80% tempo: cerca pattern PASS noti (query la tabella `applications
  WHERE critic_verdict='PASS'` per stack/seniority/remote tipici e
  riproduci forma)
- 20-30% tempo: cerca in sorgenti/aziende non ancora viste o con
  campione < 5 posizioni nel DB
- Mai sotto 15% explore (evita collasso su 1 cluster)

Il bilanciamento NON va chiesto al Capitano: esegui questa regola
in autonomia ad ogni sweep.
```

#### B. Aggiungere a `agents/_team/team-rules.md` (regola team-wide)

```
## T14 — Auto-tuning su feedback Critic

Gli agenti che leggono dal DB (Scout, Analista, Scorer) devono SEMPRE
considerare le ultime 30 entry `applications.critic_verdict` e adattare
il proprio output:
- Se "STACK mismatch" è > 50% delle FAIL → stringere stack target
- Se "LAUREA obbligatoria" è > 30% delle FAIL → escludere graduate
  programs/AI shops che richiedono laurea
- Se "SENIORITY" è > 30% → restringere a "junior" / "graduate"

Aggiorna il filtro ad ogni sweep, non solo quando un umano te lo dice.
```

#### C. Naming canonico delle `rejection_reason` (raccomandato)

Standardizzare `critic_notes` con tag riconoscibili a inizio stringa:
- `[STACK]`, `[LAUREA]`, `[SENIORITY]`, `[LINK]`, `[GEO]`, `[OTHER]`
- Già parzialmente in uso (vedi DB: il Critic usa `[STACK]`, `[LAUREA]`,
  ecc.) — formalizzare in `critic-loop/SKILL.md` come obbligatorio.

Questo permette query semplice `WHERE critic_notes LIKE '[STACK]%'`
senza NLP, e abilita il pattern detection nelle regole SC-05 e T14.

### 🎯 Priorità rivista: **media** (non più alta)

Il sistema già migliora — i numeri lo dimostrano. Aggiungere SC-05 +
T14 ai prompt base accelera l'apprendimento e lo rende auto-correttivo
**senza intervento utente**. Ma non è un bug bloccante: è un
ottimizzazione.

### ⏱️ Effort: **piccolo** (rivisto da medio)

Non serve skill nuova né migrazione DB. Solo:
- ~30 righe di regola in `scout/scout.md` (SC-05)
- ~30 righe in `_team/team-rules.md` (T14)
- ~10 righe di guideline in `critic-loop/SKILL.md` (tag canonici)
- Snapshot test dopo 1-2 finestre Kimi per validare miglioramento.

### 📈 Validazione post-fix

Re-eseguire la query DB di questa sessione tra 7 giorni:
```sql
SELECT COUNT(*) FROM applications WHERE critic_verdict='PASS';
SELECT COUNT(DISTINCT p.company) FROM applications a
  JOIN positions p ON p.id=a.position_id
  WHERE a.critic_verdict='PASS';
```
Atteso: trend di crescita continua (es. 13 → 25 in 7gg, da 11 a 20
aziende distinte). Senza fix, il trend dovrebbe stabilizzarsi
naturalmente per saturazione.

---

## 🐛 13. Capitano invia template shell non espanso a Telegram

**Sintomo** (00:41:51 UTC, msg Capitano #27 estratto dal wire):

L'utente alle 00:40 chiede *"leggiti tutta la mia conversazione con il
mentore — ci sono dei miglioramenti che ha proposto per la pipeline — li
stai applicando?"*. Il Capitano risponde 1 minuto dopo con questo body
letterale:

```
$(cat /tmp/telegram_msg.txt)
```

Cioè invia all'utente il **template shell non espanso** invece del
contenuto del file. Bug di quoting: probabilmente ha eseguito qualcosa
come `jht-telegram-send --from capitano "$(cat /tmp/telegram_msg.txt)"`
ma le quote esterne erano single-quote, oppure il file conteneva newline
non gestite dal sub-shell escape di Kimi.

**Recupero**: 30s dopo (msg #28, 00:42:25) il Capitano si è accorto del
problema e ha rimandato il messaggio corretto (589 chars, vedi sotto).
L'utente comunque ha visto entrambi.

**Causa probabile**: pattern Kimi che genera comando `Shell(...)` con
quoting misto (single vs double, nested `$()`) — il wrapper bash di
`jht-telegram-send` non eval-a la sub-shell se la stringa arriva già
processata.

**Fix proposto**:
- In `jht-telegram-send`, aggiungere un check: se il body inizia con `$(`
  o contiene `\${`, rifiutare con errore *"refusing to send unexpanded
  shell template, looks like a quoting bug"*.
- In `agents/_skills/telegram-send/SKILL.md` documentare il pattern
  sicuro: scrivere body in heredoc e leggerlo come argomento posizionale,
  evitare `cat` in command substitution.

**Priorità**: bassa-media. Bug raro ma confonde l'utente.

**Effort**: piccolo (5-10 righe in `jht-telegram-send`).

---

## 📝 Risposta del Capitano alla domanda "stai applicando i suggerimenti del Mentor?" (00:42:25 UTC)

Dopo il template bug #13 sopra, il Capitano ha rimandato la risposta vera.
**Verbatim**:

> *Correzione su filtri Scout: SC-04 regola inviolabile — Scout ha SOLO 4
> skip (seniority, work-auth, dominio, exp+3). Non posso aggiungere
> filtri upstream senza rompere architettura. Le esclusioni vanno a valle
> (Analista/Scorer) e stanno gia funzionando: 13/27 escluse.*
>
> *Cosa posso fare davvero:*
> 1. *Aggiornare profilo con vincoli piu chiari — influenza Scorer gap penalty*
> 2. *Accelerare coda scored → CV — in corso*
> 3. *Sbloccare apply sui 2 draft ready — dipende da te*
>
> *Il Mentor ha ragione sul profilo (metriche + AWS) e sullo sblocco
> operativo. Su filtri Scout il sistema gia filtra a valle.*

**Validazioni empiriche di questo file**:

1. **~~Conferma del bug #9~~** (smentito post-revisione utente):
   citazione letterale del Capitano: *"Sbloccare apply sui 2 draft ready
   — dipende da te"*. **In realtà comportamento corretto by design**:
   l'apply manuale dall'utente è intenzionale. Vedi #9 declassato a falso bug.

2. **Conferma del bug #12** (loop Critic→Scout assente) — il Capitano
   dice *"SC-04 regola inviolabile — Scout ha SOLO 4 skip"*. Cioè
   l'architettura attuale **vieta esplicitamente** allo Scout di
   imparare/restringere le query in base ai feedback del Critic. Le
   esclusioni "vanno a valle" — esattamente il problema documentato in
   #12: filtrare a valle costa token (Analista + Scorer girano su materiale
   che verrà scartato comunque).

3. **Conferma dell'approccio Mentor (#11 insight positivo)** — il
   Capitano riconosce esplicitamente *"Il Mentor ha ragione sul profilo
   (metriche + AWS) e sullo sblocco operativo"*. La qualità dei consigli
   Mentor è validata anche dall'agente downstream.

**Implicazioni per #12 (Scout learning loop)**:

La regola **SC-04** va riesaminata. Se vogliamo che lo Scout impari, dobbiamo:
- **Opzione A**: emendare SC-04 per permettere skip aggiuntivi *dinamici*
  basati su critic-feedback persistito (es: nuovo skip "degree_required"
  attivato quando >50% bocciature contengono "degree" in `critic_notes`).
  Mantenere i 4 skip statici come fondamenta, aggiungere 2-4 skip dinamici
  con flag `learned=true` e dashboard utente per controllarli.
- **Opzione B**: lasciare Scout intoccabile, mettere il feedback loop
  nell'**Analista** (gate downstream). L'Analista già esclude — può
  imparare quali pattern escludere prima a partire dal critic_notes.

Entrambe rispettano lo spirito SC-04 (Scout = recall alto, filtro = a
valle) ma aggiungono auto-tuning del filtro a valle, mai esistito prima.

---

## 📊 Update operativi finestra 22:11 → 03:11 (Capitano msg #29-#30)

Subito dopo la risposta strategica sopra, il Capitano ha continuato il
loop operativo. Due update consecutivi dimostrano che il **termostato
Capitano + pipeline funzionano bene in questa finestra**:

### Msg #29 — Tick bridge 00:45 UTC (00:45:26)
> *"Tick 00:45: proj 91% (sotto target 92). Vel team leggermente sopra
> target (+0.31%/h). Rallento scrittore-1 di 10s per centrare meglio.
> Nessun freeze."*

**Lettura**: il Capitano ha imparato la lezione del freeze 22:45 e ora
modula con micro-aggiustamenti (10s di throttle in più sullo Scrittore-1)
invece di freeze totali. **Proj 91% < target 92% = perfettamente in
banda 85-95%**. Verbatim aderenza alla regola Performance band (bug #4
sta scalando da media a "comportamento osservato"). ✅

### Msg #30 — Critic PASS su Gr4vy (00:46:57)
> *"Scrittore-1: #26 Gr4vy — Critic 5.5/10 PASS. PDF pronto. Prossima
> in coda: #22 Company 033 (score 50)."*

**Lettura**: **terza candidatura PASS della sessione**. La lista dei
PASS noti si aggiorna:

| # | Azienda | Score | Status |
|---|---|---|---|
| 1 | Bending Spoons | 70/100 | Ready (utente non ha ancora applicato) |
| 2 | Rinse | 62/100 | Ready (utente non ha ancora applicato) |
| 3 | **Gr4vy** | 62/100 + Critic 5.5/10 | **Ready** appena prodotto, in attesa di apply utente |

Il pattern dei PASS è coerente con l'analisi Mentor (msg #3): tutti e 3
sono **junior/graduate Python full remote senza laurea obbligatoria**.
Bending Spoons, Rinse, Gr4vy — stack puro Python backend, no React/Ruby/
AWS forzati. Il Critic premia in modo consistente.

**Aggiornamento post-revisione utente**: ~~Implicazione per bug #9~~ —
non è un problema. L'apply è intenzionalmente user-curated (vedi #9
declassato). Il vero gap qui è #21 (status non promosso da `draft` a
`ready`) + #20 (`/reports` mock) per mostrare correttamente i CV
all'utente sulla dashboard.

**Implicazione per bug #12**: il pattern PASS è così stabile (3/3 = stessa
forma) che il loop Critic→Scout sarebbe banale da iniziare. Anche solo
una soglia *"se 3+ PASS condividono `tech_stack=python_pure AND
seniority=junior_or_graduate AND remote=true AND degree_required=false`,
aggiungi al briefing Scout next-cycle"* basterebbe a salire dal 18% di
hit-rate attuale.

### Stato finestra corrente alle 00:47

- Budget: proj 91% al tick 00:45 — **on track** per chiudere ~95%
  (target G-spot vedi `docs/sessions/2026-05-17-budget-windows/`).
- Pipeline: 3 ready, prossimo in coda #22 Company 033 (score 50, ma Mentor
  aveva flaggato Company 033 come probabile FAIL per laurea — vedi msg #4).
- Operatività Capitano: micro-aggiustamenti corretti, **0 freeze post
  22:45**. Lezione SC-04/C-01 metabolizzata almeno per questa finestra.

---

## 🐛 14. Stati pipeline transitori non loggati → snapshot invisibili

**Sintomo** (sessione candle chart, 01:08-01:15 UTC):

L'utente chiede al Capitano *"3 grafici candle, inizio/mezzo/fine della
finestra, con candela per ogni stato"*. Il Capitano produce
`pipeline_candle_*.png` ma in tutti e 9 i grafici (3 finestre × 3 iter)
le candele **"verificate"** e **"nuove"** sono sempre **0**.

Domanda utente (01:15:30):
> *"ora non ci sta mai candela verificate - come mai?"*

Risposta Capitano (01:15:46, msg #31 verbatim):
> *"Perche nel DB lo stato e' transitorio. L'Analista verifica JD e
> azienda, poi lo Scorer immediatamente promuove a `scored` o `excluded`.
> La posizione non resta mai in stato 'checked' — passa istantaneamente
> da `new` a `scored/excluded`. Quindi `checked=0` in ogni snapshot."*

**Causa**: il DB SQLite ha **una sola colonna `status` per posizione**,
sovrascritta ad ogni transizione. Nessun log delle transizioni storiche.
Conseguenze:

1. **Snapshot stati transitori = 0**. `checked`, `writing`, e qualsiasi
   altro stato che dura < interval tick Sentinel (~5 min) non viene mai
   "visto" da un `SELECT COUNT(*) WHERE status='checked'`.
2. **Tempo medio per stato non calcolabile**. Quanto ci mette in media
   una posizione da `new` a `scored`? Impossibile rispondere senza log.
3. **Bottleneck detection cieco**. La `pipeline-triage` skill ragiona
   su numeri di stato corrente, non sui throughput. Se l'Analista fosse
   lento per 30 min e poi velocissimo, lo snapshot non lo coglie.
4. **Bug #12 (Scout learning loop) più difficile da chiudere**: per
   capire dove si perdono posizioni serve guardare `transitions.from
   → to`, non solo lo stato finale.

**Conclusione utente** (verbatim, questa sessione):
> *"ci sono dei nuovi messaggi - i quali portano alla conclusione che
> dovremmo loggare anche il cambio di stato"*

**Fix proposto** — event log delle transizioni:

```sql
CREATE TABLE position_state_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id INTEGER NOT NULL REFERENCES positions(id),
  from_state TEXT,         -- NULL per la transizione iniziale (insert)
  to_state TEXT NOT NULL,
  ts TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  by_agent TEXT NOT NULL,  -- 'scout-1', 'analista-1', 'scorer-1', ecc.
  notes TEXT               -- ragione transizione (es. 'GEO mismatch')
);
CREATE INDEX idx_pst_position_ts ON position_state_transitions(position_id, ts);
CREATE INDEX idx_pst_ts          ON position_state_transitions(ts);
```

Tutte le UPDATE su `positions.status` devono passare per uno **stored
procedure / wrapper Python `db_update.transition_state(...)`** che:
1. Aggiorna `positions.status = to_state`
2. INSERT in `position_state_transitions(position_id, from_state,
   to_state, ts=now, by_agent)`

**Visualizzazioni che diventano possibili dopo il fix**:

- **Stock retroattivo per intervallo**: per ogni minuto T, conta le
  posizioni che alle T erano in stato S =
  `SELECT COUNT(DISTINCT position_id) FROM transitions WHERE ts <= T
   AND NOT EXISTS (SELECT 1 FROM transitions t2 WHERE t2.position_id
   = transitions.position_id AND t2.ts > transitions.ts AND t2.ts <= T)
   AND to_state = S`. Stock corretto anche per stati transitori.
- **Throughput per stato**: posizioni/h che entrano in S nell'ultima h.
- **Tempo medio di permanenza per stato**: media di
  `(next_transition.ts - current_transition.ts)` per ogni `to_state=S`.
- **Drop-off funnel**: percentuale di posizioni che scendono di stato
  in stato (trovate → valutate → scrittura → pronte → inviate).

**Priorità**: **alta**. Sblocca tutte le visualizzazioni che il Capitano
sta già provando a generare, e fornisce il dato base per i feedback loop
del bug #12 (Scout learning) e per le metriche di prodotto generali.

**Effort**: medio. Migrazione SQLite + wrapper Python + retrofit di
tutte le UPDATE esistenti. ~2-3 file da toccare:
- `shared/data/migrations/00X_state_transitions.sql` (nuovo)
- `shared/skills/db-update/*.py` (wrapper transition_state)
- `agents/_skills/db-update/SKILL.md` (aggiorna doc, regola: mai UPDATE
  diretto su `positions.status`, sempre `transition_state(...)`)

**Riferimento**: vedi `docs/sessions/2026-05-17-pipeline-snapshot/` per
i 6 PNG che hanno reso visibile il problema (5 + 1 host).

---

## 🐛 15. Timezone confusion — agenti comunicano in UTC, utente legge in CEST

**Sintomo** (sessione 01:19 → 01:22 UTC):

L'utente alle 01:19:09 UTC chiede: *"ok rifammi grafico usage temporale"*.
Il Capitano genera `budget_chart_late.png` con tutti i timestamp in UTC.
Subtitle: *"Now 01:14 — usage 63 % — proj 92.2 %"*. Reset annotato a
"03:11" (sottinteso UTC).

Alle 01:21:17 UTC l'utente, confuso, scrive: *"solo le 3.21 qui..."*.
Capitano (01:21:38): *"Non ho capito — ti riferisci al grafico budget?"*.

Alle 01:22:10 UTC l'utente chiarisce: *"l'ora qui è 3.21 e te dici che
reset è alle 3.11 . ."* — vede l'inconsistenza temporale dal suo punto
di vista CEST (UTC+2).

Risposta Capitano (01:22:36, dopo aver fatto i calcoli):
> *"Reset e' alle 03:11 UTC. Ora server: 01:22 UTC. Se li' sono le 3:21,
> siamo UTC+2 (CEST). Reset fra ~1h50m (alle 5:11 tue)."*

**Causa**:
- Container Docker gira in **UTC** (default Linux).
- Tutti gli script Python (`sentinel-bridge.py`, `matplotlib`, log
  Capitano) usano `datetime.utcnow()` o `time.time()` → output in UTC.
- L'utente è in **Italia (CEST = UTC+2)** in maggio (CEST attivo dal
  ultimo domenica di marzo al ultimo domenica di ottobre).
- Nessuna conversione automatica nei messaggi user-facing né nei
  grafici. L'utente deve mentalmente sommare +2 ogni volta.

**Impatti**:
1. **Grafici budget/pipeline** mostrano tutti orari UTC senza suffix
   esplicito — utente non sa se "03:11" è ora locale o UTC.
2. **Messaggi Telegram** del Capitano (*"reset alle 03:11"*, *"tick
   00:45"*, *"chiusura sessione alle 22:11"*) sono tutti UTC impliciti.
3. **Notifiche Sentinella** stesso problema.
4. **Ogni richiesta utente** che usa l'ora locale (*"alle 3:21 qui"*)
   richiede uno step di conversione manuale dal Capitano (potenziale
   fonte di errori).

**Fix proposto** — 2 opzioni complementari:

**Opzione A** (UX migliore, più invasiva): legge il timezone utente da
`candidate_profile.yml`:
```yaml
timezone: Europe/Rome  # default per nuovi profili in IT
```
Helper Python condiviso `agents/_skills/format-time/`:
```python
def fmt_user(dt_utc: datetime) -> str:
    """Restituisce orario in fuso utente con suffix."""
    import zoneinfo
    tz = zoneinfo.ZoneInfo(profile.timezone or "UTC")
    local = dt_utc.replace(tzinfo=zoneinfo.ZoneInfo("UTC")).astimezone(tz)
    suffix = local.tzname()  # "CEST" / "CET" / "UTC"
    return local.strftime(f"%H:%M {suffix}")
```
Tutti gli script che producono output user-facing (telegram, matplotlib
xtick) usano `fmt_user(...)` invece di `dt.strftime("%H:%M")`.

**Opzione B** (veloce, meno invasiva): suffix UTC esplicito ovunque +
mostra anche orario locale come riferimento secondario:
- Telegram Capitano: *"Tick 00:45 UTC (02:45 CEST tuo)"*
- Matplotlib subtitle: *"Now 01:14 UTC (03:14 CEST)"* e asse X con `UTC`
  in `xlabel`.

**Raccomandazione**: combinare A+B — convertire al fuso utente come
default per la UX (Opzione A) ma mostrare anche UTC nei contesti tecnici
(grafici operativi, log) per evitare ambiguità (Opzione B).

**Priorità**: media. Bug ricorrente e fonte di confusione UX, ma non
blocca operatività. Risolverlo migliora drasticamente la leggibilità di
tutti i messaggi agenti.

**Effort**: piccolo (1 helper Python + retrofit ~10 callsite negli
script chart/telegram).

**Riferimento**: `docs/sessions/2026-05-17-budget-windows/budget_chart_late.png`
mostra l'esempio del bug nel subtitle e nei tick X.

---

## ✨ 16. Auto-report periodici + auto-grafici via Bridge orders (feature mancante)

**Osservazione utente** (verbatim, questa sessione):
> *"dovremmo mettere dei bridge che ordina a capitano di produrre dei
> grafici e cartine del genere ogni tanto senza che utente chieda. Anche
> report ogni tanto della situazione ad utente tramite telegram — lui mi
> aggiorna spesso attualmente visto che l'ho detto di fare ma se no non
> avrebbe fatto — dovrebbe avercelo come una delle istruzioni principali"*

**Contesto**: nella sessione 17 maggio il Capitano ha prodotto:
- 4 grafici budget (`budget_chart*.png`, `usage_chart*.png`)
- 4 grafici pipeline temporali (`pipeline_chart.png`, `pipeline_stock_chart*.png`)
- 9 grafici candle snapshot (`pipeline_candle_*.png`)
- 2 mappe geografiche con tile OSM (`positions_map_europe.png`,
  `positions_map_italy.png`) → reazione utente *"fantastico"*

**Tutto generato solo perché l'utente l'ha chiesto esplicitamente**.
Senza richiesta, il Capitano resta in loop operativo (spawn agenti,
ack tick Sentinella, monitorare coda CV) e **non produce mai
visualizzazioni o report di stato proattivamente**.

**Causa**: in `agents/capitano/capitano.md` la sezione "loop operativo"
è reattiva. Le uniche cose che il Capitano fa autonomamente sono:
1. Rispondere a `[BRIDGE TICK]` ogni ~5 min con un ACK alla Sentinella
2. Rispondere a `[CHAT]` o `[TG]` quando arrivano
3. Triage pipeline (`pipeline-triage`) quando Sentinella ordina scaling

**Manca**: nessun loop di "report all'utente / produrre grafici" senza
trigger esterno.

**Fix proposto** — 2 componenti:

### A. Bridge orders periodici per auto-grafici

Aggiungere nuovi tipi di tick nel bridge `pid1.js` / `sentinel-bridge.py`:

| Order type | Frequenza | Azione Capitano |
|---|---|---|
| `[CHART-BUDGET-WINDOW]` | A metà finestra Kimi e a 30 min dal reset | Genera `budget_chart_<window_id>.png` e invia all'utente |
| `[CHART-PIPELINE-DAILY]` | 1x al giorno (es. 09:00 UTC) | Genera `pipeline_stock_chart.png` ultimi 24h |
| `[MAP-POSITIONS-WEEKLY]` | 1x a settimana (es. domenica 18:00 user-local) | Genera `positions_map_<region>.png` per regioni con posizioni nuove |
| `[CANDLES-3-WINDOW]` | A chiusura finestra Kimi | 3 candle snapshot (inizio/mezzo/fine) della finestra appena chiusa |

Implementazione: nuova skill `agents/_skills/bridge-orders/SKILL.md` che
documenta i tipi di order, il Capitano la consuma e per ogni order esegue
la generazione + invio via `jht-telegram-send --photo`. Idempotenza con
flag tipo `/jht_home/profile/last_chart_<type>.flag` per evitare doppie
generazioni.

### B. Report periodici proattivi via Telegram

Aggiungere come **regola principale** del Capitano (subito dopo C-01, C-02,
C-03) una nuova **C-04**:

> *"**C-04 — Report proattivo all'utente**. Almeno una volta ogni 2 ore
> attive (cioè quando il team non è in freeze), invia all'utente un
> riepilogo Telegram non richiesto: budget attuale + proj, top
> posizioni nuove dalla scorsa volta, draft pronti, eventuali blocker.
> Formato breve (3-5 righe), italiano, tono operativo. Idempotenza:
> non rispedire se l'ultimo report è < 1 ora fa. Skip in finestra di
> notte utente (00:00-08:00 local user time)."*

Lookup notturno: legge `timezone: Europe/Rome` da `candidate_profile.yml`
(dipende dal bug #15 timezone resolution).

Implementazione tecnica:
- Helper bash/python `agents/_skills/proactive-report/check.py` che il
  Capitano chiama ad ogni `[BRIDGE TICK]` per decidere se è "ora di un
  report".
- Persistenza last-report timestamp in
  `/jht_home/profile/last_proactive_report.ts`.

### Dipendenze

- **Bug #15** (timezone): per la regola "skip 00-08 utente" serve sapere
  il fuso utente.
- **Bug #14** (state-event log): i grafici stock/candle saranno
  *finalmente corretti* solo dopo aver loggato le transizioni.
- **Task #50** (slash command + bottoni): se utente può chiedere chart
  on-demand con un bottone, lo schedule periodico serve **meno** (ma
  resta utile per "primo trigger" di settimana).

**Priorità**: **alta** — l'utente l'ha esplicitamente chiesta come
"istruzione principale". Sblocca il valore d'uso del JHT come *"team
che lavora per te e ti tiene aggiornato"* invece di *"tool che devi
chiedere ogni volta"*.

**Effort**: medio. Componenti:
- ~50 righe in `pid1.js` o `sentinel-bridge.py` per nuovi tick types
- Nuova skill `bridge-orders` (~100 righe + esempi matplotlib/OSM)
- Nuova regola C-04 in `capitano.md` (~20 righe)
- Helper `proactive-report/check.py` (~80 righe)
- Documentazione: aggiornare `agents/_manual/` + reference per chart types

**Riferimento**: vedi `docs/sessions/2026-05-17-pipeline-snapshot/` per i 9
PNG già generati on-demand dal Capitano nella sessione — sono il
template visivo per i grafici auto-generati.

---

## 🐛 17. Capitano passivo davanti a code vuote — non applica la sua stessa skill `pipeline-triage`

**Sintomo** (sessione 01:45-01:49 UTC):

Tick bridge 01:45 — Capitano riconosce esplicitamente il problema:
> *"Tick 01:45: proj 92.7% (vicino target 92). **Vel team crollata a
> 5.5%/h, troppo lenta. Ridotto throttle scrittore-1 20s→10s. Coda
> vuota, nessun lavoro da fare. Aspetto prossimo tick per valutare se
> spawnare.**"*

L'utente alle 01:49:02 incalza: *"Dove è vuota la coda?"*. Capitano
risponde 01:49:16 con diagnosi puntuale:

> *"Code vuote:*
> - *Scout: fonti esaurite, nessuna posizione nuova*
> - *Analista: 0 posizioni new da verificare*
> - *Scorer: 0 posizioni checked da valutare*
> - *Scrittore: 0 posizioni scored>=50 da scrivere*
>
> *Coda piena:*
> - *Apply pronti: 4 (Bending Spoons 70, Rinse 62, Gr4vy 62, Company 033 50)*
> - **Scored 40-49 in parking: 6 posizioni (triage Capitano)**
>
> *Il bottleneck e' upstream: nessuna nuova posizione da processare."*

L'utente alle 01:49:37 esplicitamente: *"Devi agire di conseguenza per
non lasciare la coda vuota"*.

**Causa**: la skill `agents/_skills/pipeline-triage/SKILL.md` contiene
**già la regola esatta** che il Capitano dovrebbe applicare:

```
| PROMOTABLE_40_49 ≥ 5    | promote the best 5 by raising the score
|                         | (db_query.py + direct UPDATE), then treat
|                         | as SCRITTORE_QUEUE.                       |
| SCRITTORE_QUEUE < 5 AND | Only now spawn 1 SCOUT-N for new positions.
| PROMOTABLE_40_49 < 5    |                                            |
```

Stato attuale (auto-diagnosticato dal Capitano):
- `SCRITTORE_QUEUE = 0` (< 5 ✅)
- `PROMOTABLE_40_49 = 6` (≥ 5 ✅)
- → la regola dice **promote the best 5**

Eppure il Capitano:
1. **Vede** la situazione e la descrive perfettamente
2. **Identifica** che ci sono 6 posizioni in parking 40-49
3. **NON ESEGUE** la promotion + spawn Scout

Il problema è **inazione/passività**: il Capitano è in modalità
"aspetta tick + report all'utente" invece di "applica triage attivo".
Conferma il pattern del bug #16 (manca proattività) ma con un twist
diverso: qui il Capitano **ha** la regola scritta, semplicemente non
la esegue al momento giusto.

**Sub-ipotesi sulla causa profonda**:

- **(a)** Skill `pipeline-triage` letta solo quando arriva `[SCALA UP]`
  o `[BRIDGE TICK]` con segnale esplicito, non quando il Capitano stesso
  osserva `vel crollata` o `coda vuota`.
- **(b)** Capitano teme di toccare il DB autonomamente (`db_query.py +
  direct UPDATE`) perché nessuna regola gli dice *"se vedi
  PROMOTABLE_40_49 ≥ 5, esegui sempre la promotion"*. La skill descrive
  COSA fare ma non l'OBBLIGO di farlo.
- **(c)** Le regole C-01/C-02/C-03 enfatizzano *"aspetta ordine
  Sentinella"* — il Capitano evita azioni spontanee per non violarle,
  anche quando l'azione è chiaramente nel suo perimetro.

**Fix proposto** — 3 cambiamenti coordinati:

1. **Aggiungere C-04 OPERATIVA** in `capitano.md` (distinta da C-04
   "report proattivo" del bug #16):

   > *"**C-05 — Auto-triage su code vuote**. Quando velocità team < 50%
   > del target O coda Scrittore < 5 O backlog Scout (fonti) esaurito,
   > applica IMMEDIATAMENTE la skill `pipeline-triage` senza aspettare
   > un nuovo `[BRIDGE TICK]`. Le azioni di promotion 40-49 e spawn
   > Scout non richiedono autorizzazione Sentinella se il budget proj
   > è in target (85-95%)."*

2. **Aggiornare `pipeline-triage` SKILL.md**: cambiare la prima riga
   *"Open this skill EVERY TIME a scaling decision is needed"* in
   *"Open this skill EVERY TIME you observe: vel < 50% target, OR
   any role queue = 0, OR Scout sources exhausted, OR [SCALA UP] from
   Sentinella. Do NOT wait for an explicit trigger if conditions are
   met."*. Aggiungere esempi di "code vuote → cosa fare" come decision
   tree.

3. **Loop di check ogni `[BRIDGE TICK]`**: il Capitano deve, ad ogni
   tick, controllare automaticamente le 4 metriche di backlog (UNSCORED,
   DRAFT_BLOCKED, SCRITTORE_QUEUE, PROMOTABLE_40_49) e applicare la
   triage table. Oggi probabilmente lo fa solo se `[BRIDGE TICK]` ha
   il flag `SCALA UP`.

**Priorità**: **alta**. È un bug di "decisione → esecuzione" che si
ripete in ogni finestra: il Capitano riconosce il problema ma non
agisce. Senza fix, il pattern *"utente vede stallo, spinge il Capitano,
Capitano agisce"* sostituisce il pattern desiderato *"team si
auto-organizza"*. Stesso filone di #16 ma operativo, non di reporting.

**Effort**: piccolo-medio. Modifiche concentrate in `capitano.md`
(regola C-05) + `pipeline-triage/SKILL.md` (trigger esteso) + eventuale
helper `auto-triage-check.py` che esegue le 4 query in 1 colpo.

**Riferimento conversazionale**: 01:45:44, 01:49:16 UTC.

**Collegamento con altri bug**:
- **#3** (Capitano gerarchia C-01 Sentinella): stesso pattern di
  paralisi, ma diverso trigger. #3 = freeze ordinato → Capitano paralizza.
  #17 = code vuote → Capitano paralizza. Causa comune: Capitano sente
  che ogni azione non-richiesta è una violazione di regola.
- **#16** (auto-report proattivo): manca proattività di reporting.
  #17 = manca proattività di azione operativa.
- ~~**#9** (submit-application)~~ — smentito post-revisione. L'apply
  manuale è by design. Le 4 ready (Bending, Rinse, Gr4vy, Company 033)
  aspettano correttamente l'utente che scelga manualmente quale spedire.

---

## 🐛 18. Dottore mai spawnato — watchdog non lo include, bridge mancante

**Sintomo** (conversazione utente ↔ @Assistente 01:20-01:29 UTC, 4 messaggi):

| Ora | Utente | Assistente |
|---|---|---|
| 01:20:40 | *"il dottore sta operando ogni tanto?"* | (prima interpreta come battuta sarcastica, poi capisce) |
| 01:26:05 | *"sto parlando dell'agente dottore che è incaricato di monitorare il team"* | grep nel codebase → trova `/app/agents/dottore/` + skill `liveness-check` |
| 01:27:06 | *"riesci a controllare i log se è mai stato attivo o a..."* | controlla 4 fonti log → *"Il Dottore esiste come ruolo ma non è mai stato attivato"* |
| 01:29:20 | *"ci dovrebbe essere un bridge che lo attiva ogni tanto - controlla se riesci a vedere se è attivo il bridge"* | controlla pacing-bridge, sentinel-bridge, tg-bridge, watchdog → diagnosi finale ↓ |

**Diagnosi finale dell'Assistente** (verbatim dal pane scrollback, linee 956-974):

> *"1. I bridge (pacing, sentinel, tg) sono attivi e funzionanti
> 2. Non c'è nessun bridge specifico per il Dottore
> 3. Il file `dottore.md` dice chiaramente: 'Un altro Dottore verrà
>    spawnato fra ~30 min dal watchdog'
> 4. Il watchdog è `agent-watchdog.log` — ma guardando quel log,
>    **monitora solo assistente, capitano, mentor. NON il Dottore**.
>
> Quindi il Dottore esiste come ruolo ma il watchdog attuale non lo
> spawn. Forse in una versione precedente o successiva del sistema il
> watchdog dovrebbe spawnarlo, ma attualmente non lo fa."*

**Verifica indipendente** (questa sessione):

```
$ tmux list-sessions
ASSISTENTE   ✅
CAPITANO     ✅
CRITICO-S1   ✅
MENTOR       ✅
SCRITTORE-1  ✅
SENTINELLA   ✅
              ← NESSUN DOTTORE
```

Niente in `/jht_home/.kimi/sessions/` per dottore. Niente PID. Niente log.

**Causa**: `pid1.js` / `agent-watchdog` ha hardcoded la lista dei 3
agenti user-facing (assistente, capitano, mentor) da rilanciare in caso
di morte CLI. Il Dottore è un agente **one-shot a periodicità** (~30
min, durata ~30 min) — pattern diverso dai 3 long-lived — e non è
stato mai cablato nel watchdog né in alcun bridge alternativo.

**Impatti dell'assenza del Dottore**:

1. **Nessun liveness-check sistematico** dei pane tmux degli agenti.
   Quando una CLI Kimi/Sonnet va in "zombie" (token consumati senza
   prompt) nessuno se ne accorge finché un utente non scrolla
   manualmente il pane.
2. **Cache prune non eseguita**: `.kimi/cache/`, `/tmp/*.png`,
   `~/.local/share/uv/` crescono indefinitamente. Rischio disk full a
   medio termine.
3. **py-audit non eseguito**: vulnerabilità nelle dependenze Python
   non rilevate.
4. **Sentinella senza secondo controllo**: la Sentinella vede solo
   metriche di rate-budget, non lo stato di salute dei processi.
   Pane "vivo ma in loop assurdo" non viene rilevato.
5. **Bug #2 (Sentinella aggressiva) più difficile da chiudere**:
   se la Sentinella avesse il Dottore come secondo paio di occhi,
   potrebbe distinguere "processo zombie" (kill ok) da "processo
   normale" (throttle ok).

**Fix proposto** (3 opzioni, scegliere in base alla filosofia):

### (A) Estendere `agent-watchdog` per spawn periodico

In `pid1.js` o `agent-watchdog`:
```js
// per i 3 long-lived agents
const LONG_LIVED = ['assistente', 'capitano', 'mentor'];
LONG_LIVED.forEach(a => watchdogRestartIfDead(a));

// nuovo: per il Dottore (one-shot periodico)
setInterval(() => {
  if (!tmuxSessionExists('DOTTORE')) {
    spawnAgent('dottore', { mode: 'one-shot', autoExit: '30m' });
  }
}, 30 * 60 * 1000);  // ogni 30 min
```

### (B) Bridge order dedicato (collegato a #16)

Aggiungere ai bridge orders del bug #16 anche `[SPAWN-DOTTORE]` ogni
30 min. Il Capitano riceve l'order, esegue `spawn-agent dottore`, e il
Dottore fa il suo lavoro one-shot di 30 min e si chiude.

Vantaggio: il Capitano sa quando il Dottore è spawnato (può ricevere
report del Dottore via `[REPORT-FROM-DOTTORE]`). Centralizza la
governance.

### (C) Self-spawn via cron Docker

Aggiungere a `pid1.js` un mini-cron interno che alle :00 e :30 di ogni
ora spawna il Dottore se non già attivo. Più semplice di (A) ma meno
integrato con il workflow Capitano.

**Raccomandazione**: **(B)** — riusa l'infrastruttura del bug #16
(bridge orders periodici) ed esplicita la gerarchia "Capitano
orchestratore di tutti gli agenti, inclusi quelli one-shot". Più pulito
architetturalmente.

**Priorità**: **alta**. Bug critico di completezza: un intero agente
del team **non esiste in pratica**. Più tempo passa, più il rischio si
accumula (disk full, zombie non rilevati, ecc.).

**Effort**: piccolo-medio (5-30 righe in `pid1.js` + nuovo bridge order
se opzione B + verifica skill `liveness-check` ancora valida).

**Validazione**: dopo il fix, controllare che dopo 60 min compaia almeno
1 sessione `DOTTORE` in `tmux list-sessions` + entries in
`/jht_home/logs/agent-watchdog.log` con timestamp Dottore.

**Riferimento conversazionale**: pane scrollback ASSISTENTE linee
755-983, 2026-05-17 01:20-01:29 UTC.

**Bug collegati**:
- **#16**: usare i bridge orders per spawnare Dottore (opzione B).
- **#2**: Sentinella aggressiva — Dottore come secondo controllo
  permette throttle progressivo invece di kill.
- **#17**: Capitano passivo — anche qui, il Capitano riceve l'order
  dal bridge ma deve effettivamente eseguirlo (auto-azione, non
  segnalazione all'utente).

---

## 🐛 19. Capitano non sa reset finestra settimanale Kimi — dato non loggato + Capitano passivo sulla ricerca

**Sintomo** (sessione 13:45-13:50 UTC):

| Ora | Utente | Capitano |
|---|---|---|
| 13:45:57 | *"usage settimanale a che punto sta?"* | *"📊 Consumo settimanale kimi: 76%. Finestra corrente (13:11→18:11): 17% / 4.4h rimanenti."* ✅ |
| 13:46:51 | *"quanto manca al reset settimanale?"* | *"📅 Reset finestra giornaliera: 18:11 UTC (~4.4h). **Reset settimanale: non ho il dato preciso nel log. Weekly usage è a 76% e non ho rilevato un reset settimanale recente. Se lo conosci tu, dimmelo e lo traccio.**"* ❌ |
| 13:48:30 | *"indaga e trovalo - hai le skill per falro"* | (silenzio per ~2 min, poi grep nel codebase) |
| 13:50:12 | — | *"🚨 SCOPERTA — Reset settimanale kimi: **17:11 UTC** (tra ~3h 21m)! Cap principale (weekly): 76/100 — reset 17:11 UTC. Finestra 5h: 17/100 — reset 18:11 UTC."* ✅ |

Quindi: il dato esiste, le skill per recuperarlo esistono, ma il Capitano
di default risponde *"non ho il dato"* e si ferma. Solo dopo la spinta
dell'utente *"indaga e trovalo - hai le skill"* il Capitano cerca e
trova.

**Doppia faccia del bug**:

### A. Manca persistenza `weekly_reset_at` in `sentinel-data.jsonl`

Schema attuale di ogni tick:
```json
{
  "ts": "2026-05-16T18:02:26.837365+00:00",
  "usage": 27,                    // % finestra 5h ✅
  "reset_at": "22:11",            // HH:MM reset 5h ✅
  "weekly_usage": 8,              // % finestra settimanale ✅ ESISTE!
  // ❌ MANCA: "weekly_reset_at": "17:11"
  // ❌ MANCA: "weekly_reset_iso": "2026-05-17T17:11:00Z"
  "throttle": 0,
  "projection": 27.0,
  "status": "SOTTOUTILIZZO",
  ...
}
```

Il bridge ha già `weekly_usage` (ottimo) ma non logga il timestamp di
reset weekly. Senza quel dato, la Sentinella e il Capitano possono
sapere "quanto sta bruciando" ma non "quanto manca al reset".

### B. Capitano non interroga proattivamente le skill di lookup

Il Capitano ha accesso a 2 skill che potevano dare la risposta subito:
- `/app/shared/skills/check_usage.py` (linee 205-216): regex su UI Kimi
  che estrae il blocco weekly. Probabilmente fornisce `weekly_remaining_hours`.
- `/app/shared/skills/usage_record.py` (linee 200-235): API per
  registrare/leggere usage incluse stime weekly.

Eppure alla domanda diretta *"quanto manca al reset settimanale?"* il
Capitano:
1. Cerca in `sentinel-data.jsonl` (il suo log abituale)
2. Non trova `weekly_reset_at`
3. **Si ferma** e dichiara *"non ho il dato preciso nel log"*
4. **NON tenta**: grep nelle skill, lettura sorgenti bridge, query UI Kimi diretta, calcolo retroattivo da quando `weekly_usage` è saltato a 0

Pattern già visto: bug **#17** (Capitano passivo davanti a code vuote),
bug **#3** (paralisi C-01), bug **#21** (status non promosso). Famiglia
comune: *Capitano riconosce limite, segnala all'utente, non scava da
solo*.

**Fix proposto** — 2 componenti coordinati:

### Fix A — Bridge aggiunge `weekly_reset_at` ai tick

In `agents/_skills/check_usage.py` (o `bridge.py`) la funzione che
parsea la UI Kimi deve estrarre anche il timestamp reset weekly e
includerlo nel JSON tick:

```python
def parse_kimi_usage(text: str) -> dict:
    # ...existing parsing...
    m_weekly_reset = re.search(
        r"Weekly cap resets? at\s+(\d{2}:\d{2})\s+UTC",
        text,
    )
    weekly_reset_at = m_weekly_reset.group(1) if m_weekly_reset else None
    # OR calcolare da next-Monday-09:00 se Moonshot usa rolling weekly
    return {
        "weekly_usage": weekly_pct,
        "weekly_reset_at": weekly_reset_at,
        "weekly_reset_iso": iso_from_hhmm_next_match(weekly_reset_at),
        ...
    }
```

Poi `sentinel-bridge.py` scrive `weekly_reset_at` e `weekly_reset_iso`
in ogni entry del `sentinel-data.jsonl`. Disponibile per Sentinella +
Capitano + visualizzazioni.

### Fix B — Regola C-06 Capitano: "indaga sempre prima di dichiarare 'non lo so'"

In `agents/capitano/capitano.md` aggiungere regola:

> *"**C-06 — Investiga prima di dichiarare 'non lo so'**. Quando l'utente
> chiede un dato di sistema (rate-budget, reset, stato agente, configurazione)
> e non lo trovi nei tuoi log abituali, prima di rispondere *"non ho il
> dato"* esegui almeno questi 4 fallback in ordine:*
> *1. `grep -rn '<keyword>' /app/shared/skills/ /app/agents/`*
> *2. `find /app /jht_home -name '*<keyword>*'`*
> *3. Leggi sorgenti bridge in `/app/launcher/` per capire dove
>    quel dato viene calcolato*
> *4. Se ancora nulla, allora dichiara onestamente 'non lo trovo nei
>    log né nei sorgenti, ecco cosa ho cercato:' con la lista dei tentativi"*

L'utente non dovrebbe mai dover scrivere *"indaga"* — il Capitano deve
indagare di default.

**Priorità**: media-alta. Il dato weekly è importante per planning
(quando posso accelerare?), e il pattern di passività è impattante a
livello di UX.

**Effort**:
- Fix A: piccolo (~10-20 righe nel parser bridge + 1 colonna in
  `sentinel-data.jsonl`)
- Fix B: piccolo (regola prompt + ~3 esempi di fallback nel manuale
  Capitano)

**Validazione**:
- Dopo Fix A: ogni nuovo entry in `sentinel-data.jsonl` ha `weekly_reset_at`.
- Dopo Fix B: la domanda *"quanto manca al reset settimanale?"* riceve
  risposta corretta al primo turno, senza spinta utente.

**Riferimento conversazionale**: 13:45-13:50 UTC, sequenza 4 messaggi.

**Bug collegati**:
- **#17** (Capitano passivo davanti a code vuote): identica famiglia
  "riconosce ma non agisce". #19 è la variante "non sa ma non cerca".
- **#3** (paralisi C-01): variante "ha l'autorizzazione ma teme di usarla".
- **#11** (Mentor stile reference): il Mentor in 6 risposte non ha mai
  detto *"non ho il dato"* — quando non sapeva, faceva subito query
  DB. Il Capitano potrebbe imparare quel pattern.

---

## 🐛 20. Pagina `/reports` 100% mock — zero query Supabase, dati hardcoded

**Sintomo** (rilevato dall'utente via screenshot 2026-05-17):

La pagina pubblica `jobhunterteam.ai/reports` mostra KPI fittizi:
- 9 candidature
- 33% tasso risposta
- 2 colloqui
- 1 offerta
- 5.4g tempo risposta medio
- Top aziende: **TechFlow, Acme Corp, DataWise S.r.l., CloudBase,
  CodeLab S.p.A., NetPrime**

**Nessuna di queste aziende esiste nel team**. Le aziende REALI
processate sono: Bending Spoons, Rinse, Gr4vy, Company 033, MLabs, JUMO,
INDI, ION, Dacomat, SerpApi, ION Berry, Bitpanda, Fliff, Revenue
Analytics, RedCarbon, Blackshark, Initialize, DID, Sisal,
Immobiliare.it, Company 182, Haoborn, Deloitte, LC Service,
LeadTech.

**Causa** — `web/app/api/reports/route.ts` è 100% mock:

```typescript
function buildMonthly(days: number): MonthData[] {
  // ...
  const sent = 8 + Math.abs(Math.round(Math.sin(seed * 1.7) * 12));
  const responses = Math.round(
    sent * (0.25 + Math.abs(Math.sin(seed * 2.3)) * 0.35),
  );
  // ...
}

function buildPhaseTimes(): PhaseTime[] {
  return [
    { phase: "Screening CV", avgDays: 3.2 },
    { phase: "Primo colloquio", avgDays: 8.5 },
    { phase: "Colloquio tecnico", avgDays: 14.1 },
    { phase: "Offerta", avgDays: 21.7 },
    { phase: "Rifiuto", avgDays: 12.3 },
  ];
}

function buildTopCompanies(): TopCompany[] {
  return [
    { company: "TechFlow", applications: 4, responses: 3 },
    { company: "Acme Corp", applications: 3, responses: 2 },
    { company: "DataWise S.r.l.", applications: 3, responses: 1 },
    { company: "CloudBase", applications: 2, responses: 2 },
    { company: "CodeLab S.p.A.", applications: 2, responses: 1 },
    { company: "NetPrime", applications: 2, responses: 0 },
  ];
}

export async function GET(req: NextRequest) {
  // ...zero await supabase.from(...).select(...)
  const kpi = {
    totalApplications: totalSent,           // mock
    responseRate: ...,                       // mock
    interviewsScheduled: Math.round(totalResponses * 0.6),    // mock
    offersReceived: Math.max(1, Math.round(totalResponses * 0.15)), // mock
    avgResponseDays: 5.4,                    // HARDCODED
  };
  return NextResponse.json({ period, days, kpi, monthly,
                              phaseTimes: buildPhaseTimes(),
                              topCompanies: buildTopCompanies() });
}
```

Zero `createClient()`, zero `.from("applications")`, zero
`.from("responses")`. Dati totalmente disconnessi dal sistema reale.

**Stato reale** (dal team JHT su VPS):
- 12 CV `applications.status = 'ready'`
- **0** `applications.status = 'sent'` (utente non ha ancora applicato
  manualmente — by design, vedi #9 declassato)
- **0** risposte HR (perché 0 inviati dall'utente)
- **0** colloqui
- **0** offerte

Il report dovrebbe mostrare tutto **0** con messaggio *"Nessuna
candidatura inviata ancora — vedi `/applications` per i 12 draft
pronti"*. Invece mostra metriche fittizie credibili.

**Impatti**:

1. **Falsifica UX prodotto**: un utente che apre `/reports` crede di
   avere un track record reale (33% response rate è in linea con
   benchmark industry). Inganno involontario ma totale.
2. **Nasconde il problema di trazione reale**: se l'utente credesse al
   report, non vedrebbe che ha 12 CV pronti aspettando il suo apply
   manuale. Anche con design user-curated apply (vedi #9), un report
   onesto deve mostrare il funnel: trovate → ready → cliccato link →
   marcato come inviato.
3. **Discredita il sistema quando scoperto**: come è successo qui —
   l'utente nota i nomi aziende inventati e perde fiducia.
4. **Blocca decisioni reali**: il Mentor potrebbe analizzare i pattern
   delle aziende che rispondono di più → ma se i dati sono fake, anche
   l'analisi è fake.

**Fix proposto** — riscrittura `route.ts` con query Supabase reali:

```typescript
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const periodKey = req.nextUrl.searchParams.get("period") ?? "30d";
  const days = PERIODS[periodKey] ?? 30;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // KPI principali
  const [
    { count: totalApplications },
    { count: totalResponses },
    { count: interviewsScheduled },
    { count: offersReceived },
  ] = await Promise.all([
    supabase.from("applications").select("id", { count: "exact", head: true })
            .eq("user_id", user.id).eq("status", "sent").gte("sent_at", since),
    supabase.from("responses").select("id", { count: "exact", head: true })
            .eq("user_id", user.id).gte("received_at", since),
    supabase.from("interviews").select("id", { count: "exact", head: true })
            .eq("user_id", user.id).gte("scheduled_at", since),
    supabase.from("offers").select("id", { count: "exact", head: true })
            .eq("user_id", user.id).gte("offered_at", since),
  ]);

  // Tempo medio risposta
  const { data: respTimes } = await supabase
    .from("responses")
    .select("received_at, application:applications(sent_at)")
    .eq("user_id", user.id).gte("received_at", since);
  const avgResponseDays = respTimes?.length
    ? respTimes.reduce((s, r) => s + daysBetween(r.application.sent_at, r.received_at), 0) / respTimes.length
    : null;

  // Monthly aggregation
  const monthly = await monthlyFromDb(supabase, user.id, days);

  // Phase times (richiede event log → vedi bug #14)
  const phaseTimes = await phaseTimesFromDb(supabase, user.id, days);

  // Top companies
  const { data: topCompanies } = await supabase
    .from("applications")
    .select("company, status")
    .eq("user_id", user.id).gte("sent_at", since);
  // Group + count manualmente

  return NextResponse.json({ period, days, kpi: { ... },
                              monthly, phaseTimes, topCompanies });
}
```

**Dipendenze**:
- ~~**Bug #9**~~ (smentito): apply è user-curated by design.
  `applications.status='sent'` sarà popolato da bottone "Marca come
  inviata" sulla dashboard (UI da aggiungere). Il report #20 deve
  mostrare anche stati intermedi: `ready` → `cliccato_link` →
  `marcato_inviato` (manuale utente).
- **Bug #14** (state-event log): `phaseTimes` (Screening → Primo
  colloquio → Tecnico → Offerta) richiede transitions log. Senza, la
  metrica resta non calcolabile e va nascosta dall'UI.
- **Schema DB**: serve tabelle `responses`, `interviews`, `offers`
  (verificare se esistono — probabilmente no, da creare).

**Priorità**: **alta**. È un bug di **integrità del prodotto**, non
solo UX. Un utente che vede metriche fake potrebbe prendere decisioni
sbagliate (es. non chiedersi perché non viene chiamato).

**Effort**:
- **Minimo** (1-2h): sostituire mock con query Supabase, accettare
  che molti numeri saranno 0 finché bug #9 non è chiuso. Aggiungere
  empty state UI: *"Nessuna candidatura inviata ancora"*.
- **Completo** (1 giorno): migrazione DB per `responses`, `interviews`,
  `offers` + form/UI per registrare risposte HR + integrazione con
  bug #14 per phase times.

**Validazione**: dopo fix, la pagina `/reports` deve mostrare:
- 0 candidature inviate (finché utente non marca manualmente "inviata"
  via dashboard, secondo design user-curated apply)
- 0% tasso risposta
- 0 colloqui, 0 offerte
- Lista vuota top aziende
- Empty state UI esplicito

E **mai** TechFlow / Acme Corp / DataWise — quei nomi non devono più
apparire nella codebase.

**Riferimento**: screenshot utente 2026-05-17 della pagina `/reports`,
file `web/app/api/reports/route.ts` (89 righe, 100% mock).

**Bug collegati**:
- ~~**#9** (submit-application)~~: smentito, l'apply è user-curated.
  Il /reports onesto deve mostrare il funnel reale incluso lo step
  "in attesa di apply utente" che oggi non è visualizzato.
- **#14** (state-event log): necessario per phase times reali.
- **Famiglia "fake data in prod"**: probabilmente altre pagine
  (`/responses`, `/growth`, `/applications`) potrebbero avere lo
  stesso problema — da audit.

---

## 🐛 21. `applications.status` mai promosso da `draft` a `ready` dopo Critic PASS

**Sintomo** (rilevato 2026-05-17 ~14:30 UTC dalla pagina `/ready`):

| Fonte | Cosa dice |
|---|---|
| Pagina `/ready` cloud | CV PRONTI: **0** / IN ATTESA CV: 13 |
| Capitano via Telegram | *"12 CV ready"* (msg 13:14) / *"4 CV ready (Bending, Rinse, Gr4vy, Company 033)"* (00:58) |
| `pipeline_overview.png` (Capitano) | Ready: **12** |
| **DB SQLite locale `/jht_home/jobs.db`** | `applications` = 31 totali, **TUTTE `status='draft'`** ❌ |
| Stessa query | `positions` = 62 excluded, 13 ready, 10 scored |

Tre "verità" diverse:
- **Capitano** dice 12 ready (e ha ragione concettualmente: 12 CV con
  Critic PASS, PDF pronto)
- **DB** dice 0 ready (e ha ragione tecnicamente: nessuna application
  ha `status='ready'`)
- **Cloud `/ready`** dice 0 ready (riflette il DB)

La pagina web è corretta; il bug è a monte: **nessuno aggiorna
`applications.status` da `'draft'` a `'ready'` quando il Critic dà PASS
e il PDF viene generato**.

**Causa** — manca lo step di promotion. Flow attuale:

```
1. Scrittore-1 crea draft        → INSERT applications (status='draft')
2. Critic legge draft + dà voto  → write critic_score, critic_notes
3. Critic 5.5/10 PASS            → ???
4. Scrittore-1 genera PDF        → UPDATE applications SET cv_path=..., cv_pdf_path=...
5. PDF ready                     → 🚨 NESSUNO esegue: UPDATE applications SET status='ready'
```

L'evidenza: nei `wire.jsonl` Capitano/Scrittore di `_skills/critic-loop/`
e `_skills/db-update/` probabilmente la transizione `status='ready'`
non è scritta da nessuna parte. Il Critic riconosce visivamente "PASS"
nel suo report, ma quel concetto non viene tradotto in DB update.

**Conseguenze a cascata**:

1. **Bug #20 (`/reports` mock)** difficile da fixare a metà strada:
   anche se sostituiamo i mock con query Supabase reali, mostreranno
   sempre 0 perché `applications.status='ready'` è 0.
2. **Pagina `/applications`** probabilmente mostra 31 draft tutti
   "incompleti" — l'utente non vede mai uno stato "pronto".
3. **Dashboard `/ready` per utente** bloccata: l'utente non vede mai
   i 12 CV PRONTI per fare apply manuale (vedi design user-curated
   #9). Anche solo per scegliere quale spedire, deve vedere lo status
   corretto.
4. **Trust del Capitano**: il Capitano dice *"ready"* nei suoi report
   ma il DB lo smentisce. Manuale del Capitano e schema DB non sono
   allineati semanticamente.

**Fix proposto** — aggiungere lo step di promotion in 1 di 2 punti:

### Opzione A — Critic chiude con UPDATE atomic

In `agents/_skills/critic-loop/SKILL.md` aggiungere step finale:

```
4. Dopo verdetto:
   - Se PASS:  UPDATE applications SET status='ready', ready_at=NOW(),
                   critic_score=X, critic_verdict='PASS'
               WHERE id=<app_id>
   - Se FAIL:  UPDATE applications SET status='draft' (resta),
                   critic_score=X, critic_verdict='FAIL',
                   critic_notes='<motivo>'
               WHERE id=<app_id>
   - Se REWRITE: UPDATE applications SET status='rewrite_requested'
               WHERE id=<app_id> (per Scrittore loop)
```

### Opzione B — Scrittore promuove dopo PDF generation

In `agents/_skills/cv-generate/SKILL.md` (o pdf-generate) aggiungere
ultimo step:

```
5. Dopo generazione PDF + Critic PASS confermato:
   UPDATE applications
   SET status='ready', cv_pdf_path=<path>, ready_at=NOW()
   WHERE id=<app_id>
```

**Raccomandazione**: **Opzione A** — il Critic è il "gate" naturale
(PASS/FAIL), e la promotion è semanticamente "il Critic approva il
draft". Coerente con il flusso di approvazione.

**Aggiunta a `db-update` SKILL.md**: regola esplicita
*"applications.status='ready' è SOLO impostabile dal Critic, mai
direttamente dallo Scrittore"* — gate single-writer.

**Dipendenze**:
- Bug **#14** (state-event log): se attivo, la transition
  `draft → ready` viene loggata automaticamente con `by_agent='critico-s1'`.
- ~~Bug **#9** (submit-application)~~: smentito post-revisione (apply
  manuale by design). Dopo fix #21, dashboard mostra correttamente CV
  ready all'utente che può fare apply scegliendo manualmente.
- Bug **#20** (`/reports` mock): si sblocca dopo #21 perché la pagina
  potrà finalmente mostrare numeri reali invece di mock.

**Priorità**: **alta**. È il **gate stato-tabella** che disallinea
Capitano/Critic concettuali dal DB. Sblocca contemporaneamente la
dashboard `/ready` (utente vede CV pronti per apply manuale), #20
(report onesto), e parzialmente #14.

**Effort**: piccolo. ~10-20 righe in `critic-loop/SKILL.md` + 1 regola
in `db-update/SKILL.md` + retrofit eventuale: una query SQL
`UPDATE applications SET status='ready' WHERE id IN (...)` per
promuovere retroattivamente le 12 application con `critic_verdict='PASS'`
attualmente in `draft`.

**Validazione**:
- Dopo fix: nuovo flow Scrittore→Critic deve risultare in
  `applications.status='ready'` per i PASS.
- Query SQL di verifica:
  ```sql
  SELECT status, critic_verdict, COUNT(*)
  FROM applications
  Company BY status, critic_verdict;
  ```
  Atteso: tutte le righe con `critic_verdict='PASS'` hanno
  `status='ready'`. Nessun `status='draft'` con `critic_verdict='PASS'`.
- Pagina `/ready` deve mostrare 12 CV PRONTI (corrispondenti ai 12 PASS).

**Riferimento conversazionale**: snapshot pagina `/ready` 2026-05-17,
DB locale `/jht_home/jobs.db` ispezionato via SSH.

**Bug collegati / catena**:
- ~~**#21 sblocca #9**~~ (smentito): apply è user-curated by design.
- **#21 sblocca #20**: senza promotion, /reports vede 0 ready ovunque.
- **#14**: se attivo, registra la promotion come event log.
- **#17** (Capitano passivo): il Capitano avrebbe dovuto notare la
  divergenza tra "12 ready" detto a voce e "0 ready" nel DB, ma non
  ha mai fatto query di verifica `SELECT status FROM applications`.

---

## 🐛 22. Assistente hallucina "messaggi non consegnati" — naming DB ambiguo `pending_user_messages`

**Sintomo** (13:40 UTC):

L'utente chiede all'Assistente *"come procede il sistema?"*. Risposta:
> *"⚠️ Ho anche trovato **2 messaggi di stato del Capitano che non ti
> sono mai arrivati** (uno del 16 maggio). Vuoi che te li recupero?"*

**Verifica fattuale** sul DB:
```
id=1 'Motore acceso. 🚀...'  delivered_via='telegram'  delivered_at='2026-05-16 17:12:20' ✅
id=2 'CV pronto per Rinse...' delivered_via='telegram'  delivered_at='2026-05-16 18:57:20' ✅
```
**Entrambi consegnati** 22h e 19h prima. **Zero messaggi pending realmente non recapitati**.

**Causa**: l'Assistente ha letto la tabella `pending_user_messages` e
assumed dal nome "tutto qui è pending". Avrebbe dovuto filtrare
`WHERE delivered_at IS NULL` → 0 risultati. Triplo strato di problema:

- **A. Naming tabella ambiguo**: si chiama `pending_user_messages` ma
  contiene tutti i messaggi (consegnati + non).
- **B. Query incompleta**: l'Assistente ha fatto `SELECT *` invece di
  filtrare sui campi `delivered_via`/`delivered_at` già popolati.
- **C. Output presentato come fatto, non come ipotesi**: nessun
  qualificatore ("forse"), affermazione confidente sbagliata =
  hallucination classica.

**Decisione utente** (verbatim, questa sessione):
> *"questo bug è abbastanza irrilevante: si potrebbe ottimizzare il
> naming delle tabelle o quant'altro, ma è di **bassa rilevanza**.
> Comunque, si potrebbe ottimizzare qualcosetta, ma non è gravissimo."*

**Fix proposto** (se mai si volesse, 3 livelli):
1. Rinominare tabella: `ALTER TABLE pending_user_messages RENAME TO
   user_messages_log`
2. Aggiungere `delivery_status` enum esplicito (pending/delivered/failed)
3. Regola **T15** in `_team/team-rules.md`: *"quando interroghi
   tabelle log di messaggi, NON limitarti a SELECT *. Filtra
   esplicitamente delivered_at IS NULL"*

**Priorità**: **bassa** (utente conferma: non gravissimo).
**Effort**: piccolo (~30 min se prioritizzato).

**Famiglia**: simile a #19 (Capitano "non lo so" sui weekly reset),
opposto al pattern #11 (Mentor che fa sempre query DB esplicite e
cita numeri raw senza allucinare).

---

## 🐛 23. Agenti user-facing non condividono stato live → consigli contraddittori all'utente

**Sintomo** (sequenza 13:40-13:56 UTC, ricostruita da `messages.jsonl`):

| Ora | Agente | Messaggio |
|---|---|---|
| 13:40:54 | Tu → Assistente | *"usage settimanale com'è messo? quando si resetta?"* |
| 13:41:36 | Assistente → Tu | *"⚠️ Stato: ATTENZIONE. Il sistema **consiglia di rallentare nuovi agenti**. Vuoi che dica al Capitano di metterli in pausa?"* |
| 13:55:53 | Tu → Capitano | *"dovete andare a tutta manetta - alle 17.10 dovete avere..."* |
| 13:55:53 | Capitano → Sentinella | *"[ORDINE UFFICIALE UTENTE] no freeze fino 17:10"* |
| 13:56:06 | Capitano → Tu | *"🚀 ORDINE ESEGUITO — **tutta manetta!**"* |
| 13:56:28 | Sentinella → Capitano | *"[ACK] ORDINE UFFICIALE UTENTE ricevuto. Override NO-FREEZE attivo."* |

L'Assistente alle 13:41 consiglia **RALLENTARE**. 14 min dopo il
Capitano esegue **ACCELERARE** su ordine utente. Due agenti
user-facing che dicono cose **opposte** nello stesso quarto d'ora.

Se l'utente alle 14:00 avesse richiesto status all'Assistente,
sentirebbe ancora "rallenta" perché l'Assistente non sa nulla
dell'ordine eseguito dal Capitano. **Stato disallineato**.

**Causa** — Tre layer di disallineamento:

### A. Nessun "live state" condiviso

I 3 agenti user-facing (Capitano, Assistente, Mentor) leggono
indipendentemente:
- File diversi (`sentinel-data.jsonl`, `pacing-bridge-state.json`,
  DB SQLite, pane scrollback)
- Snapshot a tempi diversi (Assistente alle 13:40 ammette di vedere
  snapshot "di ieri notte" nel pacing-bridge-state.json)
- Nessun broadcast inter-agente per eventi importanti (ordini utente,
  override Sentinella, decisioni Capitano)

### B. Assistente non legge cronologia inter-agente

`messages.jsonl` ha tutto: Capitano↔Sentinella, ordini utente,
override. L'Assistente potrebbe leggere le ultime 20 entry per capire
"cosa sta succedendo adesso" — non lo fa.

### C. Manca canale "broadcast" per ordini straordinari

Quando il Capitano riceve ordine speciale utente (tutta manetta /
freeza tutto / ignora Sentinella fino a X), lo esegue ma **non
broadcast** all'Assistente e Mentor. Per loro è come se non fosse
successo niente.

**Impatto**:
1. **Confusione utente**: due agenti, due consigli opposti nel
   medesimo minuto. Chi seguire?
2. **Decisione utente sbagliata possibile**: se avesse chiesto prima
   all'Assistente, avrebbe seguito "rallentare" e perso la finestra
   pre-reset settimanale.
3. **Trust erosion**: l'utente impara che alcuni agenti dicono cose
   obsolete, smette di fidarsi delle loro risposte rapide.

**Fix proposto — molto più semplice di quanto sembri** (decisione utente):

> *"Nelle loro istruzioni non hanno il comandamento principale: leggere
> sempre i dati prima di rispondere. Ovviamente, se aprono una
> conversazione live con l'utente, non è che a ogni risposta deve
> rileggere gli stessi file. Se ha già in memoria quello che chiede
> l'utente, non rilegge ogni volta. Però se chiede qualcosa di nuovo
> o che nel frattempo potrebbe essere aggiornato, deve andare a
> leggere la fonte."*

### Unica modifica necessaria — regola base nei prompt dei 3 agenti

Aggiungere ad `agents/{assistente,capitano,mentor}/*.md` un
comandamento:

```
## Comandamento dati: leggi la fonte, non la memoria

Prima di rispondere all'utente, valuta:

1. **Stessa domanda della tua ultima risposta in questa conversazione?**
   → Usa la memoria conversazionale, non rileggere.

2. **Domanda nuova OPPURE potenzialmente staleness > 1 min?**
   (stato sistema, budget, agenti, code, posizioni, applicazioni,
   ordini in corso, override Sentinella, ecc.)
   → **Sempre** query DB / leggi log freschi prima di rispondere.
   Mai basarsi su snapshot che hai letto 5 min fa.

3. **Domanda fattuale (numeri, conteggi, timestamp)?**
   → Query DB sempre. Nessuna eccezione.

Fonti canoniche da consultare:
- DB: `/jht_home/jobs.db` (positions, applications, scores)
- Sentinella: `/jht_home/logs/sentinel-bridge-state.json` (live state)
- Inter-agente: `tail -20 /jht_home/logs/messages.jsonl` (ordini recenti)
- tmux: `tmux list-sessions` (agenti effettivamente attivi)
```

**Niente helper unificato. Niente T16 complicata. Niente broadcast.**
Solo regola prompt che dice: *"non fidarti della memoria per dati
volatili"*.

**Priorità**: **media-alta** (resta).

**Effort**: **piccolissimo** (~15 righe in 3 file di prompt).

**Bug collegati**:
- **#11** (Mentor reference positivo): già applica questo pattern
  spontaneamente — fa sempre query DB prima di rispondere. Vale la
  pena copiare la sezione di prompt del Mentor in Assistente e
  Capitano per uniformare.
- **#22** (declassato): stessa famiglia "agente risponde su snapshot
  incompleti" — risolto dal comandamento sopra.
- **#19** (Capitano "non lo so" sul weekly reset): risolto in parte
  dal comandamento + C-06 *"indaga prima"*.

---

## 🐛 24. Sentinella troppo invadente in regime normale + comandi a 4 livelli grezzi — Capitano poca autonomia fine

**Sintomo apparente** (sessione 14:27→15:00 UTC):

Scout-2 in 33 min ha cambiato stato **3 volte**: kill → respawn →
kill di nuovo. Sembrava bug del Capitano "controllore bang-bang".

**Indagine cumulativa**: estrazione di TUTTI gli ordini
`@sentinella -> @capitano` dalle **5 finestre Kimi 16-17 maggio**
(F1-F5) da `messages.jsonl`. Script
`/tmp/sentinella_analysis.py` riproducibile.

### 📊 Statistiche aggregate su 5 finestre Kimi (~25h operative)

```
Totale ordini Sentinella → Capitano:   30
Totale ACK Capitano → Sentinella:      33

Categorie ordini (totale 30):
  RECOVERY (info)         6  ██████
  EMERGENZA/FREEZE        5  █████   ← 1 per ogni finestra!
  URG RALLENTARE          4  ████
  RESET                   4  ████
  INFO                    4  ████
  ACCELERARE              3  ███
  PEGGIORAMENTO           1  █
  PUSH G-SPOT             1  █
  BRIDGE TICK             1  █
```

### 🚨 Pattern aggregato #1: EMERGENZA in TUTTE e 5 le finestre

**100% delle finestre Kimi hanno avuto almeno 1 EMERGENZA + freeze
totale**. Nessuna finestra è mai stata "smooth". È normalizzato.

### 🚨 Pattern aggregato #2: EMERGENZA scattano TROPPO PRESTO

Distribuzione temporale: in quale percentuale della finestra è
arrivato il freeze EMERGENZA?

| Finestra | Quando scatta EMERGENZA | % finestra |
|---|---|---|
| F1 (16/05 17:11-22:11) | +67min dall'inizio | **22%** |
| F2 (16/05 22:11-03:11) | +36min dall'inizio | **12%** |
| F3 (17/05 03:11-08:11) | +271min dall'inizio | 90% ✅ |
| F4 (17/05 08:11-13:11) | +21min dall'inizio | **7%** |
| F5 (17/05 13:11-18:11) | +19min dall'inizio | **6%** |

**4 finestre su 5 hanno avuto EMERGENZA freeze entro il primo 22%
della finestra** (cioè nei primi 65 min su 300). Solo F3 ha avuto
freeze "ben piazzato" vicino alla chiusura (90%).

**Conferma totale dell'ipotesi utente**: la Sentinella sta freezando
in panico precoce sull'iniziale spike di velocity dei worker (tipico
"warmup"), invece che riservare il freeze al momento critico
(chiusura finestra).

### 🚨 Pattern aggregato #3: EMERGENZA non risolutiva — cascade

Cosa succede DOPO un EMERGENZA freeze?

| Finestra | Δt al prossimo ordine | Tipo successivo |
|---|---|---|
| F1 | +46min | URG RALLENTARE ← serve di nuovo! |
| F2 | +61min | PEGGIORAMENTO ← peggiora ancora! |
| F3 | +35min | RESET (fine finestra) ✅ |
| F4 | +16min | URG RALLENTARE ← serve di nuovo! |
| F5 | +27min | ACK loop (override utente NO-FREEZE) |

**3 finestre su 5** (F1, F2, F4): dopo EMERGENZA il sistema ha avuto
bisogno di **un altro ordine RALLENTARE/PEGGIORAMENTO**. Il freeze
non risolve, è solo il primo di una cascata.

### 🚨 Pattern aggregato #4: throttle a 3 valori discreti

Valori di throttle applicati dal Capitano sull'intero periodo:
```
600s:   3 volte  (max stop)
300s:   1 volta  (medio stop)
0s:     1 volta  (full speed)
```

Solo **3 valori distinti** in 25h di operatività. Tra 0 e 300 non
c'è MAI un "throttle 60", "throttle 120", "throttle 180". Tra 300 e
600 non c'è "throttle 400" o "450". La curva di controllo è
discontinua: salti enormi, mai modulazione fine.

### ⏱️ Pattern aggregato #5: frequenza ordini

- N ordini operativi totali (esclusi BRIDGE TICK puri e RECOVERY info): **24**
- Gap medio tra ordini: **50.7 min**
- Gap mediano: **30 min**
- Gap min/max: 13.7 / 208 min
- Ordini ravvicinati (<10 min, = oscillazione rapida): **0/23** ✅

**Nota positiva**: la frequenza ordini in sé NON è alta (gap mediano
30 min). Il bang-bang non è "oscillazione rapida" ma è "swing
ampio" — quando la Sentinella ordina, l'effetto è massimo (freeze o
kill). Pochi ordini, ma molto invasivi.

### 🎯 Conferma dall'utente (verbatim, questa sessione)

> *"Il mio sospetto, che mi è venuto durante i test, è che il capitano
> ascoltasse molto la sentinella, cioè quello che gli dice la sentinella
> sono comandi inrompibili, e quindi penso che la sentinella sia un po'
> troppo binaria. Mentre il capitano calibra, gli arriva un messaggio
> 'freeze' e lui 'freeza tutti' o 'kill all', che effettivamente funziona,
> ma sarebbe più efficiente aumentare il throttle fino a 600 secondi
> per vedere effettivamente come scende lo usage."*

> *"Se non è una soluzione, potrebbe essere di lasciare il capitano
> decidere un po' più per conto suo. La sentinella ci serve più alla
> fine delle finestre, quando la proiezione dello usage supera i 100
> prima della chiusura, quindi il momento critico dove dovrebbe operare
> la sentinella, più alla chiusura della finestra. Per rendere il
> monitoraggio più smooth e meno frenetico, su e giù, su e giù, ma più
> omogeneo."*

### ✅ Cosa funziona già (da NON toccare)

Confermato dai grafici `docs/sessions/2026-05-17-budget-windows/`:
- **Freeze pre-chiusura funziona**: ogni finestra la Sentinella ha
  freezato 30-60 min prima del reset, chiusura nel target G-spot
  90-95% in 4/4 finestre Kimi.
- **Recovery tracking funziona**: il Capitano riceve segnali sul calo
  proj e riprende controllo.
- **Sentinella sa chiudere bene la finestra** — questo è il suo
  valore aggiunto.

### 🔧 Fix proposto — Suddividere ruoli Sentinella/Capitano per fase

#### Fase 1 — Regime normale (proj < 100% E > 30 min al reset)

**Sentinella in modalità INFO-only**:
- Manda solo `[BRIDGE TICK]` con dati raw
- NESSUN ordine `ACCELERARE` / `RALLENTARE` / `FREEZE`
- Lascia il Capitano libero di modulare

**Capitano gestisce throttle fine-grained autonomamente**:
- Calcola `vel_needed = (target_pct - current_pct) / hours_to_reset`
- Confronta con `vel_actual`
- Adatta throttle in **valori continui** (es. 30s, 60s, 90s, 120s,
  180s, 240s, 300s)
- Spawn/kill **solo** quando code vuote o saturate, non per modulare velocità

#### Fase 2 — Regime critico (proj > 100% O ultimi 30 min finestra)

**Sentinella si attiva**:
- `URG RALLENTARE` con valore throttle proporzionale (non solo 300/600)
- Esempio scala throttle continuo:
  ```
  100% < proj ≤ 110%  →  throttle 120s
  110% < proj ≤ 130%  →  throttle 240s
  130% < proj ≤ 150%  →  throttle 360s
  150% < proj ≤ 200%  →  throttle 600s
  proj > 200%          →  freeze_team.py
  ```
- `EMERGENZA freeze + kill` riservato solo a proj > 200% O persistente >150% per 3 tick

#### Fase 3 — Chiusura finestra (ultimi 30 min)

**Sentinella domina** (comportamento attuale OK):
- Ordina freeze a 90-95% per chiudere finestra in target
- Conferma trend con `RECOVERY TRACKING`

### 📊 Implementazione concreta — 3 modifiche

1. **`/app/launcher/sentinel-bridge.py`** o equivalente:
   - Aggiungere logica "Fase 1/2/3" (lookup time_to_reset + proj)
   - Sostituire ordini binari con scala throttle continua
   - Rimuovere `kill -9` dai default, riservarlo a soglie estreme

2. **`agents/sentinella/sentinella.md`**:
   - Regola **S-04** *"In Fase 1 (regime normale), invia solo
     `[BRIDGE TICK]` info. NESSUN comando operativo."*
   - Regola **S-05** *"Quando suggerisci throttle, usa scala continua
     30-600s proporzionale a proj, non solo {0, 300, 600}."*

3. **`agents/capitano/capitano.md`**:
   - Regola **C-07** *"In Fase 1 hai autonomia piena sul throttle. Non
     aspettare ordini Sentinella per modulare velocità. Adatta in
     valori continui ad ogni tick."*
   - Mantenere C-01 (obbedienza Sentinella) **solo** durante Fase 2/3.

### 🎯 Priorità: **alta** (decisione utente)

L'utente ha confermato: *"Per rendere il monitoraggio più smooth e
meno frenetico, su e giù, su e giù, ma più omogeneo, possiamo
ottimizzare questa parte"*. È una fonte di stress operativo (9 episodi
URG+EMERGENZA su 100 messaggi recenti, vedi audit VPS health).

### ⏱️ Effort: **medio**

- Logica fasi in `sentinel-bridge.py` (~50 righe)
- Scala throttle continua (~20 righe)
- 2 regole prompt in `sentinella.md` (S-04, S-05)
- 1 regola prompt in `capitano.md` (C-07)
- Test su 2-3 finestre Kimi per validare smoothness

### 🔗 Bug collegati

- **#2** (Sentinella ipersensibile freeze): è la **versione originale**
  di questo bug. Bug #24 lo amplia con la separazione di responsabilità
  Sentinella↔Capitano in fasi.
- **#3** (Capitano paralizzato da C-01): risolto in parte da C-07 (in
  Fase 1 il Capitano ha autonomia).
- **#17** (Capitano passivo davanti a code vuote): il bug #24 dà al
  Capitano autonomia operativa, sblocca anche #17.
- **#4** (Performance band 85-95% non rispettata): il smoothing
  proposto da #24 dovrebbe portare più finestre in target stabile.

### 📈 Validazione post-fix (baseline cumulativa)

Misurare su 5 finestre Kimi consecutive (stesso scope dell'indagine):

| Metrica | Baseline attuale (5 finestre 16-17 mag) | Target post-fix |
|---|---|---|
| EMERGENZA per finestra | **1.0 (100%, 5/5 finestre)** | **0.2 (1/5)** |
| EMERGENZA scattate < 30% finestra | **4/5 (80%)** | **0/5** |
| EMERGENZA seguite da cascade RALLENTARE/PEGGIORAMENTO | **3/5 (60%)** | **0/5** |
| Valori throttle distinti applicati | **3** (0, 300, 600) | **≥7** (es. 30, 60, 120, 180, 240, 300, 600) |
| Kill/respawn worker per finestra | media 1-2 | ≤ 1 (solo loop confusi) |
| Hit rate target G-spot 90-95% | 4/4 osservate ✅ | mantenuto |
| Gap mediano tra ordini operativi | 30 min | accettabile, no target |

---

## 🐛 25. Deduplicazione mancante a 3 livelli — Scout + DB + file CV (spreco token + data corruption)

**Sintomi quantitativi** (snapshot DB `/jht_home/jobs.db` 15:50 UTC):

```
Aziende con duplicati: 14 (Company 033 14x!, altre 9 con 2x)
URL esatti duplicati nel DB: 1
title+company duplicati: 4
CV PDF sovrascritti (path identici per app diverse): ≥1
```

### 14 Company 033 scoperti = 15% di tutto il pool (90 posizioni)

```
#4   excluded  Graduate SWE                  scout-1  canonical.com/careers/7814327
#22  ready     Junior Data Engineer          scout-2  canonical.com/careers/6642917
#27  excluded  SE Python Ubuntu Pro          scout-2  bebee.com/it/jobs/...
#28  ready     Junior SW Developer Observ.   scout-1  canonical.com/careers/2166631
#33  ready     Python SE Commercial Systems  scout-2  canonical.com/careers/6401160
#34  excluded  SE Python Container Images    scout-2  canonical.com/careers/6222476
#35  excluded  SE Python/Golang K8s          scout-2  canonical.com/careers/2928962
#62  excluded  Junior Ubuntu SE              scout-1  canonical.com/careers/6707669
#67  excluded  SE Data Infrastructure        scout-1  greenhouse.io/canonical/jobs/3014391
#68  excluded  Python Ubuntu Pro graduate    scout-1  greenhouse.io/canonicaljobs/jobs/6908672
#72  scored    Graduate SWE                  scout-1  greenhouse.io/canonical/jobs/7814327   ← DUP #4!
#74  scored    Python+K8s SE Data Workflows  scout-2  greenhouse.io/canonical/jobs/5703396
#79  scored    SE Python/Linux/Packaging     scout-2  greenhouse.io/canonical/jobs/2413329
#102 new       Junior SW Developer Observ.   scout-2  euremotejobs.com/job/...               ← DUP #28!
```

**Duplicati confermati** (stesso job, URL diversi):
- `7814327` (Graduate SWE) trovato 2× in 21h
- `2166631` (Observability) trovato 2× in 12h, secondo via re-skinning su euremotejobs

### 3 livelli di bug

**Livello A — Scout non normalizza URL/job_id**

Stesso job riskinned su 3 board (company website + Greenhouse + euremotejobs)
viene inserito come 3 posizioni distinte. Causa: nessuna estrazione di
`external_id` canonico (es. `canonical:2166631`) prima dell'INSERT.

**Livello B — DB senza UNIQUE constraint**

`positions` non ha `UNIQUE (company, title)` né `UNIQUE (external_id)`.
INSERT duplicati passano sempre. Esempio:
`https://job-boards.eu.greenhouse.io/remotepeople/jobs/4803615101`
salvato 2 volte come record distinti.

**Livello C — Scrittore naming file collidente**

Pattern attuale `CV_<name>_<company>.pdf`. Se 2+ app per stessa azienda
→ secondo PDF **sovrascrive** primo. Sul disk c'è 1 file, nel DB 2
application puntano allo stesso path.

Verificato:
```
app#17 (pos#28 Company 033 Observability) →
  /jht_user/cv/CV_LeoneEmanuelPuglisi_Company 033.pdf
app#30 (pos#62 Company 033 Junior Ubuntu) →
  /jht_user/cv/CV_LeoneEmanuelPuglisi_Company 033.pdf  ← STESSO PATH!
```

Quando l'utente apre il PDF "per app#17" legge il contenuto scritto
per app#30. **Data corruption silente.**

### 💥 Impatto

1. **Spreco token Kimi massivo**: 14 Company 033 = 10-14× lo stesso lavoro
   upstream (Analista verifica + Scorer score + se passa anche Scrittore
   + Critic loop). Stima: 50-70% di **una finestra Kimi (5h)** sprecata
   su Company 033 only. Sui 5 dump 16-17 mag impatto cumulativo equivalente
   a probabilmente **1 finestra intera sprecata**.

2. **Data corruption CV silente**: utente fa apply manuale (vedi #9
   user-curated). Se carica il CV "sbagliato" su Company 033 Observability
   ma il file ha il testo di Junior Ubuntu, manda candidatura con
   esperienza/keyword non aderenti. **Rischio reputazionale.**

3. **Confusione UX dashboard**: "3 PASS Company 033" mostrato in `/ready`
   → utente pensa "3 opportunità diverse", in realtà 2-3 versioni dello
   stesso job riskinned. Trust erosion.

### 🔧 Fix proposto — 3 modifiche

#### A. Scout: regola SC-06 — dedup gerarchica one-shot pre-insert

**Strategia gerarchica** (decisione utente, questa sessione):

> *"Magari dovremmo dargli un ID in base all'azienda, perché si può
> filtrare meglio. Però ci stanno grandi aziende che offrono la stessa
> posizione in città diverse, quindi anche qui non stiamo filtrando.
> Il link non esclude il duplicato, perché magari una è un'offerta da
> un provider e l'altra da un altro provider, però è sempre la stessa
> offerta."*
>
> *"Controllare prima il link, poi controllare se l'azienda è già
> stata trovata lì. Si capisce un sacco di cose: in realtà un'azienda
> non è che ha più annunci dello stesso tipo della stessa offerta di
> lavoro, quindi già la si capisce tantissimo. Poi si va a controllare
> il nome dell'offerta: se il ruolo è lo stesso, già lì si dovrebbe
> escludere."*

In `agents/scout/scout.md` (regola SC-06):

```
## SC-06 — Deduplicazione gerarchica pre-insert (one-shot)

Per ogni job trovato, PRIMA di INSERT, esegui 3 query in cascata.
Se UNA matcha → SKIP (log "duplicate:<level>:<existing_id>").
Se NESSUNA matcha → INSERT.

LIVELLO 1 — Match URL esatto (più rigoroso)
  SELECT id FROM positions WHERE url = ?
  → Se match: dup certo (stesso link). Skip.

LIVELLO 2 — Match azienda + titolo (semantico)
  SELECT id FROM positions
   WHERE LOWER(company) = LOWER(?)
     AND LOWER(title)   = LOWER(?)
  → Se match: probabile dup (stesso ruolo dalla stessa azienda).
    Assunto: un'azienda non duplica internamente lo stesso annuncio.
    Skip — anche se URL diverso (è solo riskinning su altro provider).

LIVELLO 3 — Match azienda + ruolo simile + stessa location
  (graduale, per filtrare riskinning con titoli leggermente diversi)
  SELECT id FROM positions
   WHERE LOWER(company) = LOWER(?)
     AND title_similarity(title, ?) > 0.85
     AND COALESCE(location,'') = COALESCE(?,'')
  → Se match: probabile dup. Skip.

Note importanti:
- Stessa azienda + stesso titolo MA city diversa (es. "Company 033
  Junior Python" Milano vs Berlino) → NON skip. Sono offerte distinte.
  Per questo il LIVELLO 2 cattura solo il caso city uguale (o entrambe
  null). Se city differiscono → procedi all'INSERT.
- title_similarity() può essere semplice ratio Levenshtein o token
  Jaccard. Soglia 0.85 = stessa offerta con piccole variazioni
  ("Junior Software Engineer" vs "Software Engineer, Junior").
- Logging obbligatorio: ogni skip = una riga in
  /jht_home/logs/scout-dedup.log con i 4 campi
  {now, scout_id, level, existing_position_id, skipped_url}.
- Persiste external_id solo come campo opzionale (per debugging/audit),
  non come chiave UNIQUE — la combo URL/company+title è più affidabile.
```

#### B. DB: indici di supporto + dedup retroattivo

```sql
-- Indici per accelerare le 3 query SC-06 (no UNIQUE — solo lookup veloce)
CREATE INDEX IF NOT EXISTS idx_positions_url ON positions(url);
CREATE INDEX IF NOT EXISTS idx_positions_company_title
  ON positions(LOWER(company), LOWER(title));

-- Cleanup retroattivo: marca i duplicati esistenti come excluded
-- (non DELETE per preservare history e poter riprenderli se serve)
WITH dups AS (
  SELECT MIN(id) AS keep_id, LOWER(company) AS co, LOWER(title) AS ti
  FROM positions
  Company BY LOWER(company), LOWER(title), COALESCE(location,'')
  HAVING COUNT(*) > 1
)
UPDATE positions SET
  status='excluded',
  notes=COALESCE(notes,'')||' [DEDUP] superseded by id='||(
    SELECT keep_id FROM dups d
    WHERE d.co=LOWER(positions.company) AND d.ti=LOWER(positions.title)
  )
WHERE id NOT IN (SELECT keep_id FROM dups)
  AND (LOWER(company), LOWER(title)) IN (SELECT co, ti FROM dups);
```

Niente UNIQUE constraint — i 3 livelli applicativi in SC-06 sono più
flessibili (es. permettono stesso ruolo in city diverse).

#### C. Scrittore: naming file con position_id

Cambiare pattern da `CV_<name>_<company>.pdf` a:
```
CV_<name>_<position_id>_<company-slug>_<title-slug>.pdf

Esempio:
CV_LeoneEmanuelPuglisi_28_canonical_observability.pdf
CV_LeoneEmanuelPuglisi_62_canonical_junior-ubuntu.pdf
```

`position_id` garantisce unicità assoluta. Slug aiuta utente a
riconoscere il file dal nome.

### 🎯 Priorità: **alta**

Doppio impatto: spreco token (ROI immediato) + data corruption CV
(rischio reputazionale per utente che fa apply manuale, vedi #9).

### ⏱️ Effort: **medio**

- Regola SC-06 + helper `extract_external_id()` (~30 righe Python)
- Migrazione DB UNIQUE + cleanup retroattivo (~20 righe SQL)
- Modifica naming Scrittore (~5 righe + retrofit 31 file PDF esistenti)
- Test su 2 finestre Kimi per verificare riduzione duplicati

### 📈 Validazione post-fix

| Metrica | Baseline | Target |
|---|---|---|
| `SELECT external_id, COUNT(*) FROM positions Company BY 1 HAVING COUNT(*)>1` | non query-abile (campo mancante) | 0 risultati |
| Aziende con >5 positions | 1 (Company 033 14x) | 0 |
| URL esatti duplicati | 1 | 0 |
| CV PDF con path collidenti | ≥1 | 0 |

### 🔗 Bug collegati

- **#12** (Scout learning loop): la source-blacklist proposta in #12 è
  un sovrainsieme della dedup di #25. Possono essere implementati
  insieme.
- **#21** (draft→ready promotion): se le applications hanno path file
  collidenti, anche la promotion mostra dati sbagliati nella dashboard.
- **#9 declassato** (user-curated apply): l'utente che fa apply manuale
  ha più che mai bisogno che il CV scaricato sia quello giusto. Bug
  #25 amplifica il danno potenziale di #9.

---

## 🐛 26. Gap disk↔DB sui CV: 2 PASS top-score invisibili + 3 CV generati per posizioni excluded/reject

**Evidenza** (snapshot DB+disk 15:50 UTC):

```
PDF sul disk:           27
PDF unique in DB:       22
Gap: 5 PDF orfani (su disk ma DB non li conosce)
```

### A. 3 PASS con `cv_pdf_path=NULL` (file su disk ma DB non lo sa)

**Correzione importante** (revisione utente con screenshot dashboard):
Sisal **non è invisibile**, è **mal-categorizzata**. Verifica via DB:

```
SISAL (pos #30):
  positions.status    = 'ready'   ✅ (è nella lista 13 visibili)
  applications.status = 'draft'   ❌ ← bug #21 (mai promosso a ready)
  critic_score=7.5  verdict=PASS  ✅
  cv_pdf_path = NULL              ❌ ← bug #26
  File CV su disk: ✅ (28KB, 04:43 UTC)
```

Nella dashboard `/ready` Sisal **compare** nella sezione *"POSIZIONI
READY — CV DA SCRIVERE (13)"*, NON in *"CV PRONTI DA INVIARE (0)"*.
Per l'utente: *"Sisal CV ancora da scrivere"* — falso, il CV esiste già.

| app | Azienda | Critic | Verdict | app.status | cv_pdf_path | File su disk |
|---|---|---|---|---|---|---|
| **#20** | **Sisal Data Analytics Trainee** | **7.5/10** ⭐ | **PASS** | draft | `NULL` ❌ | ✅ (28KB) |
| **#19** | Leadtech Junior Data Eng. Mobile | 5.5/10 | PASS | draft | `NULL` ❌ | ✅ (29KB) |
| #21 | Company 033 Commercial Systems | 5.5/10 | PASS | draft | `NULL` ❌ | n/d (probabile collisione bug #25) |

**Effetto reale**: utente vede *"CV da scrivere"* per posizioni il cui
CV è già stato scritto. UI ingannevole. Rischio aggiuntivo: utente
preme "rigenera CV" (se esiste in futuro), team rifa il lavoro
inutilmente sprecando budget.

### A-bis. Cascade con bug #21 (causa principale dashboard 0/13)

**Tutte le 13 PASS hanno `applications.status='draft'`** (bug #21). La
sezione "CV PRONTI DA INVIARE" della dashboard mostra **0** non solo
per le 3 con cv_pdf_path NULL, ma per **TUTTE** perché la query è
`WHERE applications.status='ready'` → 0 risultati.

Quindi:
- Bug **#21** è la causa principale del "0 CV pronti" visibile
- Bug **#26** è secondario ma reale: anche dopo fix #21, le 3 app
  Sisal/Leadtech/Company 033#33 resterebbero senza file collegato

### B. 3 CV generati per posizioni EXCLUDED/REJECT (spreco)

```
CV_LeoneEmanuelPuglisi_Company 033_ContainerImages.pdf  →  pos #34 EXCLUDED
CV_LeoneEmanuelPuglisi_Company 033_K8s.pdf              →  pos #35 EXCLUDED
CV_LeoneEmanuelPuglisi_Deloitte.pdf                   →  REJECT Critic
```

Lo Scrittore ha generato CV per posizioni che **non avrebbero dovuto
entrare nella sua coda** (status `excluded` dall'Analista upstream)
oppure ha proceduto **dopo** il REJECT del Critic (Deloitte).

### 🧠 Cause sospette

**Causa A — Race condition Scrittore ↔ DB**: il flusso *"Scrittore
genera PDF → UPDATE applications SET cv_pdf_path"* ha 2 step
atomicamente separati. Se l'UPDATE fallisce (lock SQLite, throttle
Sentinella che killa mid-write, freeze EMERGENZA) il PDF resta orfano.

Sisal/Leadtech generati 04:30-04:43 UTC = finestra F3 con
**EMERGENZA freeze alle 07:42**. Plausibile che processi Scrittore
siano stati killati durante operazioni di scrittura → mv PDF eseguito,
UPDATE SQL no.

**Causa B — Scrittore non rispetta status filter pre-generazione**:
l'Analista marca `positions.status='excluded'` ma lo Scrittore lavora
comunque su queste posizioni (o le porta `excluded` AFTER aver
generato il CV). Bug di ordering del flow (collegato a #21).

### 💥 Impatto

1. **2 opportunità lavoro nascoste**, incluso il top PASS (Sisal 7.5)
2. **3 CV sprecati** (~84KB + budget Kimi per generazione + Critic
   review). Stima: 3-5% di una finestra Kimi (5h)
3. **Trust UX**: dashboard mostra dati incompleti
4. **Difficile da scoprire**: serve query SQL+disk per accorgersi

### 🔧 Fix proposto

#### W-03 — Atomic write CV PDF + DB UPDATE (in `cv-generate/SKILL.md`)

```
1. Genera PDF in tempfile: /tmp/cv_<app_id>_<ts>.pdf
2. Solo se PDF valido (size > 5KB, render OK):
   a. mv tempfile  /jht_user/cv/<final_name>.pdf
   b. UPDATE applications SET cv_pdf_path=?, cv_generated_at=NOW()
      WHERE id=?  -- stesso transaction
3. Se UPDATE fallisce → rm il file finale (no orfani)
4. Se size < 5KB o render fail → no mv, no UPDATE, log errore
```

#### W-04 — Verifica status prima di generare CV

```
Prima di iniziare PDF generation:
  SELECT status FROM positions WHERE id=?
Se status IN ('excluded','rejected') → ABORT con log
  "position #N is in status=X, skipping CV generation"
Mai generare CV per posizioni già scartate.
```

#### Cleanup retroattivo (one-shot)

```sql
-- Ricollegare Sisal e Leadtech (sono PASS validi)
UPDATE applications SET
  cv_pdf_path='/jht_user/cv/CV_LeoneEmanuelPuglisi_Sisal.pdf',
  cv_generated_at='2026-05-17 04:43:00'
WHERE id=20;
UPDATE applications SET
  cv_pdf_path='/jht_user/cv/CV_LeoneEmanuelPuglisi_Leadtech.pdf',
  cv_generated_at='2026-05-17 04:30:00'
WHERE id=19;
```

```bash
# Archiviare i 3 CV sprecati (no cancellare per audit)
mkdir -p /jht_user/cv/_excluded
mv /jht_user/cv/CV_*_Company 033_ContainerImages.pdf /jht_user/cv/_excluded/
mv /jht_user/cv/CV_*_Company 033_K8s.pdf /jht_user/cv/_excluded/
mv /jht_user/cv/CV_*_Deloitte.pdf /jht_user/cv/_excluded/
```

#### Healthcheck periodico (Dottore, bug #18)

`agents/_skills/cv-disk-audit/check.py`:
```python
disk_pdfs = set(glob("/jht_user/cv/*.pdf"))
db_pdfs  = set(query("SELECT cv_pdf_path FROM applications WHERE cv_pdf_path IS NOT NULL"))
orphans_on_disk = disk_pdfs - db_pdfs
ghosts_in_db    = db_pdfs - disk_pdfs
if orphans_on_disk or ghosts_in_db:
    notify_user(f"CV inconsistency: {len(orphans_on_disk)} orfani, {len(ghosts_in_db)} ghost")
```

Il Dottore lo esegue ogni 30 min (quando finalmente girerà, bug #18).

### 🎯 Priorità: **alta**

Impatto utente diretto: PASS top-score (Sisal 7.5) invisibile.
Sistema user-curated apply (#9) → utente non vede l'opportunità →
opportunità persa.

### ⏱️ Effort: **piccolo-medio**

- W-03 + W-04 (~30 righe in `cv-generate/SKILL.md`)
- Cleanup retroattivo (~30 righe SQL+bash, one-shot)
- cv-disk-audit (~50 righe, dipende #18)

### 🔗 Bug collegati

- **#25** (dedup): stessa famiglia "file management broken"
- **#21** (draft→ready promotion): stesso pattern "DB non riflette stato reale"
- **#9 declassato** (user-curated apply): se utente non vede Sisal, non può fare apply manuale
- **#18** (Dottore): healthcheck cv-disk-audit lo eseguirà il Dottore

---

## 📋 Riepilogo priorità

| # | Bug | Priorità | Effort |
|---|---|---|---|
| 1 | Voice/Photo Whisper/OCR/Vision | **alta** | medio |
| 2 | Sentinella throttle progressivo | **alta** | medio |
| 14 | **Stati pipeline transitori non loggati** (state-event log) | **alta** | medio |
| 16 | ✨ **Auto-report periodici + auto-grafici via Bridge orders** | **alta** | medio |
| 17 | **Capitano passivo davanti a code vuote** (C-05 auto-triage) | **alta** | piccolo-medio |
| 18 | **Dottore mai spawnato** (watchdog non lo include) | **alta** | piccolo-medio |
| 20 | 🚨 **`/reports` 100% mock** — zero query Supabase | **alta** | piccolo-medio |
| 21 | 🚨 **`applications.status` mai promosso draft→ready** dopo Critic PASS | **alta** | piccolo |
| 24 | **Sentinella troppo invadente in regime normale** (fasi + scala throttle continua) | **alta** | medio |
| 25 | 🚨 **Deduplicazione mancante** Scout/DB/CV — spreco token + data corruption | **alta** | medio |
| 26 | 🚨 **Gap disk↔DB sui CV** — 2 PASS top invisibili (Sisal 7.5) + 3 CV sprecati | **alta** | piccolo-medio |
| 3 | Capitano gerarchia utente > Sentinella | media | piccolo (prompt) |
| 4 | Performance band 85-95% rispettata | media | piccolo (post #2+#3) |
| 7 | Sync history conversazione su web | media | medio |
| 12 | **Scout hit-rate** (SC-05/T14 nei prompt base, no skill) | media | piccolo |
| 15 | Timezone confusion (agenti in UTC, utente in CEST) | media | piccolo |
| 19 | **Capitano non sa weekly reset Kimi** (dato + C-06 indaga) | media-alta | piccolo |
| 23 | **Agenti user-facing non rileggono dati freschi** (comandamento prompt) | media-alta | piccolo |
| 5 | Bridge cold start latency | bassa | piccolo |
| 6 | Capitano stay-on-topic | bassa | piccolo (prompt) |
| 10 | Mentor → Capitano channel | bassa | piccolo |
| 13 | Capitano invia template shell non espanso a Telegram | bassa | piccolo |
| 22 | Hallucination "msg non consegnati" — naming `pending_user_messages` ambiguo | bassa | piccolo |
| 8 | ~~Generate PNG/grafico~~ — **falso bug, già funziona** | — | — |
| 9 | ~~Submit-application skill~~ — **falso bug, design "user-curated apply"** | — | — |
| 11 | ✨ Mentor stile conversazionale = reference positiva | — | — |

**Pattern emergente A**: 4 dei bug (#2, #3, #4, #5) sono nella catena
**Bridge → Sentinella → Capitano**. Vale la pena fare un refactor coordinato
di questa catena come prossimo blocco di lavoro: regole esplicite di
threshold, hysteresis, override utente.

**Pattern emergente B — il vero gap di prodotto è il GATE di stato DB,
non la chiusura del loop end-to-end**:

(Aggiornato 2026-05-17 14:30 UTC dopo revisione utente — bug #9
declassato a falso bug per decisione di design "user-curated apply",
bug #12 declassato a media perché i numeri mostrano miglioramento
spontaneo)

- **#21 il vero collo di bottiglia**: `applications.status` mai
  promosso da `draft` a `ready` → tutta la dashboard mostra 0 CV pronti
  anche se il Critic ha dato 13 PASS. Fix piccolo (5-10 righe).
- **#12 come auto-tuning di base**: lo Scout sta già migliorando da solo
  (hit-rate 7% → 14% in 13h). Le regole SC-05/T14 nei prompt base
  formalizzano il comportamento auto-correttivo senza skill esterna.
- **L'utente fa l'apply manualmente** (design): JHT è
  CV-tailoring assistant, non auto-applier massivo. Il team si ferma
  giustamente a `applications.status='ready'`.

Flow corretto end-to-end:

```
Scout (SC-05 nei prompt: explore/exploit auto-tuning su feedback Critic)
  → Analista (T14: filtra in base a rejection patterns recenti)
  → Scorer → Writer → Critic
  → Critic PASS chiude con: applications.status='ready' (fix #21)
  → Dashboard /ready mostra 12 CV PRONTI con bottoni "Apri offerta",
    "Download CV", "Marca come inviata"
  → 👤 UTENTE sceglie e fa apply manualmente (NO auto-submit, by design)
  → user click "marca inviata" → status='sent' + timestamp
  → /reports mostra funnel reale: trovate → ready → cliccato → inviato
```

Risolti #21 + #20 + #12 (prompt) il sistema **mostra correttamente
il valore prodotto e si auto-migliora**, mantenendo l'utente al centro
della decisione finale di apply.

**Materiale di lavoro**:

In [`docs/sessions/2026-05-17-budget-windows/`](../sessions/2026-05-17-budget-windows/)
(versionato, vedi README per dettagli):
- `budget_chart.png` — finestra **corrente** 22:11→03:11 (00:18, 22 KB):
  ✅ al 00:13 usage 43%, **proj 95.0% = esattamente al target**. Linea
  blu reale e linea rossa trend retta sovrapposte sul punto giallo: il
  team sta procedendo al ritmo giusto (v_media necessaria 17.6%/h).
- `budget_chart_prev.png` — finestra **precedente** 17:11→22:11 (00:24, 24 KB):
  ✅ chiusa al **90%** (target 95%, v_media 16.4%/h costante). Salita
  lineare da 27% a 90%, chiusura al RESET.
- `usage_chart.png` + `usage_chart_v2.png` — iterazioni intermedie del Capitano.

In `docs/internal/conversations/2026-05-17/` (gitignored, materiale privato
utente):
- `cap-photo-00-08.jpg` — screenshot dashboard /positions mandato dall'utente
- `cap-voice-19-14.ogg` — nota vocale 2s mandata dall'utente (NON trascritta)

---

## ✅ Insight positivo — usage Kimi è effettivamente risolto

**Entrambe** le finestre disegnate dal Capitano mostrano un team che usa
bene il budget:

| Finestra | Apertura | Chiusura/proj | Target | Verdict |
|---|---|---|---|---|
| 17:11→22:11 (precedente) | 27% @ 18:02 | **90%** chiusa con RESET | 95% | ✅ ottimo |
| 22:11→03:11 (corrente) | 0% @ 22:11 | **95.0% proj @ 03:11** | 95% | ✅ perfetto |

Il freeze Sentinella delle 22:45 ha rallentato 30-60 min ma il team ha
recuperato e proietta target esatto. **Non è andata male nessuna delle
due finestre**. Pipeline tecnica + utilizzo budget = già a posto.

Restano comunque validi i bug #2/#3 (Sentinella troppo aggressiva +
gerarchia user override) perché in mezzo c'è stato spreco di tempo
recuperato solo grazie alla pressione dell'utente sul Capitano. In una
sessione senza umano vigilante, il freeze sarebbe rimasto attivo.
