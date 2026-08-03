<!-- @translation: pt, ai-translated 2026-08-03 -->
---
name: captain-diary
description: "Diário de passagem de testemunho diário para o Capitano. O Capitano é reiniciado com frequência (context-refresh, nova janela de trabalho, reboot) e de outra forma perde as lições de pacing arduamente conquistadas ao longo do dia — repetindo os mesmos erros (p. ex. 3 Scout de uma vez → um pico impossível de travar → 5 h em marcha lenta para pagar a dívida). No arranque, lê as notas do dia ANTERIOR (handoff) e ACRESCENTA uma nota de uma linha sempre que acontecer algo significativo durante o dia (uma decisão de escalamento, um pico, um kill, uma lição). Um ficheiro append-only por dia."
allowed-tools: Bash(python3 /app/shared/skills/captain_diary.py *)
---

# captain-diary — a passagem de testemunho entre Capitanos

Um ficheiro por dia em `$JHT_HOME/logs/captain-diary-YYYY-MM-DD.md`, append-only.
A sua função é impedir-te de **recomeçar do zero a cada reinício**: as lições de
pacing de hoje são entregues ao Capitano de amanhã.

## Ao acordar (SEMPRE, antes de trabalhar)

Lê as notas deixadas pelo Capitano do dia anterior:

```bash
python3 /app/shared/skills/captain_diary.py handoff
```

Imprime as notas de **ontem** (ou as do último dia trabalhado) mais o que já
esteja registado **hoje**. Herdas as lições → **não repitas os mesmos erros**.
Se não houver nada, és o primeiro: começa a registar.

## Durante o dia — regista os eventos SIGNIFICATIVOS

Uma linha, sempre que acontecer algo que traga uma lição. NÃO um diário de tudo:
apenas aquilo de que o Capitano de amanhã precisaria.

```bash
python3 /app/shared/skills/captain_diary.py add "20:05 — 3 Scout de uma vez: pico impossível \
de travar em 15 min, 5 h em marcha lenta para pagar a dívida. Lição: máx. 1 Scout e depois \
30 min de observação (C-02)."
```

O que vale a pena registar:
- decisões de escalamento que correram mal (ou bem) — quantos workers, que throttle, o que aconteceu;
- um pico que não conseguiste travar e como recuperaste dele;
- um kill e porquê;
- um padrão que emergiu (p. ex. "o Scout no site X consome o dobro");
- tudo o que, se soubesses amanhã, evitaria um erro.

## Rever apenas o dia de hoje

```bash
python3 /app/shared/skills/captain_diary.py today
```

## Regra

- O diário é o **testemunho**: lê-o no arranque, alimenta-o ao longo do dia.
- As notas devem ser **curtas e acionáveis** (um facto + a lição), não um log prolixo.
- O timestamp é acrescentado pela ferramenta: tu escreves apenas o facto e a lição.
