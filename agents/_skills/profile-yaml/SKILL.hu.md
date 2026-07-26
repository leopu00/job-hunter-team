<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: profile-yaml
description: "Maintain `$JHT_HOME/profile/candidate_profile.yml` — the structured candidate data the entire team consumes. The frontend polls this file every ~2s; an invalid YAML makes the user's left panel go silently blank. Owned by the Assistente. Use this skill on EVERY new piece of information from the user (text or uploaded file): write incrementally, validate immediately, talk to the user only after the validator says VALID_PROFILE. Also covers `ready.flag` (the unlock for the \"Vai alla dashboard\" button) with its strict 3-step verify-then-announce protocol."
allowed-tools: Bash(jht profile validate *), Bash(python3 *), Bash(mkdir -p *), Bash(date *), Bash(test *), Bash(rm -f *)
---

# profile-yaml — az egyetlen igazsagforras a jeloltrol

A csapat minden CV-hez, minden pontszamhoz, minden illesztesi donteshez a `candidate_profile.yml` fajlt olvassa. Ha pontosan tartod, a rendszer tobbi resze mukodik; ha hagyod elavulni, a Writers steril CV-ket keszit, a Scorer pedig rosszul ertekeli a poziciokat.

## Utvonal & tulajdonjog

| Utvonal                                       | Ki irja              | Ki olvassa               |
|-----------------------------------------------|----------------------|--------------------------|
| `$JHT_HOME/profile/candidate_profile.yml`     | **Assistente** (te), Capitano, felhasznalo a webes feluleten keresztul | az osszes tobbi agens (csak olvasas — T10) |
| `$JHT_HOME/profile/ready.flag`                | **Assistente** (te) | az iranyitopult CTA kapuja |

Hozd letre a konyvtarat, ha nem letezik:
```bash
mkdir -p "$JHT_HOME/profile"
```

## Elo frissites — inkrementalis, MINDEN relevans bemenet utan

A frontend ~2 masodpercenkent lekerdezi a fajlt. Ne vard meg a beszolgetes veget; **minden alkalommal, amikor a felhasznalo uj adatot ad, ird be most**.

- "Mario vagyok" → ird be a `name: Mario` azonnal.
- "szakacs allast keresek" → frissitsd a `target_role: cuoco` azonnal.
- tapasztalati reszleteket tartalmazo feltoltott fajl → a Read utan frissitsd az **osszes** mezot egyetlen Write-ban.

Minden uj adat = egy `Write` vagy `Edit` a fajlon. Aztan validald. Aztan folytasd a beszelgetest.

## Kotelezo validalas MINDEN write/edit utan

Validald a **kanonikus sema** ellen (nem csak "parsolhato-e a YAML"): lasd a
[`profile-schema`](../profile-schema/SKILL.md) skillt a teljes semahoz.

```bash
jht profile validate
# kozvetlen fallback:
# python3 /app/shared/skills/validate_profile.py "$JHT_HOME/profile/candidate_profile.yml"
```

`VALID_PROFILE` → folytasd. `INVALID_PROFILE` → olvasd el az `ERROR:` sorokat (mezo + ok),
javitsd az adott mezot, validald ujra. A `WARN:` sorok (legacy kulcsok, pl. `languages[].name`
`language` helyett) nem blokkolo jeleguek, de javitsd oket, amikor azt a szekciot szerkeszted.

**NE folytasd a beszelgetest a felhasznaloval, amig `VALID_PROFILE` nem lesz.** Egy hibas profil
torli az egesz bal panelt; a felhasznalo azt gondolja, hogy az alkalmazas osszeomlott.

Ha elfelejtetted hozzaadni a validalasi lepest, biztos lehetsz benne, hogy a fajl hibas — nincs "valoszinuleg rendben". Mindig futtasd le.

## YAML biztonsagi szabalyok

A frontend parsere szigoru. Ot szabaly, ami minden eddig tapasztalt problemat megakadalyoz:

1. **Blokk skalar (`|-` vagy `>-`) minden 60 karakternel hosszabb szoveghez** — leirasok, osszefoglalok, szabad jegyzetek, erossegek. Az inline stringek vesszoknel, kettopontokon, idezojelenel, sortoreseknel, zarojeleknel tornek.
   ```yaml
   summary: |-
     Itt irhatsz hosszu szoveget, meg vesszokkel, kettospontokkal, aposztroffal,
     sortoresekkel, zarojelekkel is: a parser ugy veszi, ahogy van.
   ```
2. **Idezd az inline stringeket specialis karakterekkel** — ha egy stringet inline kell tartanod es tartalmazza a `"`, `:`, `#`, `&`, `*`, `>`, `|`, `%`, `@` karaktereket, tedd dupla idezojel koze (`"…"`) vagy valts blokk skalarara.
3. **Szokoz minden `:` utan** — `role: Senior` ✅ · `role:Senior` ❌.
4. **Behuzas 2 szokozzel, soha tabulatorral** — a listajelek ugyanabban az oszlopban vannak behuzva, mint a szulo elso tartalmi karaktere.
5. **Nincs hosszu gondolatjel / tipografiai idezojelek** — rich-text szerkesztokbol valo beillesztes `—`, `"`, `"` karaktereket injektal. Csereld egyszerubb `-`, `"` karakterekre, vagy hasznalj blokk skalart.

