# 🎬 Regia — video campagna «Now Playable» (03/08)

Regia riscritta attorno al **nuovo concetto approvato dal committente**: non «il turno
di notte» (respinto: troppo astratto, e il team lavora anche mentre sei al lavoro o in
vacanza), ma **l'esperienza gamificata della ricerca del lavoro** — frontier AI al tuo
servizio, su misura e automatica, che setaccia il web aperto e non il catalogo di una
piattaforma. Il mestiere della regia precedente (riprese, determinismo, puntatore,
banner, voce) è riusato; il concetto no. Questo documento è la consegna: chi produce
esegue questo, non un mp4 diverso.

---

## 1. ✅ Verifica delle affermazioni pubblicitarie (fatta PRIMA di scrivere il copione)

Le due claim centrali sono state controllate sul prodotto reale, nel codice.

### 1a. «Setaccia tutto il web» — vera a metà: va detta bene

**Cosa fa realmente il prodotto** (fonti: `agents/_skills/circles-and-sources/SKILL.md`,
`agents/_skills/scout-web-access/SKILL.md`):

- Gli Scout lavorano su **4 tier di fonti**, drenati in ordine di priorità:
  1. **LinkedIn** — via endpoint guest pubblico (`linkedin_access.py`), senza login;
  2. **Aggregatori ATS** — board Greenhouse, board Lever, Indeed, Wellfound;
  3. **Board di nicchia scelte sul profilo** — RemoteOK, WeWorkRemotely, Stepstone,
     InfoJobs, board di stack (PyJobs, Djinni…), a seconda di work-mode e dominio;
  4. **Web search aperta + career page aziendali** — ultimo tier, quando i primi tre
     sono drenati.
- In più: **job alert via email** (poll IMAP, `email_monitor.py`) e una **cascata
  anti-bot a 3 livelli** (`web_scrape_robust.py`: requests → Playwright stealth →
  contesto persistente) che permette di leggere pagine che bloccano i crawler banali.

**Quindi:** il prodotto NON è chiuso nel catalogo di una piattaforma — arriva
davvero a board multiple, career page aziendali e ricerca web aperta. Ma la frase
del brief «TUTTO ciò che c'è sul web viene trovato!» **non è difendibile alla
lettera**, per tre ragioni: (a) il tier web-aperto è *last resort*, non una
scansione esaustiva; (b) alcune fonti bloccano anche la cascata anti-bot e vengono
blacklistate temporaneamente; (c) la ricerca è guidata dal profilo (cerchi
geografici), non è un crawl del web intero.

**Come si dice con onestà (formula approvata per il copione):**

> *"They don't browse one site's catalog. The big boards. The niche ones. Company
> career pages. The open web. Wherever jobs are posted — that's where they hunt."*

Descrive un **comportamento di caccia** (vero) senza promettere una **copertura
totale** (falsa). Il confronto coi concorrenti resta implicito («one site's
catalog») e non nomina nessuno. **Vietate in voce e in quadro**: "every job on the
web", "finds everything", "nothing escapes", "the entire web".

### 1b. «Frontier AI models» — vera: va solo spiegata senza gergo

**Cosa fa realmente il prodotto** (fonti: `docs/about/PROVIDERS.md`, README): ogni
agente è una sessione autonoma su una CLI ufficiale di un laboratorio di frontiera —
**Claude (Anthropic, Max), Codex (OpenAI, Plus/Pro), Kimi (Pro)** — con
l'abbonamento dell'utente, sulla macchina dell'utente. Nessun modello giocattolo,
nessun endpoint reverse-engineered. La claim «frontier AI al tuo servizio» è
**vera**. Due accortezze:

- niente nomi di modelli/provider in voce (gergo bandito): si dice *"frontier AI —
  the models behind today's top assistants"* — comprensibile a chiunque abbia usato
  un assistente AI, cioè il pubblico target;
- il tier più economico (Kimi, ~€40) è in beta: per questo la formula è «the models
  behind today's top assistants» e non «the strongest model on Earth».

### 1c. Bonus di onestà — «free»

