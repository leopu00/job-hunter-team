<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: profile-summaries
description: Write the 4 narrative Markdown summaries under `$JHT_HOME/profile/summaries/` that complement the structured YAML. The Writers downstream NEED these — a YAML alone produces sterile CVs because it has no voice, no narrative, no positioning. Owned by the Assistente. Filenames are FIXED (the frontend ignores anything else); always written in the user's first person ("sono uno sviluppatore…"); always rewritten in full (Write, not Edit append) — these are snapshots of the present, not append-only logs.
allowed-tools: Bash(mkdir -p *)
---

# profile-summaries — a jelolt hangja a lemezen

A strukturalt YAML kituno filterekhez es matchekhez, de semmit nem mond arrol, *ki* a jelolt. A `summaries/` konyvtarban levo 4 MD fajl hordozza azt a narrativat, amire az Iroknak szukseguk van ahhoz, hogy az oneletrajzok emberien szoljanak, ne pedig egy pipalo lista legyen beloluk.

## A 4 fajl (fajlnevek FIXEK)

| Fajl             | A felhasznalonak mutatott UI-cim | Mit tartalmaz                                                               | Hosszlimit  |
|------------------|----------------------------------|-----------------------------------------------------------------------------|-------------|
| `about.md`       | **Ki vagy**                       | Szemelyes osszefoglalo: jelenlegi/celzott szerep, evek, agazat, megkulonbozteto jegy | ~400 karakter |
| `preferences.md` | **Elmeselt preferenciák**         | Munkavegzes modja, koltozkodesi keszseg, javadalmazas, munkaidok, munkakornyzet | ~400 karakter |
| `goals.md`       | **Celok es alommunka**            | Mit keres a kovetkezo 1–3 evben, alom-kontextus/vallalat                    | ~500 karakter |
| `strengths.md`   | **Erossegek**                     | 2–4 konkret minoseg, mindegyikhez rovid peldaval                             | ~500 karakter |

Utvonal: `$JHT_HOME/profile/summaries/<file>.md`. Hozd letre a konyvtarat, ha hianyzik:
```bash
mkdir -p "$JHT_HOME/profile/summaries"
```

Az ettol eltero fajlnevek (pl. `about-mario.md`, `goals_v2.md`) a frontend altal **csendben figyelmen kivul maradnak**.

## Stilusszabalyok (kotelezo ervenyu)

- **Egyszeru Markdown**: bekezdesek ures sorral elvalasztva, `**felkover**` kiemeleshez, listak csak ha javitjak az olvashatosagot.
- **Nincs tablazat, nincs `#` fejlec** — ezek az MD-k mar felcimkezett UI-kartyakban elnek.
- **Hossz**: tartsd be a limitet. Nincsenek szovegfalak.
- **A felhasznalo elso szemelye**: `"fejleszto vagyok…"`, `"tavmunkat preferalom…"`. Soha harmadik szemely (`"Mario egy…"`).
- **Hangnem**: termeszetes, mintha a felhasznalo egy iparagi szakerto baratjanak beszelne onmagarol.
- **Soha utvonalak / fajlnevek / szakzsargon** a szovegben — a felhasznalo az „osszefoglalot" olvassa, nem az „about.md"-t.

## Frissitesi szabaly — teljes ujrairas, soha nem hozzafuzes

Amikor olyan informacio erkezik, ami megvaltoztatja egy letezo MD ertelmet, **ird ujra a fajlt elejétol** (`Write` eszkoz, NEM `Edit` append). Ezek a jelen pillanatfelvételei, nem kronologikus naplok. Egy append kockaztatja, hogy elavult bekezdesek az uj mellett maradnak.

## Kivaltok — mikor irjuk meg az egyes fajlokat