## Minimum sema (az also hatar)

A frontendnek van egy fallbackje, ami feloldja a "Vai alla dashboard" gombot, ha ezek a mezok jelen vannak + nem uresek (igy a felhasznalo tovabblephet, meg mielott letrehoznad a `ready.flag`-et). Toltsd ki mindet:

```yaml
name: <Vezeteknev Keresztnev>
target_role: <cel pozicio>
location: <varos vagy terulet>
experience_years: <int>
has_degree: <true|false>
seniority_target: <junior|mid|senior>
industry: <agazat>

skills:
  primary: [...]              # >= 2 bejegyzes
  secondary: [...]

languages:                    # >= 1 bejegyzes
  - language: <nev>
    level: <A1..C2 | native>

candidate:
  name: <ugyanaz, mint fent>
  target_role: <ugyanaz, mint fent>
  contacts:
    email: ...
    phone: ...
    linkedin: ...
    github: ...
  experience:                 # >= 1 bejegyzes, mindegyik company/role/years/summary-val
    - company: ...
      role: ...
      years: ...              # pl. "2022 mar. - folyamatban" — valos idotartamhoz hasznalt
      summary: |-
        ...
  education:                  # >= 1 bejegyzes, mindegyik institution/degree/year-rel
    - institution: ...
      degree: ...
      year: ...

preferences:                  # PONTOS KULCSOK — a frontend pontosan ezeket keresi
  work_mode: <remoto|ibrido|in sede|flessibile>
  work_mode_flexibility: <opcionalis, szabad szoveg>
  relocation: <true|false|"per la giusta posizione">
  salary_annual_eur: <pl. "30-35k" | null>

sector_details:
  <szabad kulcsok, snake_case — lasd lenti szekci>
```

A `preferences.work_mode`, `preferences.relocation`, `preferences.salary_annual_eur` kulcsokat a frontend szo szerint olvassa, hogy kitoltse a "Munkapreferenciak" szekci. Az alternativ nevek (`work_location`, `flexible`, `remote`) megmaradnak, de lathatatlanok a felhasznalo szamara.

Teljes sema + peldak: `docs/examples/candidate_profile.yml.example` a repo gyokereben (dokumentaciohoz, **NE masold az ertekeket** — lasd anti-hallucinacio).

## `sector_details` — szabad kulcsok a felhasznalo agazatahoz

Altalanos kulcs/ertek szekcio, amit a frontend listakent jeleniti meg. A kulcsokat te valasztod a felhasznalo szakmaja alapjan. Valos peldak:

```yaml
# Konyha
sector_details:
  specializzazione: Pasticceria
  brigate: "ristoranti grandi (10+ persone in cucina)"
  patenti: ["HACCP", "antincendio rischio medio"]
  ruolo_attuale: "Capo partita salata"

# Egeszsegugy
sector_details:
  specializzazione_infermieristica: "Area critica"
  iscrizione_albo: "OPI Roma n. 12345"
  reparti: ["Pronto soccorso", "Terapia intensiva"]
  turni_abituali: "notturni + festivi"

# Epitoipar / szereles
sector_details:
  patenti: ["CAP carrello elevatore", "PES/PAV", "patentino ponteggi"]
  specializzazione: "Impianti elettrici industriali"
  anni_cantiere: 12

# Oktatas
sector_details:
  classe_concorso: "A-12 (Italiano, Storia)"
  anni_ruolo: 8
  specializzazione_sostegno: true
```

Szabalyok:
- Kulcsok `snake_case` formatumban, rovidek es olvashatoak.
- Csak valos jelolt-ertekekkel rendelkezo kulcsokat szurj be. Ha nem tudod → hagyd ki (soha `null` / `""`).
- Ertekek: string, szam, boolean, string tomb.
- Agazat nincs a listaban → talald ki a megfelelo kulcsokat magad, annak alapjan, hogy mi fontos az adott szakmaban. Pl. kamionsofori: `patente: CE+CQC`, `anni_alla_guida: 15`, `tratte_abituali: [...]`.

## `ready.flag` — "Vai alla dashboard" feloldasa

A gomb alapertelmezetten le van tiltva. A frontend aktivalja, HA:
- letezik a `$JHT_HOME/profile/ready.flag` (az explicit flag, amit TE hozol letre), **VAGY**
- a backend eszleli, hogy a minimum sema mar teljes (automatikus fallback).

Tehat gyakran a gomb mar feloldott a fallback altal, amikor a profil teljes — **ne jelentsd be a feloldast, ha nem te hoztad letre a flag-et**.

### Mikor hozd letre a flag-et (3 SZIGORU lepes, soha ne ugord at, soha ne valtoztasd a sorrendet)

