<!-- @translation: de, ai-translated 2026-08-03 -->
---
name: resilience
description: "Wenn ein missionskritisches Tool ausfällt, NIEMALS still degradieren oder \"Warteschlange erschöpft\"/new=0 melden. Klassifiziere kaputt-vs-leer und steige dann die Fallback-Leiter hinauf — Auto-Reparatur via jht-install, erneuter Versuch, alternative Methode, als OPEN_UNVERIFIED markieren, Eskalation an den Capitano mit dem exakten Fix. Immer dann verwenden, wenn ein Tool, von dem du abhängst (Browser, linkedin_check, ein Fetch, eine CLI), einen Fehler wirft oder eine Abhängigkeit fehlt."
---

# resilience — bei einem kaputten Tool niemals still aufgeben

## Warum es sie gibt

Ein missionskritisches Tool (die LinkedIn-Verifikation via Playwright) starb, weil eine
Systembibliothek fehlte. Die Agenten meldeten "kann nicht verifizieren" und fielen still auf
"Warteschlange leer" zurück — der Ausfall wurde erst stromabwärts nach Stunden von `new=0` entdeckt.
Diese Skill macht einen Tool-Ausfall **laut und behebbar** statt still und tödlich.

## Die Kernregel

**Ein kaputtes Tool ist KEIN leeres Ergebnis.** Bevor du jemals "Warteschlange erschöpft", `new=0`
oder "nichts zu tun" schreibst, MUSST du das Tool, von dem du abhängst, selbst prüfen. Ist das Tool
kaputt, hast du nicht "keine Arbeit" — du hast **eine Reparatur zu erledigen** oder **eine Eskalation
auszulösen**.

## Die Fallback-Leiter — der Reihe nach hinaufsteigen, bei der ersten erfolgreichen Stufe aufhören

1. **Erkennen & klassifizieren.** Tool mit Exit-Code ungleich null beendet / fehlende Abhängigkeit /
   Ladefehler (`exitCode 127`, `cannot open shared object file`, `command not found`,
   `error while loading shared libraries`) → **BROKEN**. Tool sauber gelaufen und null Elemente
   zurückgegeben → **EMPTY** (echt). Nur EMPTY rechtfertigt ein "keine Arbeit".
2. **Auto-Reparatur.** Stelle die fehlende Abhängigkeit über **`jht-install`** wieder her (der
   kanonische Wrapper — er leitet system/python/node/browser korrekt weiter und nutzt das `sudo apt`,
   das du ohnehin hast). Dann **das ursprüngliche Tool erneut versuchen**.
   *Beispiel:* Der Browser scheitert mit `cannot load libatk-1.0.so.0` → `jht-install` der
   System-Abhängigkeiten des Browsers (`playwright install-deps` / `sudo apt-get install` der
   Bibliothek) → neu starten.
3. **Alternative Methode.** Lässt sich das primäre Tool nicht in-loop reparieren, wechsle die Methode
   bei gleichem Ziel:
   - LinkedIn: nutze den HTTP-Gast-Fetch oder prüfe die Aktualität auf der **kanonischen
     Karriere-/ATS-Seite des Unternehmens** (Greenhouse / Lever / Ashby / Workable). Traue **niemals**
     einem HTTP 200 von LinkedIn — die Authwall liefert auch für geschlossene Stellen eine 200.
4. **Markieren, nicht verwerfen.** Bleibt es unentschieden, lass den Datenzustand **UNVERÄNDERT** und
   tagge ihn mit `OPEN_UNVERIFIED` + einem `NOTE_MISMATCH`. Überschreibe niemals still mit einer
   Vermutung.
5. **Eskalieren (innerhalb der Obergrenze von 2-3 Versuchen, siehe unten).** Tool kaputt und nicht in
   ≤2-3 Anläufen reparierbar → schreibe dem **Capitano** mit dem EXAKTEN Fix: der fehlschlagende
   Befehl, die fehlende Abhängigkeit und die `jht-install`- / Dockerfile-Zeile, die es löst. Dann
   **arbeite über die alternative Methode weiter** (oder wechsle zu einer anderen Quelle) — bleib
   nicht stehen, aber **überschreite auch die Obergrenze nicht**.

