# Throttle floor a 5min + ladder — analisi storica e modifica (2026-06-21)

> Stato: **implementato su dev1** (codice + guida agenti). Deploy = utente (redeploy VPS).
> Trigger: osservazione utente — *"i throttle sotto i 5 minuti non servono a un cazzo"*.
> Verdetto dopo analisi: **per metà giusto** — vedi sotto.

---

## 🎯 L'osservazione di partenza

L'utente nota che il Capitano frena gli agenti con throttle da **120s (2min)**, e in generale
sotto i 5min: *"fai riposare un agente che consuma tantissimo per 2 minuti invece di 1 — non
cambia praticamente un cazzo. Nell'arco di un'ora togli ~20% del consumo, ma in proiezione su
mezz'ora diventa 10% e non si nota."* Proposta: **tagliare i throttle troppo bassi, floor a 5min**,
ladder `5, 10, 15, 20, 25, 30, 40, 50, 60 min`. Richiesta esplicita: **analizzare prima lo storico**
(*"forse mi sbaglio, vediamo come vanno"*) su betaB (Kimi) **e** betaA (Codex).

---

## 🔬 Analisi dello storico (`throttle-events.jsonl`)

Sorgente: `$JHT_HOME/logs/throttle-events.jsonl` su entrambe le VPS. Considerati gli eventi
`event="start"` con `applied_sec>0` (throttle realmente applicati). Script ad-hoc: istogramma
durate + split `source` (`config`=baseline post-azione / `explicit`=Capitano su SFORO) + per-agente.

### betaB (Kimi) — 33 giorni — 4821 throttle (146/giorno), mediana 120s, media 181s

| durata | n | % eventi | ore-totali |
|---|---:|---:|---:|
| <60s | 394 | 8% | 2.5h |
| 60-119s | 1579 | 33% | 26.4h |
| 120-179s | 635 | 13% | 21.3h |
| 180-299s | 1129 | 23% | 74.5h |
| **<5min (totale)** | **3737** | **78%** | **124.7h** |
| ≥5min | 1084 | 22% | 118.3h |

- `source`: **explicit 2991 / config 1830**. Dei <5min: **explicit 2807**, config 930 → i piccoli
  sono soprattutto correzioni SFORO del Capitano = **chatter**.
- Caso estremo: **scorer-5 ha preso 2350 throttle** (mediana 60s, 76% sotto i 5min).

### betaA (Codex) — 18 giorni — 675 throttle (37/giorno), mediana 120s

| durata | n | % eventi |
|---|---:|---:|
| **<5min (totale)** | **581** | **86%** (= 14.3h, 55% dei sec-throttle) |
| ≥5min | 94 | 14% (= 11.8h, 45%) |

- `source`: **config 530 / explicit 145** (regime diverso da betaB: qui i piccoli sono soprattutto
  cooldown baseline post-azione, non SFORO).

---

## ⚖️ Verdetto: l'ipotesi è **per metà giusta**

- ✅ **Vero** che il singolo throttle <5min è una correzione **marginale**, e che il team **ne abusa**
  (chatter, soprattutto il Capitano su Kimi: 2807 explicit <5min; scorer-5 frenato 2350 volte).
- ❌ **Falso** che "non servono a niente": i throttle <5min sono il **78-86% degli eventi** ma pesano
  **~50-55% di TUTTO il tempo-freno** (124.7h su betaB). Non per il singolo, ma perché sono
  **tantissimi**. Tagliarli a secco = **sguinzagliare metà del freno** → consumo su.

**Il vero difetto non è che siano piccoli, è che ne dà mille piccoli invece di pochi grandi.**
La ladder proposta dall'utente risolve proprio questo: un freno **deciso** al posto della raffica
di 120s. E il floor non è "buttar via il freno" — è **spostare la leva**: per spendere il budget
il Capitano non micro-frena, **parallelizza** (più agenti).

---

## 🛠️ La modifica (implementata su dev1)

### Meccanica — il floor è ENFORCED, indipendente dai prompt