```bash
# 1. Hozd letre a flag-et UTC idobelyeggel
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$JHT_HOME/profile/ready.flag"

# 2. ELLENORIZD, hogy a fajl tenyleg letezik (csendben meghiusulhat:
#    jogosultsagok, hianyzo konyvtar, lemezkvota stb.)
test -f "$JHT_HOME/profile/ready.flag" && echo FLAG_OK || echo FLAG_MISSING

# 3. CSAK ha a 2. lepes = FLAG_OK → kuld el az uzenetet a chatben.
#    Ha FLAG_MISSING → javitsd (pl. mkdir -p) es ismeteld az 1. lepestol.
#    SOHA ne jelentsd be a feloldast FLAG_OK nelkul az elozo lepesben.
```


### 4. Ertesitsd a Capitanot — innen indul a csapat

Csak `FLAG_OK` utan, es csak egyszer:

```bash
jht-tmux-send CAPITANO "[@assistente -> @capitano] [PROFILO-PRONTO] a jelolt profilja teljes es validalt — a csapat indulhat."
```

A Capitano nem nezi a profilfajlt: amig senki nem szol neki, az elso inditasnal a
felhasznalo egy szinte allo irodat lat. Ez az uzenet a `first-run-burst` skilljenek
kivaltoja (teljes csapat azonnal, a fokozatos felfutas helyett). Nelkule az elso
napon a felhasznalo tiz percenkent lat egy poziciot, es arra jut, hogy az
alkalmazas elromlott.

### A 2. lepes anti-hallucinacioja

Ismert, hogy egy LLM hajlamos azt irni "megcsinaltam X-et", meg akkor is, ha a tool call nem lett kibocsatva. A `test -f` pontosan azert letezik, hogy megallitson, ha kihagytad a letrehozast: latod a `FLAG_MISSING`-et es emlekeztetod magad, hogy menj vissza. **Ne bizz az emlekezesedben, csak a `test -f` kimeneteben.**

### Mikor tavolitsd el a flag-et

Ha a beszolgetes soran kiderul, hogy a blokkolasi checklista egy mezoje hibas vagy hianyzik (pl. a felhasznalo azt mondja "ah nem, az a tapasztalat nem is igazan az enyem volt"):

```bash
rm -f "$JHT_HOME/profile/ready.flag"
```

Es ertesitsd a felhasznalot: "visszaallitottam a gombot varakozasra — tekintsuk at ezt a pontot, mielott tovabblepunk".

### NE hozd letre a flag-et, ha

- az utolso profil validalas `INVALID_PROFILE`-t irt ki (meg egyszer is az utolso Write utan);
- hianyzik: nev, cel pozicio, varos, tapasztalati evek, email;
- hianyzik: kepessegek (≥2), nyelvek (≥1), tapasztalatok (≥1), vegzettsegek (≥1).

## ⚠️ Anti-hallucinacio — a kritikus szabaly

**SOHA ne olvasd a `docs/examples/candidate_profile.yml.example` vagy `docs/examples/candidate_profile.hr.yml.example` fajlt ertekforrasnak.** Ezek a fajlok a *strukturat* dokumentaljak, nem a jeloltet. Ha elolvasod oket, kockaztatod, hogy "Mario Rossi" / "mario.rossi@example.com" kerul a valos profilba.

KIZAROLAG ezt hasznald:
- amit a felhasznalo mondott neked a chatben
- amit egy CV-bol / feltoltott fajlbol nyertel ki

Ha nem ismersz egy mezot: **hagyd uresen `""` vagy hagyd ki**, soha ne talalj ki hihetoe erteket.

## Anti-patternek

- ❌ A profilt a sajat cwd `$JHT_AGENT_DIR` konyvtarba irni a `$JHT_HOME/profile/` helyett — a frontend nem talalja meg.
- ❌ A validalast kihagyni "hiszen csak egy kis modositas volt" — minden Write elronthatja a YAML-t, mindig.
- ❌ YAML / JSON / utvonalakat mutatni a chatben — a felhasznalo nem technikai (lasd `assistente.md` felhasznaloi nyelv szekcio).
- ❌ Feloldast bejelenteni `test -f` nelkul — ez a klasszikus hallucinacio "megcsinaltam X-et" anelkul, hogy megcsinaltad volna.
- ❌ Append (Edit) meglevo szekciokban a kontextus atnezese nelkul — a YAML-t koherensen kell ujrairni, nem osszevisszafoltozni.

## Lasd meg

- `profile-summaries` — a 4 elbeszelo MD, amelyek a YAML-lal parhuzamosan keszulnek.
- `onboarding-flow` — a beszelgetesi protokoll, amely eldonti, mikor mit kell frissiteni.
- `chat-web` — hogyan kommunikald a megerositest a felhasznalonak (1 sor, nincs utvonal, nincs zsargon).
- `agents/_team/team-rules.md` T10 — a profil csak olvashato a tobbi agens szamara, szo szerinti idezes.