JHT è **gratis e open source (MIT)**: vero e già linguaggio pubblico del README. Ma
gira su un **abbonamento AI dedicato** (~€40–200/mese) che l'utente porta da sé. Il
video dice "Free. Open source." **solo riferito al software appena nominato**, mai
"free AI"; il costo dell'abbonamento è gestito da landing e installer, come per ogni
altro materiale pubblico. Nessuna claim falsa, nessuna promessa di AI gratuita.

## 2. 🎯 L'idea in una frase

**La ricerca del lavoro ha appena cambiato genere: non un modulo da compilare, ma un
ufficio in cui entri — e la squadra che ci lavora è frontier AI, al tuo servizio.**

Cosa deve restare a chi guarda, venti secondi dopo la chiusura:
*«Quella cosa terribile che è cercare lavoro… lì dentro sembra un gioco. Ma sotto i
pixel c'è l'AI più seria in circolazione, che lavora sul MIO caso. E comando io.»*

Il «divertente» non si pronuncia mai: si **dimostra** — personaggi che camminano,
una stampante che sputa fogli, una chat a fumetti, uno swipe. La parola resta allo
spettatore.

## 3. 👥 A chi parla

A chiunque cerchi lavoro. Non a sviluppatori. La leva emotiva del nuovo concetto è
diversa dalla vecchia («dormi, ci pensiamo noi»): qui si parla alla **nausea da
piattaforma** — form infiniti, tabelle grigie, candidature fotocopia, zero risposte.

| Chi | Cosa gli pesa davvero | Cosa gli risolve il video |
|---|---|---|
| Il neolaureato | 50 candidature fotocopia, zero risposte | «Il CV viene riscritto **per quella** posizione, e revisionato finché non passa» |
| Chi è saturo dei job board | Aprire l'ennesima piattaforma è deprimente | «Qui la stessa attività è un ufficio vivo che si guarda volentieri» |
| Chi cambia settore | Non sa dove guardare, le piattaforme mostrano solo il loro catalogo | «Cacciano su board, career page e web aperto — non su un catalogo solo» |
| Chi non ha tempo | Cercare lavoro è un secondo lavoro | «La squadra lavora mentre tu sei al lavoro, in vacanza, a dormire» |