1. **`shared/skills/throttle-config.py`** — nuova ladder + `quantize()`:
   ```
   THROTTLE_LADDER = [300, 600, 900, 1200, 1500, 1800, 2400, 3000, 3600]  # 5,10,15,20,25,30,40,50,60 min
   quantize(s): 0→0 | (0..300]→300 (floor) | >=3600→3600 (cap) | else gradino più vicino
   ```
   Applicato in `get_agent` (anche i valori legacy nel `throttle.json` salgono in **lettura**:
   60/120 → 300), in `set_agent`/`bulk-set` (salvi già l'effettivo), nuovo sottocomando CLI
   `quantize`. `dump` mostra l'effettivo.
2. **`agents/_tools/jht-throttle`** — dopo aver risolto `DURATION_SEC` (config o esplicito), lo
   aggancia: `DURATION_SEC=$(throttle-config.py quantize "$DURATION_SEC")`. Copre **entrambi** i
   path: `jht-throttle 120` → 300. `0` resta `0` (fast-path checkpoint per la cadenza).

> Conseguenza: qualunque cosa il Capitano/Sentinella chiedano, il throttle effettivo è
> `0` **oppure** ≥5min sulla ladder. Nessun cambio di prompt è necessario perché il floor funzioni.

### Guida agenti — allineata al floor + nuovo principio

3. **`agents/sentinella/_skills/decision-throttle/SKILL.md`** — riscritta la tabella throttle:
   `≤1.0→0s, 1.0-1.5→5min, 1.5-2.0→10min, 2.0-3.0→20min, >3.0→30min (sali a 60)`. + nota floor +
   **"per consumare di più NON si scende sotto i 5min: la leva è il PARALLELISMO → SCALA UP"**.
4. **`agents/capitano/capitano.md` C-07** — sostituita la "scala continua (30,60,90,120,180,240…)"
   con la ladder a gradini `{0,5,10,…,60}min` + floor + **⚡ principio**: porta prima il throttle a
   `0` (full speed); se già a `0` e sotto `vel_target` → **spawna più agenti** (il throttle pace il
   SINGOLO worker, il NUMERO di agenti regola la PORTATA del team).

### Backlog (passo successivo, NON ora)

5. **`BACKLOG.md` → `[CAPITANO-SPAWN-MODES]`** — col floor, la leva diventa il parallelismo: serve
   una strategia di spawn più ricca del "1 per ruolo". Idea utente: il Capitano sceglie la
   **modalità** (es. batch **3 Scout insieme** per riempire la coda `new`, poi 2 Analisti, ecc.;
   *più agenti = team più efficiente*). Sessione dedicata.

---

## 🧠 Razionale del design (perché il floor "spende meno" è VOLUTO)

L'utente lo conferma: il floor a 5min **deve** ridurre il consumo del singolo agente, proprio per
**costringere il Capitano a parallelizzare**. Non è un rischio, è l'obiettivo. Contesto: gli agenti
sono testati spalmati su ~12h/giorno (8-18) con pause lunghe e finiscono ~2h prima della chiusura —
il budget weekly non è quasi mai il vincolo (`weekly` ~4-8%). Quindi anche se 3 agenti a floor 5min
"non consumano abbastanza", va bene: il Capitano spawna di più, e **più agenti = più efficienza**
(osservazione sperimentale dell'utente). Un throttle è ora `0` (libero) o `≥5min` (frenato): non
esistono vie di mezzo per "spingere un filo di più" un singolo agente → si aggiungono agenti.

---

## 📌 Deploy & follow-up

- **Deploy = utente** (redeploy immagine VPS). La parte meccanica (`throttle-config.py` +
  `jht-throttle`) basta perché il floor scatti; i valori legacy nel `throttle.json` live salgono da
  soli in lettura (nessuna migrazione del config necessaria).
- **i18n follow-up:** le varianti `.it/.de/.fr/.es/.pt/.hu` di `decision-throttle/SKILL` e di
  `capitano.md` (C-07) vanno allineate per i team non-EN. Non blocca il floor (è meccanico).
- **Osservazione futura:** ricontrollare lo storico throttle dopo qualche ciclo — il chatter
  (eventi/giorno, scorer-5-like) dovrebbe crollare e gli spawn aumentare.
