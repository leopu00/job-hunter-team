<!-- @translation: it, ai-translated 2026-06-06 -->
# 🛡️ Protocollo Anti-Collisione

Quando pi agenti con lo stesso ruolo attingono dalla stessa coda, DEVONO evitare di lavorare sullo stesso record. Il meccanismo  **specifico per ruolo** — ogni fase usa la strategia di lock pi adatta alla propria forma di lavoro.

## 🎯 Meccanismi di lock per ruolo

### 🕵️ Scout — dedup pre-INSERT

Gli Scout scrivono record *nuovi*, quindi non possono bloccare qualcosa che non esiste ancora. Il rischio di collisione  che due scout inseriscano la stessa offerta di lavoro da fonti diverse. Meccanismo:

```bash
# Prima dell'INSERT, verifica se l'URL  gi nel DB
python3 shared/skills/db_query.py check-url "<url>"
# Restituisce "TROVATA" (salta) o "NON TROVATA" (procedi con l'INSERT).
```

Partizionamento al boot: gli scout negoziano anche **cerchie** e **fonti** tramite `scout_coord.py` per non sovrapporsi sulla stessa fonte in partenza. Vedi `agents/scout/scout.md` per i dettagli.

### 👨‍🔬 Analista  👨‍💻 Scorer — watermark `last_checked`

Entrambi attingono da una coda (`status = new` per gli Analisti, `status = checked` per gli Scorer) e aggiornano record esistenti. Il rischio di collisione  che due peer selezionino lo stesso record nello stesso momento. Meccanismo:

1. **Leggi** `last_checked` per il record candidato.
2. **Se recente** (un peer lo ha timbrato negli ultimi minuti) → salta; prendi il successivo.
3. **Altrimenti** timbra `last_checked = now()` per rivendicarlo, poi lavora.

```bash
# Rivendicazione
python3 shared/skills/db_update.py position <ID> --last-checked now
```

Il watermark  un lock soft: segnala solo "toccato di recente", non "bloccato permanentemente". La gestione delle rivendicazioni stantie  lasciata al giudizio dell'agente (vedi § Rivendicazioni stantie sotto).

### 👨‍🏫 Scrittore — flip `status = writing`

Gli Scrittori attingono da `status = scored`. Il rischio di collisione  che due scrittori prendano la stessa posizione ad alto punteggio. Meccanismo:

```bash
# Rivendicazione atomica tramite flip dello status
python3 shared/skills/db_update.py position <ID> --status writing
```

I peer che eseguono `next-for-scrittore` non vedranno record gi in `status = writing`, quindi il flip stesso  il lock. Regola anti-riscrittura aggiuntiva: se `applications.critic_verdict`  gi impostato, **salta in assoluto** (il verdetto  definitivo).

## 📡 Comunicazione

Quando un agente deve informare un peer (es. "Sto prendendo gli ID 42-44") o notificare il downstream (es. Scout → Analista con un batch fresco), usa il wrapper atomico:

```bash
jht-tmux-send <PEER_SESSION> "[@me -> @peer] [INFO] taking IDs 42-44"
```

⚠️ **Non usare `tmux send-keys` direttamente**: le TUI di Codex/Kimi perdono il carattere Enter se arriva nella stessa chiamata `send-keys` del corpo del testo. Il wrapper gestisce testo + Enter atomicamente con una pausa di rendering. Skill: `agents/_skills/tmux-send/jht-tmux-send`.

## 👨‍⚕️ Rivendicazioni stantie (rare in produzione)

Gli agenti in produzione girano per mesi senza morire — le rivendicazioni stantie sono per lo pi un artefatto dell'ambiente di test. Quando succedono:

- **Non rubare alla cieca una rivendicazione stantia.** Un `last_checked` di 10 minuti fa potrebbe essere un peer che  semplicemente lento su un singolo record, non una sessione morta.
- **Verifica prima la vivacit del peer.** Controlla la sessione tmux del peer (`tmux has-session -t <peer>`); ispeziona il pane (`tmux capture-pane -p`) per vedere se sta ancora lavorando,  bloccato su un fetch, o  effettivamente morto.
- **Se il peer  vivo ma bloccato**, escala al Capitano invece di strappargli il record.
- **Se il peer  morto**, rivendica il record tu stesso e notifica il Capitano.

L'intento: evitare il furto silenzioso di record. Le decisioni sulla riacquisizione devono essere deliberate, non automatiche.

## 📋 Regole comuni

- **Leggi prima di rivendicare.** Controlla sempre lo stato corrente del record prima di rivendicarlo.
- **La prima scrittura vince.** Se due agenti fanno a gara sullo stesso record, il primo aggiornamento DB vince; il perdente salta e prende il successivo.
- **Mai DELETE.** Usa `--status excluded` con note quando un record risulta invalido; non distruggere mai i dati.
- **Aggiorna lo status finale quando hai finito.** Dopo il lavoro: `checked` (Analista), `scored` / `excluded` (Scorer), `ready` / `excluded` (Scrittore).

## 🛠️ Unificazione futura (pianificata)

Una coppia `positions.claimed_by + claimed_at`  nella roadmap per abilitare le **rivendicazioni batch** (un singolo `UPDATE … LIMIT N` atomico invece di N round-trip per record) e per alimentare una vista real-time dell'attivit degli agenti nella dashboard UI. I meccanismi specifici per ruolo sopra continueranno a funzionare in parallelo. Vedi ROADMAP § *Database schema optimization*.
