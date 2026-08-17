---
name: cloud-push-quarantine
description: A felhőpush szerveres elutasítása után elkülönített sorok vizsgálata és helyreállítása a tartalmuk felfedése nélkül. Akkor használd, ha a sync-health push_quarantine hibát jelez.
allowed-tools: Bash(jht cloud quarantine *)
---

# cloud-push-quarantine — vizsgálat, újrapróbálás, lezárás

A push továbbengedi az érvényes adatokat, az elutasított sorról pedig csak
biztonságos metaadatot tárol: tábla/típus, átlátszatlan azonosító, tisztított
ok, próbálkozások és időbélyegek. A forrássort soha ne kérd és ne írd ki.

1. Vizsgáld meg: `jht cloud quarantine list`. Csak a darabszámot, táblát,
   átlátszatlan azonosítót, okkódot, próbálkozásokat és időbélyegeket jelentsd.
2. A helyi okot a felelős workflow-val javítsd. Ne szerkeszd kézzel a
   `jobs.db`-t, és ne készíts tábla- vagy hibakód-specifikus kivételt.
3. Próbáld újra: `jht cloud quarantine retry <opaque-id>`. Ez a kanonikus
   cloud writert használja. Olvasd el az eredményt, majd listázd újra: a siker
   állapota `resolved`.
4. A `jht cloud quarantine resolve <opaque-id> --confirm` csak akkor használható,
   ha ellenőrizted, hogy a helyi sort szándékosan törölték vagy lecserélték, és
   nem kell retry. Az audit-előzmény megmarad.

A `retry all` csak közös ok javítása és minden felsorolt tábla ellenőrzése után
engedélyezett. Bodyt, címet, útvonalat, user ID-t, szerverrészletet vagy
hitelesítő adatot ne másolj chatbe, logba vagy logbookba.
