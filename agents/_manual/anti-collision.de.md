<!-- @translation: de, ai-translated 2026-06-06 -->
# 🛡️ Anti-Kollisions-Protokoll

Wenn mehrere Agenten derselben Rolle aus derselben Warteschlange ziehen, MSSEN sie vermeiden, am selben Datensatz zu arbeiten. Der Mechanismus ist **rollenspezifisch** — jede Phase verwendet die Sperrstrategie, die am besten zu ihrer Arbeitsform passt.

## 🎯 Sperrmechanismen pro Rolle

### 🕵️ Scout — Deduplizierung vor INSERT

Scouts schreiben *neue* Datenstze, knnen also nichts sperren, was noch nicht existiert. Das Kollisionsrisiko besteht darin, dass zwei Scouts dieselbe Stellenanzeige aus verschiedenen Quellen einfgen. Mechanismus:

```bash
# Vor dem INSERT prfen, ob die URL bereits in der DB ist
python3 shared/skills/db_query.py check-url "<url>"
# Gibt "TROVATA" (berspringen) oder "NON TROVATA" (mit INSERT fortfahren) zurck.
```

Partitionierung beim Start: Scouts handeln auerdem **Kreise** und **Quellen** ber `scout_coord.py` aus, damit sie sich nicht von vornherein auf derselben Quelle berlappen. Siehe `agents/scout/scout.md` fr Details.

### 👨‍🔬 Analyst  👨‍💻 Scorer — `last_checked`-Wasserzeichen

Beide ziehen aus einer Warteschlange (`status = new` fr Analysten, `status = checked` fr Scorer) und aktualisieren bestehende Datenstze. Das Kollisionsrisiko besteht darin, dass zwei Peers gleichzeitig denselben Datensatz auswhlen. Mechanismus:

1. **Lies** `last_checked` fr den Kandidaten-Datensatz.
2. **Falls krzlich** (ein Peer hat ihn in den letzten Minuten gestempelt) → berspringen; den nchsten nehmen.
3. **Andernfalls** `last_checked = now()` stempeln, um ihn zu beanspruchen, dann arbeiten.

```bash
# Beanspruchen
python3 shared/skills/db_update.py position <ID> --last-checked now
```

Das Wasserzeichen ist eine weiche Sperre: Es signalisiert nur "krzlich berhrt", nicht "dauerhaft gesperrt". Die Behandlung veralteter Ansprche bleibt dem Urteil des Agenten berlassen (siehe § Veraltete Ansprche unten).

### 👨‍🏫 Schreiber — `status = writing`-Umschaltung

Schreiber ziehen aus `status = scored`. Das Kollisionsrisiko besteht darin, dass zwei Schreiber dieselbe hochbewertete Position greifen. Mechanismus:

```bash
# Atomare Beanspruchung durch Status-Umschaltung
python3 shared/skills/db_update.py position <ID> --status writing
```

Peers, die `next-for-scrittore` ausfhren, sehen keine Datenstze, die bereits in `status = writing` sind, daher ist die Umschaltung selbst die Sperre. Zustzliche Anti-berschreibungsregel: Wenn `applications.critic_verdict` bereits gesetzt ist, **absolut berspringen** (das Urteil ist endgltig).

## 📡 Kommunikation

Wenn ein Agent einen Peer informieren muss (z.B. "Ich nehme die IDs 42-44") oder Downstream benachrichtigen muss (z.B. Scout → Analyst mit einem frischen Batch), verwende den atomaren Wrapper:

```bash
jht-tmux-send <PEER_SESSION> "[@me -> @peer] [INFO] taking IDs 42-44"
```

⚠️ **Verwende nicht direkt `tmux send-keys`**: Codex/Kimi-TUIs verlieren das Enter-Zeichen, wenn es im selben `send-keys`-Aufruf wie der Textkrper ankommt. Der Wrapper behandelt Text + Enter atomar mit einer Render-Pause. Skill: `agents/_skills/tmux-send/jht-tmux-send`.

## 👨‍⚕️ Veraltete Ansprche (selten in Produktion)

Produktionsagenten laufen monatelang ohne auszufallen — veraltete Ansprche sind berwiegend ein Artefakt der Testumgebung. Wenn sie auftreten:

- **Stiehl nicht blind einen veralteten Anspruch.** Ein `last_checked` von vor 10 Minuten knnte ein Peer sein, der einfach langsam bei einem einzelnen Datensatz ist, keine tote Sitzung.
- **berprfe zuerst die Lebendigkeit des Peers.** Prfe die tmux-Sitzung des Peers (`tmux has-session -t <peer>`); inspiziere das Panel (`tmux capture-pane -p`), um zu sehen, ob er noch arbeitet, bei einem Fetch blockiert ist oder tatschlich tot ist.
- **Wenn der Peer lebt aber feststeckt**, eskaliere zum Kapitn, anstatt den Datensatz wegzunehmen.
- **Wenn der Peer tot ist**, beanspruche den Datensatz selbst und benachrichtige den Kapitn.

Die Absicht: stilles Datensatz-Stehlen vermeiden. Entscheidungen ber Rckforderung sollten bewusst getroffen werden, nicht automatisch.

## 📋 Gemeinsame Regeln

- **Lies vor dem Beanspruchen.** berprfe immer den aktuellen Zustand des Datensatzes, bevor du ihn beanspruchst.
- **Der erste Schreibvorgang gewinnt.** Wenn zwei Agenten um denselben Datensatz konkurrieren, gewinnt das erste DB-Update; der Verlierer berspringt und nimmt den nchsten.
- **Niemals DELETE.** Verwende `--status excluded` mit Notizen, wenn sich ein Datensatz als ungltig herausstellt; zerstre niemals Daten.
- **Aktualisiere den finalen Status wenn fertig.** Nach der Arbeit: `checked` (Analyst), `scored` / `excluded` (Scorer), `ready` / `excluded` (Schreiber).

## 🛠️ Zuknftige Vereinheitlichung (geplant)

Ein `positions.claimed_by + claimed_at`-Paar steht auf der Roadmap, um **Batch-Beanspruchungen** zu ermglichen (ein einzelnes atomares `UPDATE … LIMIT N` statt N Roundtrips pro Datensatz) und um eine Echtzeit-Ansicht der Agentenaktivitt fr das UI-Dashboard zu speisen. Die oben genannten rollenspezifischen Mechanismen werden daneben weiterhin funktionieren. Siehe ROADMAP § *Database schema optimization*.
