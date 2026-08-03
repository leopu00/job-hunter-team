<!-- @translation: hu, ai-translated 2026-08-03 -->
---
name: game-reply-options
description: "Kínálj 2-5 kontextusfüggő, kattintható válaszgombot a JHT játék chatjében, ha azok tényleg megkönnyítik a felhasználó következő döntését. Csak kicsi, jól körülhatárolt választáshoz használd; minden más esetben válaszolj a szokásos módon a jht-send paranccsal. Soha ne használd ezeket rögzített onboarding-fának."
allowed-tools: Bash(jht-reply-options *)
---

# Generált válaszlehetőségek a játékban

Ha a felhasználó üzenetéből néhány egyértelmű következő lépés adódik, zárd a köröd
egy kérdéssel és 2–5, pontosan arra a kontextusra generált válasszal:

```bash
jht-reply-options --prompt 'Mivel kezdjük?' \
  'Nézzük át a célpozícióimat' 'Nézzük meg a profilom hiányosságait' 'Mutasd a legjobb pozíciókat'
```

A játék ezeket a lehetőségeket gombként jeleníti meg, de a szabad szöveges beírás
végig elérhető marad. A gombra kattintás a gomb szövegét küldi vissza szokásos felhasználói üzenetként.

Szabályok:

- A lehetőségek opcionálisak, az éppen folyó beszélgetéshez igazodnak, és soha nem
  az offline megírt onboardingból másolt szövegek.
- Használj 2–5 tömör, egymást értelmesen kiegészítő lehetőséget. Ne kínálj olyan
  látszatválasztást, amelynek az eredményét nem tudod teljesíteni.
- A `jht-reply-options` az adott kör utolsó válasza. Ne küldj utána `jht-send`
  parancsot, különben a gombok — jogosan — eltűnnének az újabb válasz alatt.
- Nyílt végű kérdésnél vagy közvetlen válasznál a szokásos módon a `jht-send` parancsot használd.
