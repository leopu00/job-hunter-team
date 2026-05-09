# 🧪 Sperimentazione JHT — panoramica 15 giorni (2026-04-25 → 2026-05-09)

Report HTML "meta" che aggrega 15 giorni di sperimentazione del team
JHT su tre provider:

- 🟠 **Kimi K2** (subscription Moonshot) — settimana intera fino
  all'esaurimento weekly (5 mag)
- 🟣 **Claude Opus** (subscription Anthropic) — solo test breve
  26 aprile (13 finestre)
- 🟢 **Codex GPT-5.5** (subscription OpenAI) — settimana intera fino
  all'esaurimento weekly (9 mag)

## 📂 Contenuto

- `index.html` — entry point con 8 chart interattivi:
  1. KPI top (giorni, finestre, positions, token, peak medio, dottore)
  2. 🔍 Positions trovate per giorno (bar)
  3. ✍️ Applications scritte per giorno (bar)
  4. 🪟 Finestre rate-limit attraversate (scatter, colorate per provider)
  5. 🎯 Score distribution (bar orizzontale)
  6. 📝 Critic distribution (bar orizzontale)
  7. 🤖 Funnel pipeline (scout → ready)
  8. 🔢 Token cumulativi per agente
  9. 📬 Bridge mailbox summary
  10. 🩺 Doctor stats summary
  + sezione finale "Esiti chiave" (cosa e' andato bene / male / da cambiare)

## 🗂️ JSON snapshot

- `windows.json` — 58 finestre rate-limit con session_id, provider,
  open/close, peak, durata.
- `db.json` — aggregati DB (positions/scores/applications counts per
  status/score-bucket/critic-bucket/scout/scrittore + per-day series).
- `by-agent.json` — serie temporale token cumulativa, 17 agenti, 14gg.
- `doctor.json` — riassunto doctor (events, spawns, rounds, ping,
  restart, diagnosi per status).
- `mailbox.json` — riassunto bridge mailbox (delivered vs recovered).

## 🔑 Numeri chiave (snapshot al 9 mag 16:44 UTC)

- 58 finestre rate-budget reali (≥5 sample sentinel)
- 379 positions trovate (302 da scout-1)
- 288 scored (76 a 70-79, 33 a 80+)
- 244 applications (214 draft, 29 approved, 1 ready)
- 164.8 MT token consumati totali in 14 giorni
- Dottore: 50 round, 507 ping, 6 restart, 95% diagnosi alive
- Mailbox: 64 entries, 21 recuperate via mailbox (33% drop rate
  prima del fix)

## 🎯 Esiti

**✅ Funzionato**: scouting consistente (3 positions/h per 24h),
multi-provider senza modifiche profonde, dottore stabile (0 crash),
bridge mailbox recupera 33% dei verdetti.

**⚠️ Problemi**: oscillazione control-loop (4 finestre Codex sotto 70%),
bottleneck critic→approved (214 application restano draft), capitano
busy = bridge muto (rc=3 frequente).

**❌ Hard limits**: weekly limit hit due volte (Kimi 5 mag, Codex 9 mag).
4 giorni di stop forzato per ciascun reset weekly.

**🔧 Da cambiare**: rivedere critic gate (5.5 invece di 5),
auto-promotion 40-49, damping piu' aggressivo (15% invece di 25%),
investigare tabella companies vuota.

Vedi anche il pendant markdown in
[`docs/internal/2026-05-09-experimentation-overview-15d.md`](../../internal/2026-05-09-experimentation-overview-15d.md)
per i numeri puri grep-abili.

## ✅ Privacy

Tutti i JSON contengono solo metriche aggregate, conteggi per
status/buckets, nomi ruolo. Zero titoli posizioni, zero aziende,
zero PII personale. Audit verificato.
