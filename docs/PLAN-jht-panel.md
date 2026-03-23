# PIANO — JHT Panel (App Desktop)

**Data:** 2026-03-15
**Obiettivo:** App desktop nativa (Rust + egui) per controllare il team JHT via tmux senza passare dal terminale.
**Directory progetto:** `tools/jht-panel/`

---

## ARCHITETTURA

```
tools/jht-panel/
├── Cargo.toml
├── src/
│   ├── main.rs              ← Entry point + eframe setup
│   ├── app.rs               ← Stato app + trait eframe::App
│   ├── tmux.rs              ← Modulo tmux: list, capture, send, start/stop
│   ├── ui/
│   │   ├── mod.rs
│   │   ├── sidebar.rs       ← Pannello agenti (lista, stato, selezione)
│   │   ├── terminal.rs      ← Vista output tmux (scroll libero)
│   │   └── chat.rs          ← Input messaggio + menzioni @agent
│   └── agents.rs            ← Config agenti JHT (nomi, emoji, sessioni)
├── assets/
│   └── icon.png             ← Icona app (opzionale)
└── README.md
```

### Flusso dati (zero HTTP)

```
UI (egui) → invoke Rust fn → std::process::Command → tmux → sessione agente
                                                          ↓
UI (egui) ← String output ← stdout ←────── tmux capture-pane
```

---

## TEAM ASSIGNMENT

| Checkpoint | Worker | Modello | Scope |
|------------|--------|---------|-------|
| CP1-CP3 | **Max** (Backend) | Opus | Scaffold Cargo + modulo `tmux.rs` + `agents.rs` + `app.rs` base |
| CP3-CP4 | **Dot** (Frontend) | Sonnet | Moduli UI: `sidebar.rs`, `terminal.rs`, `chat.rs` |
| CP1 | **Lex** (Infra) | Sonnet | Script di build/launch + verifica dipendenze Cargo |
| CP4-CP5 | **Tom** (QA) | Sonnet | Test modulo tmux + test integrazione |
| CP5 | **Dan** (E2E) | Sonnet | Test flusso completo: avvia app → invia messaggio → verifica ricezione |

### Dipendenze tra task

```
CP1 (Max+Lex) ──→ CP2 (Max) ──→ CP3 (Max+Dot in parallelo) ──→ CP4 (Dot+Max) ──→ CP5 (Tom+Dan)
```

---

## CHECKPOINT

### CP1 — Scaffold progetto [Max + Lex]

**Obiettivo:** il progetto compila e mostra una finestra vuota egui.

- [ ] **Max:** Creare `tools/jht-panel/Cargo.toml` con dipendenze:
  ```toml
  [dependencies]
  eframe = "0.31"           # egui + backend nativo
  ```
- [ ] **Max:** Creare `src/main.rs` con entry point eframe
- [ ] **Max:** Creare `src/app.rs` con struct `JhtPanel` + impl `eframe::App` (finestra vuota con titolo "JHT Panel")
- [ ] **Lex:** Creare script `tools/jht-panel/run.sh` (build + launch)
- [ ] **Lex:** Verificare che `cargo build` compila senza errori

**Criterio di completamento:** `cargo run` apre una finestra con titolo "JHT Panel".

---

### CP2 — Modulo tmux [Max]

**Obiettivo:** funzioni Rust che parlano con tmux. Testabili standalone.

- [ ] `src/tmux.rs` con le seguenti funzioni:
  ```rust
  pub fn list_sessions() -> Vec<TmuxSession>
  // Esegue: tmux list-sessions -F "#{session_name}|||#{session_activity}"
  // Filtra solo sessioni JHT-*
  // Ritorna: nome, attiva/idle, timestamp

  pub fn capture_output(session: &str, lines: usize) -> Result<String, String>
  // Esegue: tmux capture-pane -t {session} -p -S -{lines}
  // Ritorna tutto l'output come stringa

  pub fn capture_full_history(session: &str) -> Result<String, String>
  // Esegue: tmux capture-pane -t {session} -p -S -
  // Ritorna TUTTO il buffer (scroll completo)

  pub fn send_message(session: &str, message: &str) -> Result<(), String>
  // Esegue DUE comandi separati (regola #1):
  //   1. tmux send-keys -t {session} "{message}"
  //   2. tmux send-keys -t {session} Enter

  pub fn has_session(session: &str) -> bool
  // Esegue: tmux has-session -t {session}
  ```

