# `[PROMO-VIDEO-NOW-PLAYABLE]` — finire il video di campagna

**Stato: SOSPESO a lavoro quasi finito.** Regia approvata, girato completo, script
corretti, un montaggio orizzontale già uscito. Manca la rifinitura e il verticale.

Sospeso il 03/08 su decisione dell'utente: la produzione era entrata in un ciclo
improduttivo (un agente rigirava le scene mentre un altro montava, quindi ogni
montaggio leggeva materiale a metà). Si riprende a mente fresca, da qui.

---

## 1. Dove sta tutto — LEGGERE PRIMA DI QUALSIASI COSA

Il materiale girato **non è nel repository** (10 GB di PNG, esclusi da git) ed **è
stato spostato fuori dalle worktree**, che vengono ripulite senza preavviso — è già
successo due volte in questa produzione, costando ore di riprese.

```
~/Repos/job-hunter-team/regia/promo-2026-08-now-playable/
├── scenes/capture/        ← 3.760 fotogrammi PNG, il girato del gioco
├── webrec/                ← 9 riprese del sito (.webm), demo mode
├── audio/play/            ← la voce ElevenLabs + durations.txt
├── *.py                   ← copia degli script al momento della sospensione
└── jht-play.mp4           ← il montaggio orizzontale già uscito (75,5 s)
```

**Non spostarlo e non cancellarlo** senza aver prima rigenerato ciò che serve.

Gli **script** invece sono versionati e stanno in `assets/promo/2026-07-presentation/`
di questo repository (vedi §4): sono la fonte di verità, la copia in `regia/` è solo
per comodità.

## 2. La regia da eseguire

`docs/internal/experiments/2026-08-03-regia-video-campagna.md` — «Now Playable»,
**approvata dall'utente**. Contiene idea, struttura, scaletta secondo per secondo,
copione parola per parola, divieti motivati e note di produzione.

Contiene anche, in §1, la **verifica delle affermazioni pubblicitarie**: «setaccia
tutto il web» è vera a metà e la formula onesta approvata è quella lì — non va
«migliorata» in fase di montaggio.

## 3. Cosa è GIÀ fatto

- **Regia** scritta, riscritta sul concetto giusto (il gioco al centro, non il turno
  di notte) e approvata.
- **Voce** ElevenLabs generata sul copione definitivo (8 battute), in `audio/play/`
  con `durations.txt`. La chiave è in `~/.config/jht/elevenlabs.env`. ⚠️ **La chiave
  è passata in chat e va RUOTATA**: revocare e ricreare su ElevenLabs
  (Developers → API Keys), poi aggiornare il file.
- **Girato del gioco**: 8 scene registrate con Movie Maker di Godot, a velocità
  naturale — `open-day`, `click-chat`, `work-pixels`, `tailor-88`, `dusk-night`,
  più `office`, `dept`, `chat` dalle produzioni precedenti.
- **Girato del sito**: 9 riprese in demo mode, col banner in quadro e **il puntatore
  del mouse visibile** (requisito esplicito dell'utente, verificato sui fotogrammi).
- **Montaggio orizzontale**: `jht-play.mp4`, **75,5 s**, 15 MB, con la voce
  sincronizzata e le pause fra battute tutte sotto 1,2 s.

## 4. Tre difetti corretti negli script (già committati, NON reintrodurli)

1. **Finestra dello swipe fuori dalla clip.** `shots_play.py` chiedeva `t0=14.0` +
   8,35 s su una ripresa lunga 20,1 s. Spostata a **11,5 s**, dove la card GreenGrid
   88 è in quadro col puntatore visibile.
2. **Montaggio verticale bloccato dal rapporto pixel.** I pezzi erano tutti
   720×1280 ma con SAR diverso (`0:1` quelli generati da PIL, `1556:1557` quelli
   passati per uno scale di ffmpeg) e `concat` falliva con un errore che parlava di
   dimensioni mentre il problema era altrove. Aggiunto `setsar=1` su ogni ingresso,
   in `make_show.py` e `make_show_vert.py`.
3. **Crash su girato più corto della finestra.** `game_shot()` moriva con
   `FileNotFoundError` sul singolo fotogramma mancante — un errore che dice quale
   file manca ma non che il problema è la scena intera. Ora **tiene l'ultimo
   fotogramma disponibile** e **stampa un avviso** con quanti fotogrammi sono in
   fermo immagine: il montaggio non si interrompe e chi tara le finestre vede subito
   quali sono da correggere.

## 5. Cosa MANCA

1. **Ritarare le finestre di gioco sul girato reale.** Alcune finestre in
   `shots_play.py` erano state scritte per un girato più lungo di quello poi
   registrato. Al montaggio l'avviso del punto 4.3 dice esattamente quali e di
   quanto sforano. **Non ridurre le durate** (le detta la battuta): spostare gli
   `skip` dentro il materiale disponibile.
   Girato per scena al momento della sospensione: `open-day` 269→480 (era in
   rigirata), `click-chat` 242, `work-pixels` 350, `tailor-88` 1200,
   `dusk-night` 310. **Ricontare prima di tarare.**
2. **Montare il verticale** (`make_show_vert.py`, 720×1280) — mai uscito.
3. **Verificare** come da regia: percentuale di parlato ≥85 % misurata con
   `silencedetect`, puntatore visibile in ogni clic, agenti che si muovono,
   nessuna accelerazione, verticale senza sezioni male inquadrate, banner leggibili.
4. **Consegnare** i due file all'utente.

## 6. Come NON rifare gli errori di questa sessione

- **Un solo agente per volta sul montaggio.** Il ciclo improduttivo è nato perché
  si montava mentre un altro processo rigirava le scene: ogni montaggio leggeva
  materiale a metà, e l'errore sembrava ogni volta diverso.
- **Prima di montare, verificare che non ci siano registrazioni in corso**
  (`pgrep -f godot`), e attendere **almeno 90 s di silenzio**: fra una scena e
  l'altra ci sono pause che sembrano la fine del lavoro e non lo sono.
- **Contare i fotogrammi prima di tarare le finestre**, non dopo il crash.
- **Copiare subito** il materiale da una worktree prima di lavorarci: quelle degli
  agenti conclusi spariscono.

## 7. Vincoli del committente (tre versioni respinte per questi)

- **Mai accelerare le riprese**: velocità 1:1. Se una clip è più lunga della scena
  si taglia, se è più corta si sceglie un altro spezzone.
- **La voce non molla mai**: copertura ≥85 % della durata, misurata.
- **Si deve vedere il puntatore che clicca** (nel sito va disegnato: Playwright non
  lo registra).
- **Gli agenti nel gioco si muovono** e poi se ne clicca uno.
- Niente numeri aggregati, niente rassegna dei ruoli, niente gergo, niente campi
  larghi illeggibili.
- Banner «DEMO MODE» e «SIMULATION — not real data» in quadro e leggibili per
  intero, verticale compreso. **Nessun dato personale reale.**
- Due formati sotto i 45 MB ciascuno, in inglese, senza musica (nessuna traccia con
  licenza disponibile).