## Was das verbietet

- ❌ "Warteschlange erschöpft" / `new=0` / "nichts zu verifizieren" schreiben, wenn die eigentliche
  Ursache ein Tool-Fehler ist.
- ❌ Auf ein bekanntermaßen unzuverlässiges Signal ausweichen (z. B. LinkedIn `200` = "offen") und es
  als verifiziert ausgeben.
- ❌ Einen Blocker melden und dann untätig werden. Melde **und** arbeite über die Alternative weiter.

## Klassifiziere, bevor du "leer" behauptest

Kanonischer Klassifikator — der gemeinsame `tool_health`-Smoke-Test prüft das gesamte kritische Set
in einem Durchgang (`status` OK|BROKEN|UNKNOWN pro Tool, exit 1, wenn eines kaputt ist). Führe ihn
aus, bevor du "keine Arbeit" meldest:

```sh
# Ist ein kritisches Tool BROKEN, hast du KEINE leere Warteschlange — du hast eine Reparatur/Eskalation.
if ! python3 /app/shared/skills/tool_health.py >/tmp/tools_health.json 2>&1; then
  echo "Ein kritisches Tool ist BROKEN -> jht-install + erneuter Versuch -> Alternative -> Eskalation. NICHT 'leer'."
fi
```

Inline-Check pro Tool (wenn du in-loop nur von einem Tool abhängst):

```sh
out=$(JHT_HOME=/jht_home python3 /app/shared/skills/linkedin_check.py "$JOB_ID" 2>&1); rc=$?
if [ "$rc" -ne 0 ] || printf '%s' "$out" | grep -qiE 'libatk|shared librar|exitCode 127|cannot open'; then
  echo "BROKEN -> reparieren + erneut versuchen + Alternative; KEIN echtes EMPTY."
else
  echo "Tool OK -> eine Null hier ist ein echtes EMPTY."
fi
```

## ⛔ Sturheits-Obergrenze — maximal 2-3 Versuche, dann ESKALIEREN (2026-06-26)

Sturheit hat ein **Budget**, sie ist NICHT unendlich. Für eine Quelle/ein Tool, das immer wieder
scheitert, mach **höchstens 2-3 echte Versuche** (z. B. `Reparatur+erneuter Versuch`, dann **EINE**
Alternative) — bau **keinen** Wrapper auf den nächsten und dreh dich nicht dutzendfach im Kreis.
*Genau das war der scout-6-Marathon: 54 LinkedIn-Scrapes + 42 Websuchen + ein maßgeschneiderter
Playwright-Lauf für **3** Stellen, ~308 kT verbrannt.* Die *Resilienz-Leiter* braucht eine
Obergrenze, sonst wird sie zum Token-Grab.

Sind die 2-3 Versuche aufgebraucht:
1. **Stopp bei dieser Quelle** — nicht weiter nachbohren.
2. Lass die Daten auf `OPEN_UNVERIFIED` (niemals mit einer Vermutung überschreiben) **oder** wechsle
   zu einer anderen Quelle/einem anderen Kreis (Round-Robin, nicht immer denselben leersaugen).
3. **Eskaliere an den Capitano** mit der exakten Diagnose (der fehlschlagende Befehl, die fehlende
   Abhängigkeit, die `jht-install`-/Dockerfile-Zeile, die es löst). **Er entscheidet**, ob es sich
   lohnt, weiter zu insistieren, upstream zu reparieren oder diesen Kreis fallen zu lassen.

Missionskritisch (Browser / LinkedIn) = **bis zur Obergrenze** dranbleiben, nicht ewig; und nur aus
offiziellen Quellen. Ein kaputtes Tool bleibt eine **Reparatur/Eskalation**, keine "leere
Warteschlange" — aber die Reparatur kostet höchstens 2-3 Anläufe, und danach entscheidet der
Capitano.