Tre paure da disinnescare **dentro** il video, non in una slide:
- *«Sembra un giochino, non mi trova lavoro davvero»* → la battuta-perno di Scena 3
  («Don't let the pixels fool you») + il lavoro concreto in quadro (verifica, 88, CV);
- *«L'AI manderà robaccia a nome mio»* → si vede la revisione e si vede che decide
  l'utente, con lo swipe: niente parte da solo;
- *«Dove finiscono i miei dati?»* → «runs on your own computer — your data never
  leaves home».

Gergo bandito dal copione. Parole tecniche ammesse: *AI*, *AI agents*, *frontier
AI* (sempre con l'apposizione che la spiega), *open source*.

## 4. 🧱 La struttura, e perché in quest'ordine

**Il video apre col gioco. Subito, al fotogramma 1.** Il centro del concetto è
l'esperienza gamificata: si mostra la cosa che nessun concorrente può mostrare, e la
si mostra per prima.

1. **Apertura (0:00–0:07) — la contraddizione.** Un ufficio in pixel, vivo: un
   personaggio si alza, va alla stampante, prende un foglio, si siede. Sembra un
   gestionale carino. La voce ribalta: *«This looks like a video game. It is. It's
   also your job search.»* La contraddizione è l'amo: nessuna piattaforma di lavoro
   è mai stata così, e lo spettatore lo capisce in tre secondi di sguardo.

2. **Il giocatore entra subito (0:07–0:17).** Il puntatore appare al secondo 7 — non
   a metà video come nella vecchia regia: se il prodotto è un gioco, lo spettatore
   deve **giocare** quasi subito. Clic su un agente → chat a fumetti → ordine
   impartito. Pilastro 1 (gamificazione) e controllo utente stabiliti insieme.

3. **«Non è un giocattolo» (0:17–0:26).** L'estetica pixel genera l'obiezione «è un
   giochino» esattamente qui, al secondo ~15: la si uccide nello stesso punto.
   Frontier AI, detta in modo comprensibile (pilastro 2).

4. **La sostanza: su misura (0:26–0:37).** Il lavoro vero, nato dal TUO profilo:
   verifica, punteggio 88 contro il profilo, CV riscritto per quella posizione,
   revisione dura (pilastro 3). Un'unica posizione come protagonista — mai catalogo
   di ruoli.

5. **Il terreno di caccia (0:37–0:48).** Stacco sul sito: il globo con le posizioni
   trovate. La claim competitiva (pilastro 4, formula onesta di §1a) arriva DOPO che
   la credibilità è costruita: una claim di superiorità detta per prima suona da
   venditore, detta qui suona da constatazione.

6. **Il climax: lo swipe (0:48–0:56).** Il gesto più «gioco» di tutto il prodotto è
   anche il momento del potere dell'utente: divertimento e controllo si fondono in
   un'unica scena. Per questo chiude la demo, non la apre.

7. **Fiducia + sempre-acceso (0:56–1:08).** Dove gira, di chi sono i dati; e il
   vecchio concetto «night shift» **retrocesso a un beat**, nella forma che il
   committente stesso ha indicato: *at work, on holiday, asleep — your team keeps
   hunting*. Un fatto di supporto, non più la tesi.

8. **Firma (1:08–1:15).** Wordmark, URL, «Free · Open source · Beta», claim di
   chiusura che salda il concetto: *now playable*.

Fili conduttori, da rispettare al montaggio:
1. **Il puntatore** — entra a 0:07 e da lì **clicca in ogni scena**. Lo spettatore
   è il giocatore per il 90% del video, non solo nel finale.
2. **Il numero 88** — nasce in bocca allo Scorer nel gioco (0:29), torna sull'anello
   della scheda web (0:42), torna sulla prima card dello swipe (0:49). Una
   posizione, un numero, tre superfici: gioco e sito sono lo stesso prodotto.
3. **La contraddizione pixel/serietà** — aperta dalla battuta 1 («It is. It's also
   your job search»), chiusa dalla battuta 3 («Don't let the pixels fool you»).
   È il tono dell'intero video: leggero fuori, serissimo dentro.

## 5. 🎞️ Scaletta secondo per secondo

Formato master: **1920×1080, 30 fps, inglese**. Otto scene, ~75 s, voce ~88% della
durata. Banner «SIMULATION — not real data» (gioco) e «DEMO MODE» (web) **sempre in
quadro** nelle rispettive scene.

| # | Tempo | Scena | Fonte | Voce |
|---|---|---|---|---|
| 1 | 0:00–0:07 | L'ufficio vivo: cammina, stampa, si siede | Gioco (giorno) | V1 |
| 2 | 0:07–0:17 | Clic sull'agente → chat → ordine | Gioco + puntatore | V2 |
| 3 | 0:17–0:26 | «Non farti ingannare dai pixel» | Gioco (lavoro in quadro) | V3 |
| 4 | 0:26–0:37 | Su misura: profilo → 88 → CV → revisione | Gioco (3 stacchi) | V4 |
| 5 | 0:37–0:48 | Il globo → la scheda GreenGrid | Web demo + puntatore | V5 |
| 6 | 0:48–0:56 | Lo swipe: decidi tu | Web demo + puntatore | V6 |
| 7 | 0:56–1:08 | Casa tua + l'ufficio non chiude | Illustrazione `the-box` + gioco (notte) | V7 |
| 8 | 1:08–1:15 | Firma + CTA | Card grafica | V8 |

### Scena 1 — «It is. It's also your job search.» (0:00–0:07, 7 s)

**SI VEDE.** Ufficio del gioco in **pieno giorno** (`JHT_HOUR=10`): luce dalle
vetrate, reparti vivi. Inquadratura STRETTA (zoom ≥ 1.9) sul reparto Research: lo
Scout **si alza dalla scrivania, cammina alla stampante** (lampo di `PrinterFx`),
**prende il foglio** (passo `carry`), **torna e si siede**. Camera in leggera
carrellata laterale che lo segue, a mezza figura. Nessuna vignetta: solo movimento
e vita. Primo fotogramma = scena già carica (mai «CARICAMENTO…»). Banner
«SIMULATION — not real data» in alto; HUD «JHT TEAM» spento per il ciak.

**SI SENTE.** V1 (attacca a 0,5 s):
> "This looks like a video game. It is. It's also your job search."

### Scena 2 — Clicchi, ti risponde, comandi (0:07–0:17, 10 s)

**SI VEDE.** **Entra il puntatore bianco** — secondo 7, prima apparizione — scivola
sullo Scout appena seduto, l'agente si **illumina** (highlight di hover), **CLIC**
con onda di clic visibile: si apre la **pagina chat a fumetti** («CHAT — HOLMES ·
SCOUT-1», ritratto grande a destra). La conversazione si scrive da sola, vignetta
per vignetta:
1. Agente: **"Sweep done: 6 new roles — 4 remote (EU)."**
2. Il puntatore clicca la risposta suggerita, parte la bolla verde:
   **"Show me the best one first."** → clic su **SEND**.
3. Indicatore «sta scrivendo…», poi: **"On it — pulling the file now."**

**SI SENTE.** V2:
> "This is Job Hunter Team — an office full of AI agents hunting jobs for you.
> And you're the boss: click anyone, ask anything, give orders."

### Scena 3 — Sotto i pixel (0:17–0:26, 9 s)

**SI VEDE.** Chiusura del pannello chat SUL clic; due inquadrature strette di
lavoro vero, tagliate sul gesto: (a) l'Analista che **preleva un foglio dalla
vaschetta** (`pile_take`), si siede, lo studia — vignetta: **"Posting verified:
real company, salary confirmed."**; (b) reparto Applications, la **macchina da
scrivere** che batte, fogli impilati — nessuna seconda vignetta, il ticchettio è
l'immagine. I corpi «pulsano» col lavoro (`react_to_work`).

**SI SENTE.** V3:
> "Don't let the pixels fool you. These characters run on frontier AI — the models
> behind today's top assistants — working one case: yours."

### Scena 4 — Su misura: l'88 nasce qui (0:26–0:37, 11 s)

**SI VEDE.** Tre stacchi stretti, cut on action, una vignetta per stacco:
- *Stacco A (0:26–0:30).* Reparto Compatibility, lo Scorer al desk, monitor accesi.
  Vignetta: **"Match with your profile: 88/100."** (l'88 nasce qui).
- *Stacco B (0:30–0:33).* Lo Scrittore alla macchina da scrivere, primo piano del
  foglio. Vignetta: **"CV rewritten for this exact posting."**
- *Stacco C (0:33–0:37).* Il Critico **ritira il CV dalla vaschetta**, lo scorre,
  **porta la cartellina allo scaffale degli output** e la deposita. Vignetta:
  **"Review, round two: pass."**

**SI SENTE.** V4:
> "They learn your profile and score every role against it — this one's an
> eighty-eight. Your CV gets rewritten for that exact posting… and reviewed, hard,
> until it passes."

### Scena 5 — Il terreno di caccia (0:37–0:48, 11 s)

**SI VEDE.** Browser, sito in **demo mode** (banner «DEMO MODE — sample data»
sempre in quadro). Pagina `/map`, tema scuro: il **globo** ruota lento mezza volta
(velocità naturale), pin su tre continenti, si assesta sull'Europa coi fasci
colorati per punteggio. Il puntatore clicca il **pin di Amsterdam** (fallback: la
riga GreenGrid nel pannello POSITIONS) → scheda **"Platform Engineer, Kubernetes —
GreenGrid"**: anello punteggio **88**, badge «€ 80k–105k» e «Remote». Il puntatore
scorre le card del *perché* (pro / contro / note), si ferma sul verdetto «PASS»,
poi clicca **Download CV** — stacco netto SUL clic.

**SI SENTE.** V5:
> "And they don't browse one site's catalog. The big boards. The niche ones.
> Company career pages. The open web. Wherever jobs are posted — that's where
> they hunt."

### Scena 6 — Lo swipe: decidi tu (0:48–0:56, 8 s)

**SI VEDE.** Pagina `/swipe`. La card GreenGrid **88** in primo piano: il puntatore
**trascina la card a destra** (o clicca la stella), la card vola via; entra la
successiva, punteggio basso: clic sulla **X**; entra la terza. Tre verdetti in otto
secondi, ogni clic con la sua onda. È la scena più fisica del video: le card devono
volare come in un gioco di carte.

**SI SENTE.** V6:
> "Then the best part: you call it. Swipe — yes… no… next. The last word is
> always yours."

### Scena 7 — Casa tua, e l'ufficio non chiude (0:56–1:08, 12 s)

**SI VEDE.** Due beat:
- *(0:56–1:02)* Illustrazione **`the-box`**: l'ufficio racchiuso in un
  parallelepipedo dai bordi luminosi, osservato da due figure. Lenta spinta in
  avanti (Ken Burns 1.0 → 1.08), nessun testo sovraimpresso.
- *(1:02–1:08)* Stacco sul gioco in **modalità notte** (`JHT_HOUR=2`): inquadratura
  STRETTA su una sola scrivania, pozza di lampada, un agente che batte. L'eco del
  vecchio concetto, ridotto a quattro secondi di prova visiva.

**SI SENTE.** V7:
> "All of it runs on your own computer — your data never leaves home. And the
> office never closes: at work, on holiday, asleep — your team keeps hunting."

### Scena 8 — Firma (1:08–1:15, 7 s)

**SI VEDE.** Card di chiusura su fondo scuro: wordmark **JOB HUNTER TEAM**
(JetBrains Mono), sotto **jobhunterteam.ai**, sotto piccola la riga «Free · Open
source · Beta». Dietro, quasi nero, l'ultimo respiro dell'ufficio notturno (la
lampada): il cerchio si chiude. La URL resta a schermo almeno 3 s pieni.

**SI SENTE.** V8:
> "Job Hunter Team. Free. Open source. Your job hunt — now playable."

## 6. 🎙️ Copione completo della voce (pronto da leggere)

Un solo narratore, ElevenLabs di qualità. Tono: **brillante, complice, con un
sorriso** — trailer di un gioco raccontato da un amico, non depliant né noir. Ritmo
~150–160 parole/min, pause brevi sui trattini, MAI accelerata in post. I numeri per
esteso («eighty-eight»).

> This looks like a video game. It is. It's also your job search.
>
> This is Job Hunter Team — an office full of AI agents hunting jobs for you. And
> you're the boss: click anyone, ask anything, give orders.
>
> Don't let the pixels fool you. These characters run on frontier AI — the models
> behind today's top assistants — working one case: yours.
>
> They learn your profile and score every role against it — this one's an
> eighty-eight. Your CV gets rewritten for that exact posting… and reviewed, hard,
> until it passes.
>
> And they don't browse one site's catalog. The big boards. The niche ones.
> Company career pages. The open web. Wherever jobs are posted — that's where
> they hunt.
>
> Then the best part: you call it. Swipe — yes… no… next. The last word is always
> yours.
>
> All of it runs on your own computer — your data never leaves home. And the
> office never closes: at work, on holiday, asleep — your team keeps hunting.
>
> Job Hunter Team. Free. Open source. Your job hunt — now playable.

~172 parole ≈ 64–67 s di parlato su ~75 s di video: **~88% di copertura voce**.
Il montaggio va costruito **sulle durate reali dell'audio** (meccanismo
`durations.txt` già collaudato): è la voce a dettare i tagli, non il contrario.

## 7. 🚫 Cosa NON fare (divieti ereditati + nuovi, con le ragioni)

1. **Niente rassegna dei ruoli.** La voce non pronuncia MAI «Scout», «Analyst»,
   «Scorer», «Writer», «Critic» né frasi «X does Y»: è un catalogo e annoia. I
   ruoli vivono solo nelle targhe di scena e nell'intestazione della chat.
2. **Niente numeri aggregati.** Vietati «658 positions», contatori, KPI, punteggi
   medi: non interessano a nessuno. Numeri ammessi: **88/100** (filo conduttore),
   lo stipendio sulla card, «6 new roles» nella vignetta diegetica. HUD di squadra
   spento nei ciak.
3. **Niente gergo.** Vietati: LLM, pipeline, container, provider, nomi di modelli
   o aziende AI, tokens, Docker, subscription. Ammessi: *AI*, *AI agents*,
   *frontier AI* (SOLO con l'apposizione «the models behind today's top
   assistants»), *open source*.
4. **Niente over-claim sulla copertura.** Vietate in voce e in quadro: "every job
   on the web", "finds everything", "nothing escapes", "the entire web", "10× more
   than…". La formula approvata è quella di §1a e non si «migliora» in post: una
   promessa falsa si ritorce contro al primo utente che se ne accorge.
5. **Niente «divertente» detto a parole.** "Fun", "enjoyable", "playful" NON
   compaiono nel copione: se il video non lo dimostra con le immagini, dirlo non lo
   salva. L'unico aggettivo di genere è nel claim finale («now playable»), che è
   una constatazione, non un'auto-lode.
6. **Niente video accelerato.** Ogni clip a velocità nativa; il tempo si guadagna
   tagliando sul gesto, mai col time-lapse. Se una camminata non sta nella scena,
   se ne mostrano gli ultimi secondi.
7. **Niente vuoti di voce.** Gap massimo tra due battute: 1,5 s. Se una scena
   chiede più silenzio, si accorcia la scena.
8. **Niente campi larghi illeggibili.** Inquadrature strette; campo largo solo come
   appoggio (max 2,5 s) e mai con vignette in quadro. Vignette leggibili a 720p ⇒
   zoom ≥ 1.9.
9. **Niente attori né riprese dal vero.** L'utente nel video è **il puntatore**:
   disegnato in post sul web, sincronizzato sui frame noti nel gioco.
10. **Niente italiano in quadro.** Targhe di stato spente, insegne doppiate in
    inglese (meccanismi `_silence_state_tags` / `_dress_set_english` della
    produzione precedente).
11. **Niente finzione spacciata per dato reale.** Banner «DEMO MODE» (web) e
    «SIMULATION — not real data» (gioco) **restano in quadro**: non negoziabile.
    Nessun dato personale vero, nessuna azienda di candidature reali.
12. **Niente «night shift» come tesi.** Il lavoro in sottofondo è UN beat (Scena 7,
    ~6 s), nella forma «at work, on holiday, asleep»: mai più l'apertura, mai più
    il concetto centrale — è la ragione per cui la versione precedente è stata
    respinta.
13. **Niente «free» ambiguo.** "Free. Open source." si dice SOLO subito dopo il
    nome del prodotto; mai accostato all'AI. Il costo dell'abbonamento AI è
    materia di landing e installer, non del video — ma il video non deve
    contraddirlo.
14. **Niente musica senza licenza.** Il master deve reggere **solo voce**. Detto
    questo: per QUESTO concetto (gioco, leggerezza) un letto musicale aiuterebbe
    più che nel taglio noir — consigliata una traccia **con licenza** (stock a
    pagamento o commissionata): pulsazione leggera, percussiva, senza melodia
    sotto la voce, che si apre di un tono sullo swipe (Scena 6) e sparisce sotto
    la firma. Finché non c'è la licenza, si esce solo voce.

## 8. ⏱️ Durata consigliata: ~75 secondi (tolleranza 70–78)

**Perché.** La durata la detta il copione: ~172 parole a ritmo naturale fanno
~65 s di voce; con attacco e coda respirati si atterra a ~75 s. Sotto i 60 s si
dovrebbe scegliere tra amputare un pilastro (e il committente li ha chiesti tutti
e quattro) o accelerare la voce (vietato). Sul canale primario (YouTube, Reddit,
sito, GitHub) 70–78 s regge pienamente **se la voce non molla mai** — vincolo che
questa regia impone.

**Declinazioni di campagna** (stessa produzione, nessuna ripresa nuova):
- **Cut 30 s** (pre-roll/social): Scena 1 (7 s) + Scena 2 accorciata (clic + prima
  bolla, 6 s) + Stacco A di Scena 4 (l'88, 4 s) + Scena 6 (8 s) + Scena 8 (5 s).
  Voce: V1, V2 ridotta («An office full of AI agents hunting jobs for you — and
  you're the boss.»), la frase dell'88, V6, V8.
- **Cut 15 s** (bumper): ufficio vivo (3 s) → swipe (5 s) → firma (7 s). Voce:
  "This looks like a video game. It's your job search. — The last word is always
  yours. — Job Hunter Team. Free, open source — now playable."
- **Verticale 9:16**: scrivanie «in colonna» già collaudate nella produzione
  precedente; web in viewport mobile (390×693 @2x). Il puntatore diventa un
  **tocco** (cerchio di tap), stessa coreografia.

## 9. 🔧 Note di produzione (mestiere riusato dalla regia precedente)

- **Gioco — riprese.** Movie Maker mode (`--write-movie out.png --fixed-fps 30`),
  scena ufficio in showroom (`JHT_NOVPS=1`), giorno/notte con `JHT_HOUR=10` /
  `JHT_HOUR=2` (`game/scripts/office/day_night.gd`). I viaggi fisici esistono già
  (`perform_pipeline_step` in `game/scripts/office/office.gd`: stampante per lo
  Scout, `pile_take`/`pile_drop` tra reparti, scaffale output per il Critico) e
  vanno forzati con pause fisse per ciak ripetibili. La regia programmata, le
  insegne inglesi e lo spegnimento targhe (`promo_director.gd`,
  `promo_dept_signs.gd`) sono nella produzione precedente, oggi in worktree
  (`.claude/worktrees/agent-a4b97a308448a8d12/game/tools/`): **recuperarli da lì**,
  aggiungendo i clip `open-day`, `click-chat`, `tailor-88`, `dusk-night` e lo
  spegnimento del HUD «JHT TEAM» (pattern `queue_free`).
- **Gioco — il clic sull'agente.** Pannello chat aperto programmaticamente al frame
  prestabilito; **puntatore disegnato in post**, sincronizzato su quel frame, con
  onda di clic; stesso file di coordinate per l'highlight di hover.
- **Web — riprese.** Playwright headed in demo mode, persona **software**, tema
  scuro, locale `en`, 1280×720 (pattern `record_web.py` della produzione
  precedente, stesso worktree). Puntatore composto in post sulle coordinate note
  (o cursore DOM iniettato: UNA tecnica per tutte le scene web). Banner demo
  sempre in quadro (`web/app/components/demo/DemoBanner.tsx`).
- **Continuità GreenGrid.** La posizione esiste nel seed demo
  (`web/lib/demo/seeds/software.ts`: "Platform Engineer, Kubernetes", GreenGrid,
  Amsterdam, full remote, €80k–105k, score 88, CV ready, PASS). Scena 5: se il pin
  non porta alla scheda, clic sulla riga GreenGrid nel pannello POSITIONS. Scena 6:
  se l'ordine del mazzo non è pilotabile, filtro categoria per far uscire la card
  88 per prima.
- **Download CV in demo.** Si stacca SUL clic, senza toast né file scaricato (in
  demo la scrittura è no-op: non fingere un download avvenuto).
- **Voce.** ElevenLabs, narratore unico (timbro chiaro, medio, en-US o en-GB
  coerente), copione di §6 senza modifiche. Battute separate (V1…V8), montaggio
  sulle durate reali (`durations.txt` + riflow). Vietato il time-stretch.
- **Montaggio.** Stacchi netti; una sola dissolvenza ammessa (Scena 7 → 8).
  Didascalie sovraimpresse: SOLO la card finale — tutto il resto del testo in
  quadro è diegetico (vignette, chat, schede).
- **Verifica finale.** Fotogrammi di controllo a 1 fps su entrambi i formati:
  vignette complete, banner mai coperti, nessuna scritta italiana, puntatore
  visibile in ogni clic, gap voce ≤ 1,5 s (silencedetect), nessuna frase vietata
  da §7.4 in quadro.

---

*Regia consegnata il 03/08. Il prodotto di questo documento è il documento:
nessun video è stato montato, nessuno script di produzione è stato toccato.*
