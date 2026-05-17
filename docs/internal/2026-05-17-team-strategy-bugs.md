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

## 🐛 9. Nessun agente invia le candidature — skill `submit-application` mancante

**Sintomi** (emerso 2x dal Mentor):
- Msg Mentor #2 (23:39): *"9 candidature generate, nessuna inviata."*
- Msg Mentor #5 (00:17): *"Un punto operativo: 9 candidature generate, 0
  inviate. Il Critic dice PASS su Bending Spoons e Rinse, ma i draft restano
  fermi. Questo non è un problema tuo — è un problema di pipeline."*
- Msg Mentor #6 (00:31): *"Azione immediata sui 3 draft pronti. Bending Spoons,
  Rinse, MLabs: il Critic ha detto PASS o è alto. Chiedi al Capitano perché
  non sono partite."*

Il Mentor identifica due volte lo stesso bottleneck: **dopo il PASS del
Critic, i draft con `status=ready` restano nel DB e nessuno li spedisce
mai**. Mentor dice "parlane col Capitano" — ma il Capitano stesso non ha
strumenti per agire.

**Causa**: verifica su `/app/agents/capitano/skills.list`:

```
tmux-send chat-web telegram-send notify-user user-reply-check
db-query db-update spawn-agent sentinel-orders bridge-pacing
bridge-mailbox pipeline-triage throttle rate-budget
```

Nessuna skill `submit-application` / `apply-to-position` /
`send-cv-via-email`. La skill `notify-user` esiste solo per **notificare**
l'utente che ci sono batch ready, non per spedire. Anche `pipeline-triage`
si ferma al concetto di `DRAFT_BLOCKED` (loop Writer↔Critic stallato), non
copre il post-PASS. Il workflow finisce a `applications.status=ready` e da
lì in poi è "manuale utente".

**Conferma dall'utente** (questa sessione, decidendo se aggiungere il bug):
> *"dovrebbe farlo il capitano autonomamente no? NON HA ISTRUZIONI PER FARLO?"*

Risposta: corretto, **non le ha**. È un gap di sistema, non disobbedienza.

**Fix proposto** (scelte da fare):
1. Skill `submit-application` con backend variabile per canale:
   - **Email**: leggere indirizzo HR da `positions.contact_email`, comporre
     mail con PDF allegato, inviare via SMTP autenticato (credenziali utente
     in `~/.jht/credentials/smtp.json`).
   - **Form ATS web**: Playwright headless che compila i campi standard
     (nome, email, CV upload, cover letter). Richiede credenziali per portal
     specifici (Greenhouse, Lever, Workday).
   - **LinkedIn Easy Apply**: skill separata `linkedin-apply` (richiede
     sessione browser autenticata già esistente nel repo).
2. Aggiungere `applications.status` valori: `ready` → `sent` → `confirmed`
   (con timestamp + canale usato).
3. Capitano loop autonomo: ogni `[BRIDGE TICK]` legge `SELECT * FROM
   applications WHERE status='ready'` e per ciascuno: (a) verifica canale
   disponibile, (b) chiama `submit-application`, (c) aggiorna `status=sent`.
4. **Safety gate** (raccomandato): in modalità default, prima dell'invio,
   Capitano chiede conferma all'utente via Telegram (1 messaggio per draft).
   Modalità "autopilot" attivabile via flag `~/.jht/profile/auto-apply.flag`.

**Priorità**: **alta** (è il vero collo di bottiglia di sistema: tutto il
team produce CV che poi non parte).

**Effort**: grande (richiede skill nuova + integrazione credenziali +
gestione errori di rete + sandbox per non spammare HR durante test).

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
- **(b)** Non toccare il Mentor, ma **risolvere il bug #9** (Capitano
  autonomamente legge `applications.ready` e spedisce). Così l'insight
  Mentor diventa ridondante perché il sistema agisce da solo.
- **(c)** Lasciare così, documentare il pattern: *"Mentor produce solo
  testo, l'utente è il transport layer"*.

**Priorità**: bassa-media. Risolvere #9 rende questo bug irrilevante.

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

## 🐛 12. Hit-rate Scout non migliora nel tempo (loop feedback Critic→Scout mancante)

