# Agent prompts i18n — design + scaffolding (2026-05-06)

> Risoluzione multi-lingua dei file d'identità agenti (`agents/<role>/<role>.md`).
> Questo doc copre la **convenzione** + **infrastruttura di startup**, NON la traduzione dei contenuti (in lavorazione su branch parallela, fuori scope qui).

---

## 🎯 Problema

I prompt d'identità degli agenti JHT sommano oggi migliaia di righe in italiano:

| File | Righe (ordine di grandezza) |
|---|---|
| `agents/capitano/capitano.md` | 647 |
| `agents/scrittore-1..3/scrittore.md` | ~400 ciascuno |
| `agents/scout/scout.md` | ~300 |
| `agents/analista/analista.md` | ~250 |
| `agents/scorer/scorer.md` | ~200 |
| `agents/critico/critico.md` | ~250 |
| `agents/sentinella/sentinella.md` | ~130 |
| `agents/assistente/assistente.md` | ~200 |
| `agents/maestro/maestro.md` | ~200 (planned) |

**Anthropic best practices** ([prompt-engineering docs](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)) chiariscono che Claude di norma risponde nella lingua dell'utente. Tuttavia il [Claude Lab — language switch fix](https://claudelab.net/en/articles/claude-ai/claude-japanese-response-english-switch-fix) documenta un pattern di "language drift":

> *"Claude infers language from the content of each message rather than storing a persistent preference. In sessions with heavy non-target content, it may interpret the conversation as primary in that language."*

Su JHT il rischio è concreto: un beta tester anglofono che scrive *"find me python jobs"* può vedere il Capitano rispondere in italiano per inerzia del system prompt da 647 righe. Per la beta multi-paese serve allineamento lingua prompt ↔ lingua utente.

---

## 🏛️ Convenzione scelta

**Layout:** `<role>.<locale>.md` siblings nello stesso directory del file baseline.

```
agents/
  capitano/
    capitano.md          ← baseline (= English, allineata a DEFAULT_LOCALE='en')
    capitano.it.md       ← override italiano (futuro)
    capitano.hu.md       ← override ungherese (futuro)
    capitano.es.md       ← override spagnolo (futuro)
  scrittore-1/
    scrittore.md         ← baseline EN
    scrittore.it.md
  ...
```

### Perché siblings, non `prompts/<lang>/<role>.md`

Considerate alternative:

| Opzione | Pro | Contro |
|---|---|---|
| ⭐ **Siblings `<role>.<locale>.md`** | Localmente raggruppati, no path traversal aggiuntivo, easy `ls agents/capitano/` per vedere tutte le versioni | Cresce la dir di un fattore 1+N (= 1 baseline + N traduzioni) |
| `prompts/<lang>/<role>.md` overlay | Chiaro per i traduttori (apri dir e traduci) | Path resolution più complessa, doppio search-and-replace per refactor cross-role |
| Front-matter multi-lang in singolo `.md` | File singolo | Frontmatter YAML mixed-language fragile, 5x dimensione del file, no diff utile in PR |

Vince **siblings**: il diff tra IT e EN per un singolo agente è già grande (centinaia di righe), tenerli vicini aiuta il translator + il reviewer in PR.

### Regola di fallback

```
locale resolution:
  1. tenta agents/<role>/<role>.<locale>.md
  2. se non esiste, fallback a agents/<role>/<role>.md (= baseline = EN)
  3. se neanche il baseline esiste, errore (esistente, non cambia)
```

Il fallback è **silenzioso** (no warning) perché:
- Durante la transizione (oggi → futuro), molti `<role>.<locale>.md` non esisteranno
- Il warning ad ogni avvio agente sarebbe rumore in chat
- Il *real* fallback rimane utilizzabile, no regressione

---

## 🔧 Sorgente del locale

`~/.jht/i18n-prefs.json` (già esistente, popolato da onboarding desktop wizard + dashboard):

```json
{ "locale": "en" }
```

Default fallback se file mancante o malformato: `en` (allineato a `DEFAULT_LOCALE` in `shared/i18n/types.ts` post-fix 2026-05-06).

Da [release notes Claude Code 2.1](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md): *"adds optional response-language settings"* — è una feature lato CLI, separata, che NON usiamo: il nostro stack agente è multi-CLI (Claude + Codex + Kimi), quindi serve una soluzione lato repository (questa).

