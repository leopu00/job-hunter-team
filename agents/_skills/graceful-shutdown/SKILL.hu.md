<!-- @translation: hu, ai-translated 2026-07-30 -->
---
name: graceful-shutdown
description: Lezárja a munkanapot a felhasználó kérésére. A @utente `[SHUTDOWN]` üzenete indítja el. A felhasználó bezárja az alkalmazást, és minden ügynököt a feladat közepén állítanának le; mielőtt ez megtörténik, mindenkinek fel kell jegyeznie, hol tart, hogy holnap a csapat folytassa és ne elölről kezdje. Állítsd le az ügynököket egyenként, majd hozd létre a flaget, amely engedi az alkalmazást kilépni. SOHA ne használd ezt rutinszerű pacing-döntésekhez — az egész csapatot leállítja.
allowed-tools: Bash(jht-tmux-send *), Bash(node /app/cli/bin/jht.js team *), Bash(touch /jht_home/.shutdown-ready.flag), Bash(python3 /app/shared/skills/captain_diary.py *)
---

# graceful-shutdown — a nap lezárása, amikor a felhasználó kilép

A felhasználó bezárja az alkalmazást. Nélküled az ügynökök munka közben lennének
elvágva: egy Scout egy board-kör közepén, egy Scrittore egy félig megírt
önéletrajzzal. **A te feladatod, hogy senki ne veszítse el azt a pontot, ahol
tartott.**

A játék elküldte neked a `[@utente -> @capitano] [SHUTDOWN] …` üzenetet, és most
**egy flaget vár tőled**: amíg nem hozod létre, az ablak nyitva marad, és mutatja
a felhasználónak, hány ügynök dolgozik még.

## Eljárás

1. **Kérd meg mindenkit, hogy jegyezze fel, hol tart, és álljon le.** Minden élő
   munkamenetnek küldd el:

   ```bash
   jht-tmux-send SCOUT-1 "[@capitano -> @scout-1] [SHUTDOWN] A felhasználó leállítást kért. Írd le a jegyzetfüzetedbe, hol tartasz (utolsó board, utoljára mentett pozíció, mi maradt hátra), majd állj le. Ne kezdj új munkát."
   ```

   Ügynökönként egy sor, a valódi nevével. Aki éppen lemezre ír, befejezi az
   aktuális fájlt: egy írás megszakítása rosszabb, mint néhány másodpercet várni.

2. **Jegyezd fel te magad a napot** a naplóba, hogy a holnapi Capitano fel tudja
   venni a fonalat:

   ```bash
   python3 /app/shared/skills/captain_diary.py append "A felhasználó leállítást kért: <ki mit csinált éppen>"
   ```

3. **Állítsd le az ügynököket**, miután visszaigazoltak (vagy ésszerű várakozás
   után: ne várakoztasd a felhasználót pár percnél tovább egy ügynök miatt, aki
   nem válaszol):

   ```bash
   node /app/cli/bin/jht.js team stop --all
   node /app/cli/bin/jht.js team stop assistente
   ```

4. **Hozd létre a flaget.** Ez az utolsó dolog, amit megteszel: ez mondja meg a
   játéknak, hogy leállíthatja a konténert és kiléphet.

   ```bash
   touch /jht_home/.shutdown-ready.flag
   ```

## Szabályok

- **A flaget MINDIG létre kell hozni**, még akkor is, ha valami rosszul sült el.
  Ha nem hozod létre, a felhasználó egy ablak előtt marad, amely rád vár — és a
  végén erőből fogja bezárni, pontosan azt, amit ez a skill megelőz.
- **Ne alkudozz a leállításról.** A felhasználó döntött: a te dolgod az, hogy
  rendezetté tedd, nem az, hogy vitatkozz vele vagy elhalaszd.
- **Semmi új munka** attól a pillanattól, hogy megkapod a `[SHUTDOWN]` üzenetet:
  semmi spawn, semmi új kör, semmi felskálázás.
- Ha egy ügynök nem válaszol, jegyezd fel a naplóba, és menj tovább: jobb EGY
  ügynök folytatási pontját elveszíteni, mint mindenki leállítását blokkolni.