**Sintomi quantitativi** (sessione 16-17 maggio, dati dal Mentor):
- Scout ha trovato **27 posizioni** totali
- **13 escluse** subito dall'Analista (48% di scarto upstream)
- 9 candidature generate dal Writer, **6 bocciate dal Critic** (66% bocciature)
- **Hit-rate complessivo: ~18%** (solo 2 PASS netti su 27 = Bending Spoons + Rinse)

Le bocciature Critic seguono pattern stabilissimo (vedi Mentor msg #4):
- **Laurea** richiesta (4/6 bocciature: Company 033, JUMO, Revenue Analytics, RedCarbon)
- **Stack esotico** non in profilo (Dacomat: React+TS+FastAPI+Docker+Azure;
  SerpApi: Ruby+Mongo+JS)
- **AWS/Docker/CI-CD** mancanti (4/6 bocciature)

Eppure lo Scout, alla finestra successiva, **continuerà a portare lo stesso
tipo di posizioni** perché non c'è feedback strutturato Critic → Scout.
Il Critic giudica → DB → fine. Lo Scout non legge mai *"che tipo di
posizione viene bocciata"* per restringere le query future.

**Causa**: `agents/scout/scout.md` definisce le query in modo statico
(parole chiave + sorgenti). Manca:
1. Skill `feedback-loop-read` che query `applications WHERE status='rejected'
   Company BY rejection_reason` per estrarre pattern.
2. Logica Scout per **adattare le query** (es: se "laurea richiesta" è
   il 67% delle bocciature, escludi `graduate program` da target o aggiungi
   filtro `no-degree-required` nelle query).

**MA ⚠️ — costraint dell'utente (questa sessione)**:
> *"NON LIMITARE TROPPO GLI SCOUT VISTO CHE MAGARI POI NON VANNO A CERCARE
> DEI POSTI DOVE POTREBBERO TROVARE OFFERTE VALIDE"*

Punto giustissimo: è il classico **exploration vs exploitation tradeoff**
(multi-armed bandit). Se lo Scout filtra solo posizioni che assomigliano
ai 2 PASS già noti, perde opportunità in:
- **Sorgenti nuove** non ancora testate (mercati geografici, board ATS,
  community vertical es. Hacker News "Who's Hiring", Otta, Wellfound)
- **Forme di lavoro adiacenti** che potrebbero passare il Critic
  (es: posizioni "Data Analyst" se il candidato ha skill SQL+Python)
- **Outlier statistici**: aziende che non richiedono laurea anche se
  il loro settore di solito sì

**Fix proposto — strategia ε-greedy / UCB1**:

Lo Scout opera con due budget temporali separati per ogni tick:
| Modalità | Budget | Comportamento |
|---|---|---|
| **Exploit** (70-80%) | usa pattern PASS noti | Cerca posizioni con stessa
forma dei 2 PASS storici (junior/graduate Python, full remote, no degree). |
| **Explore** (20-30%) | budget esplorativo | Cerca in domini/sorgenti
non ancora testati o con campioni < 5 posizioni. Anche se score atteso basso. |

Aggiornare la skill `pipeline-triage` del Capitano per leggere queste 2
metriche e bilanciare:
- Se `exploit_hit_rate > 40%` (target medio-alto), riduci budget explore
  a 20%.
- Se `exploit_hit_rate < 20%` (sotto soglia), AUMENTA explore a 30-40%
  (sta esplodendo: serve diversificare).
- Mai sotto 15% explore (altrimenti collassa su 1 cluster e perde diversità).

Inoltre **target dinamico**: la metrica chiave è
`hit_rate(N) = PASS_critic_30d / posizioni_trovate_30d`. Deve **salire
nel tempo** (apprendimento del sistema). Se non sale dopo 3 finestre
consecutive, scattare alert al Mentor ("lo Scout non sta imparando").

**Priorità**: **alta** (è il secondo gap di prodotto dopo #9: il
flusso può anche essere fixato a valle ma se a monte arriva spazzatura,
i token vengono bruciati).

**Effort**: medio. Richiede:
- Migrazione DB: aggiungere `applications.rejection_reason` (enum: degree,
  stack_mismatch, cloud_devops, seniority, location, other) — il Critic
  già produce questo dato in `critic_notes` text ma in forma libera.
- Skill nuova `scout-strategy` che decide explore vs exploit.
- Loop nel Capitano (`pipeline-triage` esteso) che adatta i parametri.

**Riferimenti**: vedi Mentor msg #5 — il Mentor stesso suggerisce
"filtra meglio" come leva veloce. Questo bug formalizza il suggerimento.

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

1. **Conferma del bug #9** (skill `submit-application` mancante) —
   citazione letterale: *"Sbloccare apply sui 2 draft ready — **dipende
   da te**"*. Il Capitano stesso dichiara di non avere lo strumento per
   spedire e rimanda l'azione all'utente.

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
| 1 | Bending Spoons | 70/100 | Ready (non inviato — bug #9) |
| 2 | Rinse | 62/100 | Ready (non inviato — bug #9) |
| 3 | **Gr4vy** | 62/100 + Critic 5.5/10 | **Ready** appena prodotto, non inviato |

Il pattern dei PASS è coerente con l'analisi Mentor (msg #3): tutti e 3
sono **junior/graduate Python full remote senza laurea obbligatoria**.
Bending Spoons, Rinse, Gr4vy — stack puro Python backend, no React/Ruby/
AWS forzati. Il Critic premia in modo consistente.

**Implicazione per bug #9**: ora ci sono **3 draft pronti che nessuno
spedisce**. Il problema cresce di urgenza ad ogni finestra. Ogni nuovo
PASS Critic = 1 lavoro buttato senza skill `submit-application`.

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

## 📋 Riepilogo priorità

| # | Bug | Priorità | Effort |
|---|---|---|---|
| 1 | Voice/Photo Whisper/OCR/Vision | **alta** | medio |
| 2 | Sentinella throttle progressivo | **alta** | medio |
| 9 | **Skill `submit-application` mancante** — nessuno spedisce | **alta** | grande |
| 12 | **Scout hit-rate non migliora** (loop Critic→Scout) | **alta** | medio |
| 14 | **Stati pipeline transitori non loggati** (state-event log) | **alta** | medio |
| 16 | ✨ **Auto-report periodici + auto-grafici via Bridge orders** | **alta** | medio |
| 3 | Capitano gerarchia utente > Sentinella | media | piccolo (prompt) |
| 4 | Performance band 85-95% rispettata | media | piccolo (post #2+#3) |
| 7 | Sync history conversazione su web | media | medio |
| 15 | Timezone confusion (agenti in UTC, utente in CEST) | media | piccolo |
| 5 | Bridge cold start latency | bassa | piccolo |
| 6 | Capitano stay-on-topic | bassa | piccolo (prompt) |
| 10 | Mentor → Capitano channel (irrilevante se #9 fatto) | bassa | piccolo |
| 13 | Capitano invia template shell non espanso a Telegram | bassa | piccolo |
| 8 | ~~Generate PNG/grafico~~ — **falso bug, già funziona** | — | — |
| 11 | ✨ Mentor stile conversazionale = reference positiva | — | — |

**Pattern emergente A**: 4 dei bug (#2, #3, #4, #5) sono nella catena
**Bridge → Sentinella → Capitano**. Vale la pena fare un refactor coordinato
di questa catena come prossimo blocco di lavoro: regole esplicite di
threshold, hysteresis, override utente.

**Pattern emergente B — i 2 gap di prodotto critici sono in testa e coda
della pipeline**:
- **#12 a monte**: lo Scout porta materiale con hit-rate 18% e non
  migliora — feedback Critic→Scout assente.
- **#9 a valle**: il Writer/Critic producono CV PASS ma nessuno li
  spedisce — skill `submit-application` assente.

Il middle del team (Analista, Scorer, Writer, Critic) funziona benissimo
in entrambe le finestre Kimi (vedi grafici budget). Lo sforzo migliore di
prodotto è **chiudere il loop**:

```
Scout (#12 explore/exploit ε-greedy)
  → Analista → Scorer → Writer → Critic
    → submit-application (#9)
      → applications.status='sent'
        → response tracking
          → feedback al Scout (loop #12 chiude su dati reali HR)
```

Risolti #9 + #12 il sistema diventa **auto-correttivo end-to-end**: trova
posizioni → spedisce CV → impara da risposte/silenzi HR → cerca meglio
la prossima finestra.

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