---

## 🚀 Infrastruttura scaffolded (2026-05-06)

### `.launcher/start-agent.sh` — risoluzione lingua

Helper aggiunto:

```bash
# Risolve il file template d'identità nella lingua dell'utente.
# Convenzione: agents/<role>/<role>.<locale>.md → fallback agents/<role>/<role>.md.
# Locale letto da $JHT_HOME/i18n-prefs.json; default 'en' se assente.
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

Il resto del flow (`cmp` + `cp` per single source of truth) resta invariato.

### Cosa NON è scaffolded ancora

1. ❌ **Localizzazione `agents/_team/`, `agents/_manual/`, `agents/_skills/`** — questi file vengono letti **dall'agente stesso via `Read` tool** in runtime, non copiati dal launcher. Quindi serve un'altra strategia (e.g. linking simbolico per locale o un manifest letto dallo skill `db-query`). Out of scope di questa scaffolding.
2. ❌ **Contenuti EN tradotti** — i file `<role>.md` sono ancora in italiano. La traduzione completa è in lavoro su branch parallela. Quando merge → diventeranno baseline EN, e gli `<role>.it.md` siblings serviranno come override per locale italiano.

---

## 📅 Sequencing post-scaffolding

```
ORA  (post-scaffolding 2026-05-06)
├─ <role>.md = italiano (baseline storico)
├─ start-agent.sh prova <role>.<locale>.md → fallback <role>.md
├─ DEFAULT_LOCALE='en' (settings + i18n-prefs.json)
│  ⚠️ inconsistenza temporanea: prefs dice EN ma il file servito è IT
│  → effetto: language drift già attivo come prima (zero regressione)
│  → mitigazione transitoria: documentata sotto in "🩹 Quick patch RULE-T14"
│
├─ traduzione branch merge (futuro vicino)
│  └─ <role>.md diventa EN (baseline corretta)
│  └─ <role>.it.md aggiunto come override per locale='it' (preserva esistente)
│
└─ aggiungere lingue (futuro lontano)
   └─ <role>.hu.md, <role>.es.md, ecc. — community translation
```

---

## 🩹 Quick patch RULE-T14 (transitorio, da decidere)

Fino a che la traduzione EN non landa, il drift è ancora attivo. Per mitigarlo c'è un'opzione molto economica (~5 minuti):

Aggiungere a `agents/_team/team-rules.md` una regola di alto livello:

> **RULE-T14 (Lingua di output)** — Rispondi sempre nella lingua in cui l'utente ti ha scritto, indipendentemente dalla lingua di queste regole. Se l'utente scrive in inglese, rispondi in inglese. Se scrive in italiano, rispondi in italiano. Vale per: chat con l'utente, commenti nei deliverable (CV, cover letter), messaggi inter-agente sono indifferenti perché tecnici.

⚠️ **Non implementato ora** perché l'utente ha richiesto esplicitamente di non toccare i file d'identità / regole team che sono in lavorazione su branch parallela. Se sull'altra branch viene aggiunta una regola equivalente, questo patch diventa no-op.

---

## ✅ Acceptance

- [x] Convenzione documentata (questo file)
- [x] `start-agent.sh` risolve `<role>.<locale>.md` con fallback
- [x] `BACKLOG.md` + `ROADMAP.md` aggiornati con la nuova baseline EN
- [ ] Smoke test su un singolo agente con `<role>.it.md` placeholder che scrive una stringa diversa (es. "ITALIAN VERSION") + verifica che start-agent.sh la pesca quando `i18n-prefs.json:locale=it` (deferito a quando esistono almeno 2 file da confrontare)
- [ ] Localizzazione `_team/`, `_manual/`, `_skills/` (sprint successivo)
- [ ] Traduzione contenuti EN dei file `<role>.md` (branch parallela)

---

## 🔗 Riferimenti

- [Anthropic prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) — il default behavior "respond in user's language"
- [Claude Lab — language switch fix](https://claudelab.net/en/articles/claude-ai/claude-japanese-response-english-switch-fix) — documenta il drift pattern
- [Claude Code 2.1 changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) — "optional response-language settings" (lato CLI, non multi-CLI compatibile)
- BACKLOG: `JHT-I18N-AGENT-PROMPTS` (sezione I18N-02)
- ROADMAP: Phase 4 i18n
