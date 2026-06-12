# Agent prompts i18n — policy lockata 2026-05-13

> Convenzione + infrastruttura di startup per la risoluzione multi-lingua dei file d'identità agenti (`agents/<role>/<role>.md`).
> Decisione finale: **policy "lingua utente unica" ovunque**, JD content eccezione.

---

## ✅ Policy lockata (2026-05-13)

L'utente sceglie **una lingua** al primo setup desktop (`~/.jht/i18n-prefs.json::locale`).

**Tutto user-visible deve essere in quella lingua**, indipendentemente dalla lingua del prompt o delle team-rules:

- 💬 Chat utente (web, Telegram)
- 📋 Dashboard UI (status, summaries, note)
- 📨 Messaggi inter-agente (`jht-tmux-send` — possono comparire in `tmux capture-pane` mostrato all'utente)
- 📝 Commenti/note nei deliverable (CV summary, cover-letter rationale, analyst notes, scorer reasoning, critic feedback)

**Eccezione — JD content originale:**

- 🌐 Job description body, requirements, company About **non si traducono**
- Esempio: utente IT che applica a posizione tedesca → JD resta in tedesco, ma i commenti dell'Analista sull'offerta sono in italiano
- 🔗 URL, nomi azienda, technology names, brand terms → mai tradotti

**Inter-agent edge case**: agent A (locale utente) riceve quote JD (tedesco) da agent B. A processa il JD tedesco, ma il suo output/commentary è in locale utente.

→ Specifica completa in `agents/_team/team-rules.md` § **RULE-T14**.

---

## 🏛️ Convenzione tecnica

### Layout `<role>.<locale>.md` siblings

```
agents/
  capitano/
    capitano.md          ← baseline (oggi italiano, target EN dopo traduzione)
    capitano.<loc>.md    ← override per locale (futuro)
  scrittore/
    scrittore.md
    scrittore.<loc>.md
  ...
```

### Perché siblings, non `prompts/<lang>/<role>.md`

| Opzione | Pro | Contro |
|---|---|---|
| ⭐ **Siblings `<role>.<locale>.md`** | Localmente raggruppati, no path traversal aggiuntivo, easy `ls agents/<role>/` per vedere tutte le versioni | Cresce la dir di un fattore 1+N |
| `prompts/<lang>/<role>.md` overlay | Chiaro per i traduttori | Path resolution più complessa, doppio search-and-replace per refactor cross-role |
| Front-matter multi-lang in singolo `.md` | File singolo | Frontmatter YAML mixed-language fragile, 5x dimensione, no diff utile in PR |

Vince **siblings**: il diff tra IT e EN per un singolo agente è centinaia di righe, tenerli vicini aiuta translator + reviewer in PR.

### Regola di fallback

```
locale resolution:
  1. tenta agents/<role>/<role>.<locale>.md
  2. se non esiste, fallback a agents/<role>/<role>.md (= baseline)
  3. se neanche il baseline esiste, errore
```

Fallback **silenzioso** (no warning) durante la transizione.

---

## 🔧 Sorgente del locale

`~/.jht/i18n-prefs.json` (popolato da onboarding desktop wizard):

```json
{ "locale": "en" }
```

Default fallback: `en` (`DEFAULT_LOCALE` in `shared/i18n/types.ts`).

---

## 🚀 Infrastruttura scaffolded (2026-05-06)

### `.launcher/start-agent.sh` — risoluzione lingua

```bash
resolve_identity_template() {
  local role="$1" locale prefs_file localized
  prefs_file="${JHT_HOME:-$HOME/.jht}/i18n-prefs.json"
  locale="$(jq -r '.locale // "en"' "$prefs_file" 2>/dev/null || echo en)"
  localized="$REPO_ROOT/agents/$role/$role.$locale.md"
  if [ -f "$localized" ]; then
    echo "$localized"
  else
    echo "$REPO_ROOT/agents/$role/$role.md"
  fi
}
TEMPLATE="$(resolve_identity_template "$ROLE")"
```

### Cosa NON è ancora cablato

1. ❌ **Localizzazione `agents/_team/`, `agents/_manual/`, `agents/_skills/`** — questi file vengono letti **dall'agente stesso via `Read` tool** in runtime, non copiati dal launcher. Serve risoluzione diversa (linking simbolico per locale o manifest letto via skill). Out of scope di questa scaffolding.
2. ❌ **Contenuti EN tradotti** — i file `<role>.md` sono italiani. Task traduzione esplicito sotto.

---

## ⚠️ Stato 2026-05-13

| Dato | Valore |
|---|---|
| Architettura risoluzione `<role>.<locale>.md` | ✅ deployed in `start-agent.sh` |
| RULE-T14 safeguard runtime | ✅ deployed in `agents/_team/team-rules.md` |
| Contenuti baseline `<role>.md` | 🇮🇹 italiano (~1650 righe totali, post-refactor) |
| Contenuti tradotti EN | ❌ zero |
| Task traduzione attivo nel BACKLOG | 🔴 `[JHT-I18N-TRANSLATE]` da creare |

### Drift mismatch — mitigato ma non eliminato

Con RULE-T14 deployed:
- ✅ Utente con `locale=en` riceve output EN anche se baseline prompt è IT
- 🟡 Costo: l'agente fa "traduzione mentale" runtime → leggero overhead di token
- 🟢 Eliminazione totale del costo: traduzione vera dei prompt → `[JHT-I18N-TRANSLATE]`

---

## 📋 Task traduzione esplicito

**`[JHT-I18N-TRANSLATE]`** — Traduzione baseline prompt agenti IT → EN

**Scope**: 10 file `<role>.md`, totale ~1650 righe (post-refactor 2026-05-12):

| File | Righe |
|---|---|
| `agents/capitano/capitano.md` | 142 |
| `agents/scout/scout.md` | 146 |
| `agents/analista/analista.md` | 179 |
| `agents/scorer/scorer.md` | 151 |
| `agents/scrittore/scrittore.md` | 151 |
| `agents/critico/critico.md` | 94 |
| `agents/sentinella/sentinella.md` | 134 |
| `agents/assistente/assistente.md` | 197 |
| `agents/dottore/dottore.md` | 123 |
| `agents/mentor/mentor.md` | 140 |

**Procedura**:
1. Copiare ogni `<role>.md` corrente in `<role>.it.md` (preserva IT come override)
2. Tradurre il contenuto del baseline `<role>.md` in inglese
3. Lasciare invariati: protocol token (`STEADY`, `ATTENZIONE`, `RECOVERY TRACKING`, ecc. — sono parsati per pattern dal Capitano), nomi tmux session (`CAPITANO`, `SCOUT-N`, ecc.), comandi shell, path
4. Smoke test: avviare team con `locale=en`, verificare che il baseline EN viene caricato e che gli agenti rispondono in EN

**Acceptance**:
- 10 file `<role>.md` in EN
- 10 file `<role>.it.md` con contenuto IT preservato
- Team start con `locale=en` produce risposte EN senza drift
- RULE-T14 resta come safeguard per locale non ancora tradotti (HU, ES, DE...)

**Effort stimato**: 4-6 ore (traduzione + smoke). Da inserire come task BACKLOG pre-launch.

---

## 🌐 Community translation (post-launch)

`<role>.hu.md`, `<role>.es.md`, `<role>.de.md`, ecc. — contribute pattern via PR.

Documentazione per traduttori da scrivere (`docs/contributing/TRANSLATIONS.md`):
- come aggiungere una nuova lingua (`shared/i18n/types.ts` + `web/messages/<loc>.json` + `<role>.<loc>.md` siblings)
- glossary di termini da NON tradurre (protocol tokens, tmux names, comandi)
- review process

---

## 🔗 Riferimenti

- `agents/_team/team-rules.md` § RULE-T14 — runtime safeguard
- `.launcher/start-agent.sh::resolve_identity_template` — risoluzione locale
- `shared/i18n/types.ts` — `DEFAULT_LOCALE='en'`
- `web/messages/{en,it,hu}.json` — UI translations
- BACKLOG: `[JHT-I18N-AGENT-PROMPTS]`, `[JHT-I18N-TRANSLATE]` (nuovo), `[JHT-I18N-03]` future language expansion
- [Anthropic prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- [Claude Lab — language switch fix](https://claudelab.net/en/articles/claude-ai/claude-japanese-response-english-switch-fix)