- [ ] `src/agents.rs` con configurazione statica:
  ```rust
  pub struct Agent {
      pub name: &'static str,       // "Ace"
      pub role: &'static str,       // "Coordinatore"
      pub emoji: &'static str,      // "👷🏽🧭"
      pub session: &'static str,    // "JHT-COORD"
  }

  pub const AGENTS: &[Agent] = &[
      Agent { name: "Ace",  role: "Coordinatore", emoji: "👷🏽🧭", session: "JHT-COORD" },
      Agent { name: "Dot",  role: "Frontend",     emoji: "👷🏽🎨", session: "JHT-FRONTEND" },
      Agent { name: "Max",  role: "Backend",       emoji: "👷🏽⚙️", session: "JHT-BACKEND" },
      Agent { name: "Tom",  role: "QA",            emoji: "👷🏽🧪", session: "JHT-QA" },
      Agent { name: "Dan",  role: "E2E",           emoji: "👷🏽🔁", session: "JHT-E2E" },
      Agent { name: "Lex",  role: "Infra",         emoji: "👷🏽🏗️", session: "JHT-INFRA" },
  ];
  ```

**Criterio di completamento:** un test che lista le sessioni tmux attive e cattura l'output di una di esse.

---

### CP3 — UI base [Max + Dot]

**Obiettivo:** finestra con 3 pannelli funzionanti ma non ancora collegati a tmux.

**Max** costruisce lo scheletro in `app.rs`:
- [ ] Layout a 3 zone: sidebar sinistra + area principale + input in basso
- [ ] Stato app: `selected_agent`, `tmux_output: String`, `input_message: String`

**Dot** implementa i widget UI:
- [ ] `ui/sidebar.rs` — Lista agenti con:
  - Emoji + nome
  - Indicatore stato (verde = online, grigio = offline)
  - Click per selezionare (highlight)
  - Checkbox per selezione multipla (broadcast)

- [ ] `ui/terminal.rs` — Area output con:
  - `ScrollArea::vertical()` con auto-scroll in basso
  - Testo monospace
  - Tutto il buffer visibile (scroll libero senza limiti)

- [ ] `ui/chat.rs` — Input messaggio con:
  - `TextEdit` single-line per digitare
  - Bottone "Invia" (o Enter per inviare)
  - Label che mostra destinatari selezionati

**Criterio di completamento:** la finestra mostra i 3 pannelli con dati placeholder.

---

### CP4 — Integrazione [Dot + Max]

**Obiettivo:** l'app funziona end-to-end. Puoi vedere output e inviare messaggi.

- [ ] **Max:** Collegare sidebar a `tmux::list_sessions()` — stato reale online/offline
- [ ] **Max:** Collegare terminal a `tmux::capture_full_history()` — output reale
- [ ] **Max:** Timer di refresh automatico (ogni 2 secondi, polling tmux)
- [ ] **Dot:** Collegare chat a `tmux::send_message()` — invio reale
- [ ] **Dot:** Selezione multipla: invia a tutti gli agenti selezionati
- [ ] **Dot:** Formattare messaggio: `[@leone -> @{agent}] [MSG] {testo}`
- [ ] **Dot:** Auto-scroll quando arriva nuovo output
- [ ] **Dot:** Menzioni con `@` — digitando `@` mostra dropdown con nomi agenti

**Criterio di completamento:** Leone può selezionare un agente, vedere il suo output tmux, scrivere un messaggio e riceverlo nella sessione tmux.

---

### CP5 — Polish + Test [Tom + Dan]

**Obiettivo:** app stabile, testata, pronta all'uso quotidiano.

- [ ] **Tom:** Test unitari modulo `tmux.rs`:
  - `list_sessions` con/senza sessioni JHT attive
  - `send_message` verifica che i 2 comandi separati vengano eseguiti
  - `capture_output` con sessione esistente/inesistente
- [ ] **Dan:** Test E2E flusso completo:
  - Avvia app → seleziona agente → invia messaggio → verifica ricezione in tmux
- [ ] **Dot:** Keyboard shortcuts:
  - `Cmd+1..6` per selezionare agente
  - `Cmd+A` seleziona tutti
  - `Enter` invia messaggio
  - `Escape` deseleziona tutti
- [ ] **Lex:** Creare `tools/jht-panel/install.sh` per build release + symlink in PATH

**Criterio di completamento:** l'app è stabile, i test passano, Leone la usa senza problemi.

---

## REGOLE

1. **Tutto in `tools/jht-panel/`** — non toccare il resto del repo
2. **Zero HTTP** — comunicazione diretta tmux via `std::process::Command`
3. **Branch unica** — tutti lavorano su `feature/jht-panel`, Max fa il merge dei pezzi
4. **Commit frequenti** — ogni checkpoint completato = commit
5. **Niente over-engineering** — è un tool interno, non un prodotto. Funzionale > bello

---

## TIMELINE STIMATA

| Checkpoint | Durata | Blocca |
|------------|--------|--------|
| CP1 | ~15 min | Nessuno |
| CP2 | ~30 min | CP1 |
| CP3 | ~45 min | CP1 (Max), CP2 per collegamento |
| CP4 | ~30 min | CP2 + CP3 |
| CP5 | ~30 min | CP4 |

**Totale:** ~2.5 ore per MVP funzionante.
