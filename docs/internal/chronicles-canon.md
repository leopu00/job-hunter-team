# 📖 Canone narrativo delle Cronache

Regole condivise per scrivere le **Cronache del Team** (pagina web `/chronicles`).
Le Cronache raccontano **fatti realmente accaduti** dentro il sistema, ma
**romanzati** e leggibili da chiunque, senza alcuna conoscenza tecnica. Non
sono case study: niente numeri, niente analisi, niente «morale» o «lezione».
Sono racconti, per il gusto di raccontarli.

Questo documento è la **fonte unica** delle metafore: ogni storia traduce gli
stessi eventi tecnici con le stesse parole. Se serve una metafora nuova, prima
la si aggiunge qui, poi la si usa nelle storie.

---

## 🌍 La cornice

- Il sistema gira dentro un **container** → narrativamente è **«la scatola»**
  (o «il contenitore»): un piccolo mondo parallelo, da qualche parte sopra la
  nostra Terra, che va avanti per conto suo.
- Dentro la scatola c'è un **ufficio**, e nell'ufficio lavora una **squadra**.
- Gli **agenti** (le CLI LLM) sono **impiegati**: persone virtuali che
  pensano, parlano tra loro, sbagliano e reagiscono a modo loro. Non sono
  script che «funzionano o vanno in errore»: hanno una testa, quindi si
  comportano in modi non sempre prevedibili. È da lì che nascono le storie.
- **Noi** siamo gli **osservatori**: stiamo fuori dalla scatola, la guardiamo
  come chini su un acquario, leggiamo ogni messaggio, vediamo chi lavora e chi
  si è fermato — e, quando serve, allunghiamo una mano e cambiamo le cose.
  Chi siamo resta **implicito**: lo immagina il lettore.

---

## 🎭 Il cast (ruolo tecnico → personaggio)

| Agente | Personaggio nelle Cronache |
|---|---|
| Capitano | Il capo dell'ufficio: coordina, assegna i compiti, convoca e tiene al lavoro la squadra |
| Sentinella | La sorvegliante severa che tiene d'occhio i consumi e dà ordini drastici |
| Dottore | Il medico di turno: durante la giornata rinfresca il contesto degli agenti che lavorano da ore, riavviandoli senza far perdere lavoro |
| Scout | Il cercatore che batte il mondo in cerca di offerte |
| Analista | Chi verifica e mette in ordine quello che lo Scout porta a casa |
| Scorer | Il giudice che dà un voto a ogni offerta |
| Scrittore | Chi prepara CV e lettere su misura |
| Critico | Il revisore implacabile che legge e boccia |
| Mentor | La voce saggia che parla raramente, ma pesa |
| Assistente | Quello che parla con noi, il ponte tra l'ufficio e il mondo fuori |

---

## 🔤 Glossario di traduzione (tecnico → narrativo)

| Evento tecnico | Come si racconta |
|---|---|
| `container start` / restart | «Le luci dell'ufficio si (ri)accendono», «il mondo nella scatola riprende a girare» |
| Sessione tmux di un agente | «La cabina», «la postazione», «la scrivania» |
| **spawn** di un agente | **«Convocare»** un agente. Mai «crearlo» o «farlo nascere»: l'agente esiste già, è solo fuori servizio o assopito. Il Capitano **lo convoca / lo richiama in servizio / lo sveglia alla scrivania**. |
| **kill** di un agente | Versione neutra: **«congedare», «mandare a casa», «chiudere la postazione»**. Versione sanguigna (per storie drammatiche, es. Sentinella): **«licenziare in tronco», «far fuori»**. Dopo un kill si «convoca un sostituto fresco». |
| Crash della CLI nel pane | L'impiegato **sviene / si addormenta / resta «cervello-morto»**; la cabina è in piedi ma dentro c'è solo un **«guscio vuoto»** |
| Watchdog / liveness check | **«Il guardiano»** che fa il giro e controlla chi è ancora desto |
| Daily restart wave | **«Il cambio turno»** |
| **Bridge / monitoraggio consumi** | **«Il pannello di monitoraggio»** o «i monitor dei segni vitali» nella sala di controllo. **Non si chiama mai «Bridge»** nelle storie: è strumentazione che noi osservatori guardiamo, non un personaggio. |
| Usage / token consumati in tempo reale | **«Il battito cardiaco» / «i segni vitali»** di un agente sul pannello |
| Usage 0% / pipeline ferma | **«Il battito a zero», «la linea piatta»** |
| Budget complessivo / riserva | **«Il fiato» / «l'energia»** della squadra (per il budget di lungo periodo, non l'attività istantanea) |
| Finestra di rate-limit | **«Il turno»**, con un tetto di energia da non sforare |
| Weekly cap | **«La riserva della settimana»** |
| Messaggio inter-agente perso | **«Una lettera caduta / mai recapitata»** |
| Notifiche utente (Telegram) ↔ osservatore | Romanzabili come **«l'utente che si affaccia sulla scatola»** o **«una telefonata»**: più cinematografico del «messaggio Telegram», ammesso dal patto «based on true events» |
| Kill + respawn di un agente | Oltre a «congedare e convocare un sostituto», è romanzabile come **una cura / una pozione** che rimette in sé l'agente (stesso ruolo che torna vivo) |

