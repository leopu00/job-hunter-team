<!-- @translation: de, ai-translated 2026-06-06 -->
# 🪟 Tmux-Sitzungen

Das JHT-Team laeuft als eine Reihe von tmux-Sitzungen innerhalb des Containers. Sitzungsnamen sind **Grossbuchstaben, keine Emoji, keine Leerzeichen**.

## 📛 Namenskonvention

| Pattern | Bedeutung | Beispiele |
|---|---|---|
| `<ROLE>` | Singleton — nur eine Instanz | `CAPITANO` · `CRITICO` · `SENTINELLA` · `ASSISTENTE` |
| `<ROLE>-<N>` | Pool-Mitglied — N ist eine positive Ganzzahl | `SCOUT-1` · `ANALISTA-2` · `SCRITTORE-3` |
| `<ROLE>-S<N>` | Dynamisch von einem anderen Agenten erzeugt | `CRITICO-S1` (erzeugt von `SCRITTORE-1`), `CRITICO-S2`, … |

## 📚 Bekannte Sitzungen

### Pool-Sitzungen (der Kapitaen bestimmt die Instanzanzahl)

| Sitzungspraefix | Rolle | Hinweise |
|---|---|---|
| `SCOUT-<N>` | Entdeckung | Mehrere Instanzen, Peer-Koordination ueber `scout_coord.py` |
| `ANALISTA-<N>` | Verifizierung | Bezieht aus `next-for-analista` |
| `SCORER-<N>` | Bewertung | Bezieht aus `next-for-scorer` |
| `SCRITTORE-<N>` | Texterstellung | Bezieht aus `next-for-scrittore` (score DESC) |

### Singletons

| Sitzung | Rolle | Hinweise |
|---|---|---|
| `CAPITANO` | Team-Kommandant | Einzelinstanz — koordiniert Befehle, Status, Eskalationen |
| `CRITICO` | Eigenstaendiger Kritiker | Legacy — in V5 wird der Kritiker dynamisch von den Schreibern erzeugt (siehe unten) |
| `SENTINELLA` | Verbrauchs-Watchdog | Edge-triggered, kommuniziert nur mit `CAPITANO` |
| `ASSISTENTE` | Benutzer-Copilot | Uebersetzt Benutzeranfragen in Befehle |
| `MENTOR` | Career-Coach-Agent | Geplant, derzeit ein Placeholder |

### Dynamische Sitzungen

| Sitzung | Erzeugt von | Lebensdauer |
|---|---|---|
| `CRITICO-S<N>` | `SCRITTORE-<N>` (ein neuer Kritiker pro Reviewrunde) | Eine Reviewanfrage → eine Sitzung, vom Schreiber sofort danach beendet |

Der Schreiber erstellt `CRITICO-S<N>` mit derselben Nummer (`SCRITTORE-1` → `CRITICO-S1`), fuehrt das Review durch und dann `tmux kill-session`. Fuer **jede** der 3 Reviewrunden wird eine neue Kritiker-Instanz erzeugt — niemals wiederverwendet.

## 🔗 Verwandte Seiten

- 💬 [`communication-rules.md`](communication-rules.md) — Nachrichtenumschlag, `jht-tmux-send`, wer was senden muss
- 🛡️ [`anti-collision.md`](anti-collision.md) — Peer-Koordination zwischen Pool-Mitgliedern
- 🧭 [`../_team/architettura.md`](../_team/architettura.md) — vollstaendige Teamzusammensetzung und Stufenzuordnung