| Fajl              | Mikor ird meg eloszor / frissitsd                                                                                                                                                                      |
|-------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `about.md`        | Megvan a szerep + evek + ≥1 tapasztalat. Ird ujra minden alkalommal, amikor valami lenyeges valtozik (szerep, szenioritás, agazat).                                                                     |
| `preferences.md`  | A felhaszaloval megbeszelted legalabb az egyiket: munkavegzes modja, koltozes, javadalmazas. Frissitsd minden alkalommal, amikor ezek kozul barmelyik valtozik.                                          |
| `goals.md`        | A felhasznalo elmeselte torekvesei / idealis kontextusa / alommunkajat (akar reszlegesen). Ne eroltesd: ha nem jon spontan, **kerdezd meg egyszer** „van olyan kontextus vagy vallalat, ahol kulonosen jol latnad magad?". |
| `strengths.md`    | Osszegyujtottel **2+ relevans tapasztalatot vagy projektet**. Vonj ki 2–4 ismetlodo minoseget a mintabol.                                                                                               |

## Boot-szabaly — elso feltoltott oneletrajz

Amikor a felhasznalo oneletrajzot tolt fel, a YAML kitoltese utan MINIMUM **`about.md` + `strengths.md`** fajlt irj meg ugyanabban a korben. Eleg adatod van (szerep, evek, tapasztalatok, kompetenciak, hangnem) ahhoz, hogy azonnal megtedd; ne halaszd el. Ennek a lepesnek a kihagyasa azt jelenti, hogy a downstream CV-iro soha nem fogja megkapni a jelolt narrativ kontextusat → steril oneletrajzokat fog produkalni. Te vagy az egyetlen pont, ahol ez a narrativa rogzitesre kerul.

A `preferences.md` es a `goals.md` a kovetkezo korokban erkezik (a specifikus megbeszeles utan).

## Peldak

### `about.md` (tech agazat)
```markdown
Sono uno sviluppatore backend con 4 anni di esperienza in **Python** e
sistemi distribuiti, ultimamente concentrato su pipeline ETL e API
ad alto throughput. Vengo da un percorso ibrido tra **data engineering**
e backend "classico", e mi muovo bene quando il problema sta nel mezzo:
modellazione del dato + servizio che lo espone.

Cerco un ruolo backend o data senior in cui poter portare ownership
end-to-end del servizio, non solo "ticket".
```

### `strengths.md` (nem tech agazat, pelda konyha)
```markdown
**Resistenza nei picchi.** Ho gestito brigata di 12 persone in un
ristorante con 200 coperti la sera: ho imparato a tenere ritmo e
qualità anche quando si fa caldo davvero.

**Costo materia prima.** Negli ultimi 3 anni ho ridotto il food cost
di partita salata dal 34% al 28% lavorando sul menu e sul rapporto
con i fornitori, senza toccare la qualità.

**Team mentoring.** Ho formato 2 sous-chef che ora gestiscono
autonomamente le loro brigate.
```

## Anti-mintak

- ❌ Harmadik szemelyben irni („Mario egy fejleszto…") — a frontend a szoveget a jelolt kozvetlen hangjakeppen jeleníti meg, a harmadik szemely elidegenitoen hangzik.
- ❌ Append `Edit`-tel `Write` helyett — ket egymasnak ellentmondo bevezeto kerul ugyanabba a fajlba.
- ❌ Tablazatok / `#` fejlecek / terjengos szamozott listak — a UI-kartyanak mar megvan a sajat kerete.
- ❌ `about.md` / `strengths.md` kihagyasa CV feltoltes utan „mert ugyis benne van a YAML-ben" — a YAML-nek nincs hangja, az Irok steril oneletrajzokat produkálnak.
- ❌ Utvonalak vagy fajlnevek beszurasa (`/jht_home/profile/summaries/about.md`) a szovegbe — a felhasznalo nem tudja, mik ezek.
- ❌ A hosszlimiten tul irni — a UI-kartya levagja / vizszintesen gorget, az uzenet elveszik.

## Lasd meg

- `profile-yaml` — testver-skill: strukturalt adatok, amelyek parhuzamosan frissulnek ezekkel az MD-kkel.
- `onboarding-flow` — mikor gyujtjuk ossze a beszelgetes soran az adatokat, amelyek ezeket az MD-ket taplaljak.
- `agents/scrittore/scrittore.md` — a downstream agens, aki ezeket az MD-ket olvassa, hogy hangvétellel rendelkezo oneletrajzokat irjon.