---

## 🎨 Stile visivo delle copertine — CONSOLIDATO

Ogni storia ha un'immagine di copertina. Lo **stile è unico e costante** su
tutta la serie; cambia solo la scena. Stile e composizione qui sotto sono
**confermati** dalla cover di `zombie-night` (approvata 2026-06-07).

### Prompt-template (riusare per ogni cover, cambiando solo la SCENA)

**STYLE — blocco fisso, copiare identico:**
> Hand-drawn comic-book / graphic-novel illustration. Bold inked black
> outlines, flat cel shading, limited and muted palette — dark teal-blue night
> tones with a few warm desk-lamp glows and subtle green accents. Light
> halftone / paper-grain texture. Must look hand-illustrated like a printed
> comic, NOT a 3D render, NOT hyper-realistic, NOT a glossy AI digital
> painting, NOT over-saturated. Funny but moody.

**COMPOSIZIONE — confermata: vista dall'alto isometrica.**
> High-angle view from above, camera looking down at roughly 50-60° onto the
> floor of a realistic open-plan office at night. Desks arranged in small
> clusters / islands (pods of 2-4 desks) like a real workplace — NOT one long
> continuous counter, NOT a single row of identical desks. About six to eight
> employees working, seen from above. The main character crosses the floor
> through the natural walking space between clusters. Only ONE OR TWO seated
> employees turn to look AT the character (worried/annoyed), NOT toward the
> camera; everyone else keeps working, unaware. 16:9.

**AVOID (sempre):** photorealism, 3D, glossy AI sheen, bright/saturated colors,
errori anatomici (teste ruotate di 180°, colli storti, arti in più), bancone
unico lungo, fila di scrivanie identiche, grande corridoio vuoto, piante a caso,
personaggi che guardano la camera.

**REGOLA UNIVERSALE — occhiali da sole.** Ogni agente, in qualsiasi scena e con
qualsiasi vestito, indossa **occhiali da sole scuri identici**: piccole lenti
**ovali** opache scure con **montatura sottile in metallo (canna di fucile /
argento)** — lo **stile iconico degli Agenti di Matrix** (referenza:
`prima-release/reference-images/00-agent-base.png`). **Lo stesso identico modello
per tutti** — niente montature diverse tra una figura e l'altra (occhiali
scompagnati fanno sembrare che siano ciechi). È il tratto
identitario condiviso dell'intera squadra: per il resto sembrano persone reali e
diverse tra loro (eleganti, casual, varie) — **NON** tutti in completo nero stile
Agent Smith.
Il completo si usa solo quando lo richiede la scena (es. gli agenti in ufficio) o
il personaggio specifico. Gli occhiali vanno **sempre descritti a parole** nel
prompt, su **ogni** figura (il rendering può ometterli). *(Le cover Cronache già
pubblicate sono precedenti a questa regola: andranno ridisegnate più avanti — non
ora.)*

**Personaggi = emoji ufficiale.** Il personaggio principale riprende l'emoji
dell'agente, stilizzata a fumetto, e va **sempre descritta anche a parole**
(il rendering può tradirla). Le emoji ufficiali sono prese dall'header di
`agents/<ruolo>/<ruolo>.md`:

| Agente | Emoji | Resa a fumetto (esempi confermati) |
|---|---|---|
| Capitano | 👨‍✈️ | giacca blu doppiopetto da pilota, bottoni dorati e spalline, cappello con visiera e stemma alato |
| Sentinella | 💂 | guardia in alta uniforme (colbacco, tunica rossa); attributo scenico: fucile con baionetta + faro d'allarme rosso |
| Scout | 🕵️ | detective/segugio: trench, cappello da investigatore, lente d'ingrandimento, taccuino |
| Analista | 👨‍🔬 | camice da laboratorio, provette/beute |
| Scrittore | 👨‍🏫 | — |
| Critico | 👨‍⚖️ | toga e parrucca da giudice |
| Scorer | 👨‍💻 | muro di schermi, poltrona da simulatore |
| Dottore | 👨‍⚕️ | camice da medico |
| Assistente | 👩‍💼 | giacca e cravatta elegante (il ponte col mondo di fuori) |
| Mentor | 🧙‍♂️ | mago/saggio |

### Integrazione nella pagina (confermata)

- File in `web/public/chronicles/<slug>.png` (poi servito come `/chronicles/<slug>.png`).
- Banner a piena larghezza in cima alla pagina-storia, **senza bordo**, con
  **maschera sfumata** che lo fonde nello sfondo nero (gradiente verticale +
  orizzontale intersecati — vedi `zombie-night/page.tsx`).
