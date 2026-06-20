# ⏰ P7 — Reset settimanale non rilevato dagli agenti (2026-06-04)

> Finding emerso **dopo** la chiusura della diagnosi P1-P6
> (`2026-06-03-diagnosi-pacing-weekly.md`). Verificato sui dati live della VPS
> beta. È la causa per cui il team **distribuisce il weekly sull'orizzonte
> sbagliato**.

## 🎯 Sintesi in una riga
Il **reset del cap settimanale è cambiato** (rinnovo del ciclo 7-day il **4 giu
00:34 UTC**, nuovo reset **11 giu 00:34** invece del 7 giu), ma **gli agenti non
se ne accorgono**: il loro flusso live (`[BRIDGE TICK]`) contiene solo la
finestra **primary 5h**, e **nessuna regola** rileva il reset weekly. Risultato:
continuano a tarare il pace sul vecchio orizzonte (7 giu) → consumo ~2.5× troppo
veloce → rischio di esaurire il weekly ~4 giorni prima del reset reale.

## 🔬 Le prove (dati live, verificate indipendentemente)

### Il reset settimanale è avvenuto davvero il 4 giu 00:34
Separando i due "binari" di lettura in `sentinel-data.jsonl`:
```
binario VECCHIO ciclo (reset 07/06): weekly 3 → 19, poi CONGELATO a 19, chiuso 4 giu 01:24
binario NUOVO   ciclo (reset 11/06): weekly parte da 0 alle 00:35 e CRESCE pulito
   00:35=0  05:55=1  07:50=8  09:38=10  11:25=16  13:16=19  15:04=23  16:56=27
```
Il binario nuovo **parte da 0 e sale regolarmente** ⟹ è un **reset reale del
contatore weekly**, non rumore. L'oscillazione notturna 7↔11 giu (00:35-01:27)
era solo la transizione (fetch che leggeva a volte il vecchio contatore in
chiusura, a volte il nuovo).

### Il pace è calibrato sul vecchio orizzonte (7 giu)
- Pace osservato nuovo ciclo: **2.53 %/h attivo** (29% in ~11.5h attive).
- Pace necessario per saturare al **7 giu** (vecchio): **2.08 %/h** → combacia.
- Pace necessario per saturare all'**11 giu** (reale): **0.98 %/h** → 2.6× più lento.
- ⟹ il team sta consumando come se la settimana finisse il **7**, non l'11.
- A questo ritmo **satura il weekly ~2.3 giorni-lavoro da ora (≈ 7 giu)** e poi
  resta bloccato/throttlato a 100% per ~4 giorni → spreco della capacità 7→11 giu.

## 👁️ Cosa vedono ADESSO (tick reale ricevuto dalla Sentinella)
```
[BRIDGE TICK] ts=17:36:24 usage=18% proj=70.76% status=SOTTOUTILIZZO reset=21:00 target=7% work_phase=ON
```
Solo la **finestra primary 5h**: `usage`/`proj` primary, `reset=21:00` (reset
**5h**, non settimanale!), `target`, `work_phase`. **Del weekly non c'è traccia.**

Contrasto significativo: alle 17:21 la Sentinella ha correttamente rilevato il
reset **primary** (`RESET SESSIONE usage drop 63→9, >30 punti`). Sa rilevare il
reset 5h — **non** quello settimanale.

## ❓ Perché non vedono il reset settimanale cambiato — 3 cause
1. **Il tick non porta il weekly.** Il canale live trasmette solo la 5h. Il
   `weekly_reset_at` *esiste* in `sentinel-data.jsonl` (il bridge lo scrive, si è
   aggiornato a 11 giu) ma **non viene spinto agli agenti**; vanno letti a mano.
2. **Nessuna regola monitora il weekly.** L'unica detection di reset
   (`usage drop > 30`) è sul **primary**. Il crollo weekly 19→0 (segnale
   inequivocabile) non corrisponde ad alcuna regola.
3. **Modello mentale fisso/sbagliato** (C-09/S-06): usano `0.14% weekly/h`
   (=100%/168h, 24/7) e un `hours_to_weekly_reset` su orizzonte **assunto** →
   restano agganciati al 7 giu. (Già tracciato come Pezzo 2 della diagnosi.)

> Nota: il **bridge** il cambio l'ha recepito (ha aggiornato `weekly_reset_at` e
> abbassato il `target`). Il buco è nella **comunicazione bridge→agenti** e nella
> **detection lato agente**: il dato giusto c'è nel file, ma non arriva dove
> serve e nessuno lo controlla.

## ✅ Cosa DOVREBBERO vedere — 3 azioni
1. **Weekly nel tick.** Aggiungere al `[BRIDGE TICK]` i campi weekly:
   `weekly=NN% weekly_reset=DD/MM HH:MM` accanto al primary, così la Sentinella
   ha entrambi i vincoli a ogni ciclo.
   - File: `.launcher/sentinel-bridge.py`, costruzione del messaggio `[BRIDGE TICK]`
     (`jht_tmux_send(SENTINELLA_SESSION, ...)`); i campi `weekly_usage` /
     `weekly_reset_at` sono già nell'`entry`.
   - Aggiornare il formato documentato in `agents/sentinella/sentinella.md` (riga
     del template `[BRIDGE TICK] ...`).
2. **Regola "WEEKLY RESET DETECTED".** Scatta quando `weekly_usage` cala
   bruscamente **oppure** `weekly_reset_at_unix` salta in avanti di giorni →
   *"ciclo settimanale ripartito, nuovo orizzonte = DD/MM, ricalibra il pace"*.
   È l'analogo della regola che già esiste per il reset primary 5h.
   - File: `agents/sentinella/sentinella.md` (accanto a "SESSION RESET");
     opzionale anche un flag nel sample del bridge per renderlo esplicito.
3. **Orizzonte agganciato al dato reale.** `hours_to_weekly_reset` deve usare il
   `weekly_reset_at_unix` corrente dal bridge, **mai** un valore assunto o
   memorizzato. (Si lega al fix Pezzo 2: rimuovere `0.14%/h` e i numeri
   hardcoded, leggere `weekly_active_hours`/`weekly_remaining_pct` dal bridge.)

## 📌 Impatto e priorità
- **Severità: alta sul pacing settimanale.** Senza detection, ogni rinnovo di
  ciclo weekly che sposta il reset manda fuori-fase il pacing del team finché
  qualcuno non se ne accorge a mano.
- **Mitigante attuale**: il bridge *calcola* il target sul reset giusto, quindi
  il danno è limitato dal target che frena; ma in autonomia Phase 1 (C-07) gli
  agenti modulano col **loro** modello, che resta agganciato all'orizzonte vecchio.
- **Collegamenti**: estende il Pezzo 2 (awareness agenti) della diagnosi
  `2026-06-03-diagnosi-pacing-weekly.md`. Va implementato insieme.

## 🔁 Riproducibilità
```bash
# binari di lettura weekly (reset 7 vs 11 giu) nel tempo
ssh jht-vps "python3 - <<'PY'
import json
from datetime import datetime, timezone
rows=[json.loads(l) for l in open('/root/.jht/logs/sentinel-data.jsonl') if l.strip()]
for r in rows:
    u=r.get('weekly_reset_at_unix')
    d=datetime.fromtimestamp(u,timezone.utc).strftime('%d/%m %H:%M') if u else '?'
    print(r['ts'][:19], 'wk=',r.get('weekly_usage'), 'reset=',d)
PY"
# tick reale ricevuto dalla Sentinella
ssh jht-vps "docker exec jht tmux capture-pane -p -t SENTINELLA | grep 'BRIDGE TICK' | tail -3"
```
