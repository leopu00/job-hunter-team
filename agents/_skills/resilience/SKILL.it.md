<!-- @translation: it, ai-translated 2026-08-03 -->
---
name: resilience
description: "Quando uno strumento mission-critical si rompe, MAI degradare in silenzio né riportare \"coda esaurita\"/new=0. Classifica rotto-vs-vuoto, poi risali la scala dei fallback — auto-riparazione via jht-install, retry, metodo alternativo, marcatura OPEN_UNVERIFIED, escalation al Capitano con il fix esatto. Usala ogni volta che uno strumento da cui dipendi (browser, linkedin_check, un fetch, una CLI) va in errore o manca una dipendenza."
---

# resilience — mai arrendersi in silenzio davanti a uno strumento rotto

## Perché esiste

Uno strumento mission-critical (la verifica LinkedIn via Playwright) è morto perché mancava una
libreria di sistema. Gli agenti hanno riportato "non riesco a verificare" e sono silenziosamente
ripiegati su "coda vuota" — il guasto è emerso a valle dopo ore di `new=0`. Questa skill rende il
guasto di uno strumento **rumoroso e recuperabile** invece che silenzioso e fatale.

## La regola fondamentale

**Uno strumento rotto NON è un risultato vuoto.** Prima di scrivere "coda esaurita", `new=0` o
"niente da fare", DEVI fare un self-check dello strumento da cui dipendi. Se lo strumento è rotto non
hai "niente da lavorare" — hai **una riparazione da fare** o **un'escalation da alzare**.

## La scala dei fallback — risalila in ordine, fermati al primo gradino che riesce

1. **Rileva e classifica.** Strumento uscito con codice diverso da zero / dipendenza mancante /
   errore di caricamento (`exitCode 127`, `cannot open shared object file`, `command not found`,
   `error while loading shared libraries`) → **BROKEN**. Strumento eseguito pulito e con zero
   elementi restituiti → **EMPTY** (genuino). Solo EMPTY giustifica un "niente da lavorare".
2. **Auto-riparazione.** Ripristina la dipendenza mancante con **`jht-install`** (il wrapper
   canonico — instrada correttamente system/python/node/browser e usa il `sudo apt` che hai già).
   Poi **riprova lo strumento originale**.
   *Esempio:* il browser fallisce con `cannot load libatk-1.0.so.0` → `jht-install` delle dipendenze
   di sistema del browser (`playwright install-deps` / `sudo apt-get install` della libreria) →
   rilancia.
3. **Metodo alternativo.** Se lo strumento primario non è riparabile in-loop, cambia metodo puntando
   allo stesso obiettivo:
   - LinkedIn: usa il fetch HTTP da ospite, oppure verifica che l'annuncio sia vivo sulla **pagina
     careers/ATS canonica dell'azienda** (Greenhouse / Lever / Ashby / Workable). **Mai** fidarsi di
     un HTTP 200 di LinkedIn — l'authwall restituisce 200 anche per annunci chiusi.
4. **Marca, non scartare.** Se resta inconcludente, lascia lo stato del dato **INVARIATO** e
   taggalo `OPEN_UNVERIFIED` + un `NOTE_MISMATCH`. Mai sovrascrivere in silenzio con un'ipotesi.
5. **Escalation (entro il tetto dei 2-3 tentativi, vedi sotto).** Strumento rotto e non riparabile
   in ≤2-3 colpi → manda un messaggio al **Capitano** con il fix ESATTO: il comando che fallisce, la
   dipendenza mancante e la riga `jht-install` / Dockerfile che lo risolve. Poi **continua a lavorare
   con il metodo alternativo** (o passa a un'altra fonte) — non fermarti, ma **non sforare nemmeno il
   tetto**.

## Cosa vieta

- ❌ Scrivere "coda esaurita" / `new=0` / "niente da verificare" quando la causa reale è l'errore di
  uno strumento.
- ❌ Ripiegare su un segnale notoriamente inaffidabile (es. LinkedIn `200` = "aperto") e spacciarlo
  per verificato.
- ❌ Segnalare un blocco e poi restare fermo. Segnala **e** continua a lavorare con l'alternativa.

## Classifica prima di dichiarare "vuoto"

Classificatore canonico — lo smoke-test condiviso `tool_health` controlla in un colpo solo l'intero
insieme critico (`status` OK|BROKEN|UNKNOWN per strumento, exit 1 se qualcuno è rotto). Eseguilo
prima di riportare "niente da lavorare":

```sh
# Se uno strumento critico è BROKEN, NON hai una coda vuota — hai una riparazione/escalation.
if ! python3 /app/shared/skills/tool_health.py >/tmp/tools_health.json 2>&1; then
  echo "Uno strumento critico è BROKEN -> jht-install + retry -> alternativa -> escalation. NON 'vuoto'."
fi
```

Controllo inline per singolo strumento (quando in-loop dipendi da uno solo):

```sh
out=$(JHT_HOME=/jht_home python3 /app/shared/skills/linkedin_check.py "$JOB_ID" 2>&1); rc=$?
if [ "$rc" -ne 0 ] || printf '%s' "$out" | grep -qiE 'libatk|shared librar|exitCode 127|cannot open'; then
  echo "BROKEN -> ripara + retry + alternativa; NON un EMPTY genuino."
else
  echo "strumento OK -> uno zero qui è un EMPTY genuino."
fi
```

## ⛔ Tetto alla testardaggine — massimo 2-3 tentativi, poi ESCALATION (2026-06-26)

La testardaggine ha un **budget**, NON è infinita. Per una fonte/strumento che continua a fallire fai
**al massimo 2-3 tentativi reali** (es. `riparazione+retry`, poi **UNA** alternativa) — **non**
costruire wrapper sopra wrapper e non ciclare decine di volte. *È esattamente quello che è successo
nella maratona di scout-6: 54 scraping LinkedIn + 42 ricerche web + un playwright fatto su misura per
**3** inserimenti, ~308 kT bruciati.* La *scala della resilienza* ha bisogno di un tetto, altrimenti
diventa un pozzo di token.

Una volta esauriti i 2-3 tentativi:
1. **Fermati su quella fonte** — non insistere oltre.
2. Lascia il dato `OPEN_UNVERIFIED` (mai sovrascrivere con un'ipotesi) **oppure** passa a un'altra
   fonte/cerchia (round-robin, non prosciugare sempre la stessa).
3. **Fai escalation al Capitano** con la diagnosi esatta (il comando che fallisce, la dipendenza
   mancante, la riga `jht-install`/Dockerfile che lo risolve). **Decide lui** se vale la pena
   insistere, riparare a monte o abbandonare quella cerchia.

Mission-critical (browser / LinkedIn) = insisti **fino al tetto**, non all'infinito; e solo da fonti
ufficiali. Uno strumento rotto resta una **riparazione/escalation**, non una "coda vuota" — ma la
riparazione costa al massimo 2-3 colpi, e dopo decide il Capitano.