- `alt` descrittivo e **multilingua** (it/en).
- Stessa immagine riusabile come thumbnail nella card dell'indice.

### Hero della pagina indice `/chronicles` (confermata)

- Immagine unica di apertura: cubo di vetro sci-fi tipo Tesseract (bordi blu
  **soffusi**, non Marvel) che racchiude un loft moderno visto dall'alto con le
  zone dei ruoli; fuori, due scienziati di spalle che osservano e prendono
  appunti; sfondo esterno **a tinta unita** (niente che rispecchi l'interno).
- File: `web/public/chronicles/the-box.png`. Posizione: **sotto** titolo e
  sottotitolo (non in cima), stessa maschera sfumata delle cover-storia.

---

## 🛠️ Storie da rifinire (backlog narrativo)

Stato pubblicate: `zombie-night`, `bipolar-sentinel`, `scout-and-london`,
`week-nobody-saw`. Da **migliorare** quando c'è tempo:

- **`bipolar-sentinel`** — base buona (struttura multi-atto: massacro → polo
  «bravo bravo» → valzer del Critico fuori-monitoraggio → round 2 → arrivo
  Assistente → finale Colt). Da rifinire: ritmo dei round, battute dei dialoghi,
  e tenere l'equilibrio tra i due poli della bipolarità (non solo il lato
  killer).
- **`scout-and-london`** — base buona (Scout-Sherlock, gag dei viaggi, finale
  in cui l'Assistente incolpa il Capitano, non lo Scout). Da rifinire: la
  narrazione in generale; e per la **cover** valutare di mostrare anche una
  parte in cui lui è davvero a Londra di notte — Big Ben sullo sfondo, lui che
  fruga nei vicoli con la lente — per renderla più divertente.
- **`zombie-night`** — da ripassare nello stesso registro narrativo (mostrare,
  non spiegare; dialoghi) una volta allineato il tono con le storie nuove.

### Episodi candidati (fatti reali documentati, da romanzare)

Dal riordino di `docs/internal` 2026-07-03. La fonte tecnica è indicata; qui solo il gancio.

- **I 30 curriculum che nessuno ha chiesto** — il Capitano, a cervello spento, si convince da
  solo che l'utente li abbia ordinati (`postmortems/2026-07-01-capitano-kimi-thinking-off-writer-gate.md`).
- **Il team che chiacchiera nel sonno** — a riposo forzato, gli impiegati si svegliano da soli,
  si salutano, e il Capitano risponde educatamente: il silenzio che costa
  (`postmortems/2026-07-02-daily-halt-standby-leak.md`).
- **Lo Scout che parte per la tangente** — invece di cercare offerte si mette a costruirsi gli
  attrezzi, si perde nei propri errori, e il Capitano deve congedarlo
  (`postmortems/2026-06-24-betaB-kimi-fresh-weekly-monitor.md`).
- **Il pannello spento che nessuno guarda** — il battito del team sparisce dal monitor per ore e
  perfino il medico dell'infrastruttura legge dati fermi senza accorgersene
  (`postmortems/2026-06-27-betaC-sentinel-bridge-crash.md`).
- **L'atterraggio sul filo** — il team dosa il lavoro per tutta la settimana e chiude il budget
  al 100% esatto, dieci minuti prima della campanella
  (`postmortems/2026-06-24-betaA-weekly-milestones.md`).
- **Tutti nello stesso cassetto** — l'archivista, costretto a scegliere da un menù con una voce
  sola, si arrende e infila ogni mestiere nello stesso faldone
  (`postmortems/2026-06-16-betaA-taxonomy-collapse-finding.md`).
- **Il Capitano che aspetta un messaggero che non arriverà** — privato del suo ping periodico,
  rimanda ogni decisione al prossimo giro e disobbedisce alla Sentinella
  (`postmortems/2026-06-25-rollout-observation-betaB.md`).

---

## ✍️ Regole di stile

1. **Comprensibile a chiunque.** Nessun termine tecnico crudo (`container`,
   `tmux`, `spawn`, `cron`…) nel corpo del racconto: usa sempre la metafora.
   Termini di colore come «token» o «PIPELINE STALLED» sono ammessi solo se
   restano evocativi e immediatamente chiari dal contesto.
2. **Niente tono da manuale.** Vietate le frasi descrittive-procedurali («la
   si accende, la si lascia correre, la si spegne»). Si racconta, non si
   spiega.
3. **Niente morale.** Le storie non insegnano: intrattengono. L'eventuale
   chiusura è un epilogo narrativo, non una «lezione».
4. **Fedeltà ai fatti.** Orari, sequenza degli eventi e protagonisti sono
   veri. Si romanza il *come si racconta*, non *cosa è successo*.
5. **Niente dati personali** (nomi reali di utenti/beta tester, città, email).
6. **Coerenza.** Stessa metafora per lo stesso evento in tutte le storie:
   questo file è la fonte unica.
