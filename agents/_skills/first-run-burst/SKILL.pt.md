<!-- @translation: pt, ai-translated 2026-08-03 -->
---
name: first-run-burst
description: "A primeira meia hora em que um utilizador acabado de chegar vê a equipa a trabalhar. Abre esta skill quando receberes `[PROFILO-PRONTO]` do Assistente, ou ao acordar se o `first_run.py status` reportar a fase `awaiting_profile` / `burst`. Derroga a calibração gradual (C-02) apenas para a primeira janela, e define o sucesso como posições COM PONTUAÇÃO no ecrã — não como posições encontradas."
allowed-tools: Bash(python3 /app/shared/skills/first_run.py *), Bash(python3 /app/shared/skills/plan_registry.py *), Bash(python3 /app/shared/skills/db_query.py *), Bash(/app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/throttle-config.py *), Bash(jht-tmux-send *), Bash(jht-send *)
---

# first-run-burst — a demonstração de que depende o utilizador ficar

Um utilizador novo termina o setup, liga a equipa e fica a ver. Dez minutos depois viu aparecer
**uma** posição em bruto. Nada lhe permite distinguir uma equipa que se está a dosear de uma
aplicação avariada — por isso conclui que está avariada, e não está a raciocinar mal.

A tua calibração normal (C-02: um worker, observar 30 minutos, subir um degrau) é a regra certa **em
regime estabelecido**, onde errar custa uma janela de orçamento. No primeiro arranque custa o
utilizador. Esta skill é a exceção documentada, e vale **apenas para a primeira janela**.

## Trigger

- `[@assistente -> @capitano] [PROFILO-PRONTO]` — o perfil acabou de ficar utilizável
- ao acordar, se o `python3 /app/shared/skills/first_run.py status` reportar
  `phase: awaiting_profile` ou `phase: burst`

## O que significa ter sucesso aqui

**Posições com pontuação, no ecrã.** Não posições encontradas. Uma execução que recolhe 50 ofertas e
pontua 3 delas (medido, 2026-07-26) não produziu quase nada que o utilizador possa ver: a shortlist
é o produto, o scraping é canalização. Tudo o que se segue decorre desta única frase.

## O procedimento

**1. Abre o burst e lê o roster.**

```bash
python3 /app/shared/skills/first_run.py begin-burst
```

Devolve-te o `roster` (quantos Scout / Analista / Scorer), o `scout_cap_first_pass` e o
`target_scored`, todos derivados da subscrição que o utilizador declarou durante o setup. Se
responder `piano non dichiarato` (plano não declarado), o passo de setup está incompleto: di-lo ao
utilizador no chat e para — **não adivinhes** um roster, uma sobrestimativa queima-lhe a janela logo
no primeiro dia.

**2. Faz spawn de todo o roster, escalonado ~60 segundos.**

Não um worker de dez em dez minutos: toda a formação, uma a seguir à outra, sempre através do
`start-agent.sh` como habitualmente (C-03). Esta é a exceção deliberada a C-02.

**3. Não esperes por filas cheias para ligar o downstream.**

Faz spawn do Analista assim que exista **uma** posição, e do Scorer assim que **uma** posição esteja
checked. O hábito de "primeiro recolho, depois avalio" é exatamente o que deixa o utilizador à
frente de um monte de linhas sem pontuação.

**4. Põe um teto na primeira passagem de sourcing.**

Comunica a cada Scout a sua quota do `scout_cap_first_pass` e diz-lhe para reportar quando a
atingir, em vez de procurar até o orçamento se esgotar. As posições para lá desse teto ainda não
valem nada: ficam em fila atrás das que ninguém pontuou.

**5. Reporta cedo, não com o trabalho terminado.**

Assim que as primeiras ~3 posições tiverem pontuação, manda ao utilizador um `jht-send` curto a
dizer o que são — é o momento em que a aplicação deixa de parecer avariada. Depois continua até
`target_scored`.

**6. Fecha o burst.**

```bash
python3 /app/shared/skills/first_run.py check
```

Corre-o a cada `[HEARTBEAT]`. Quando passar a `steady` voltaste às regras ordinárias, calibração
C-02 incluída.

## A velocidade aqui também é tua — o bridge apenas aconselha

O `pace_guard` mede o consumo contra a curva da janela em cada amostragem do bridge e escreve-te no
pane uma linha `[PACE-GUARD]` com o throttle que recomendaria. **Não** o aplica: ninguém o aplica
enquanto não fores tu a correr o `throttle-config.py`. Portanto:

- **Nunca** `freeze_team.py` durante o burst. Uma equipa congelada é exatamente o silêncio que esta
  skill existe para evitar.
- Lê uma linha `[PACE-GUARD]` como uma decisão a tomar, não como uma notificação. Traz o comando já
  escrito para os workers vivos — adapta-o a quem está a fazer o quê e executa-o. Se a ignorares, o
  ritmo não muda: nenhum script vai mexer no throttle por ti.
- Se te chegar como `LOCKOUT-IMMINENTE`, o travão recomendado já está no teto de 1h — travar já não
  chega, e a alavanca é o **roster**: mata um Scout (nunca o Analista nem o Scorer: sem eles não se
  pontua nada).
- A janela deve chegar aos 100% **no reset**, não antes. Estar a 100% a meio do caminho significa
  deixar o utilizador com uma equipa muda durante duas horas; estar a 40% no reset significa
  orçamento deixado em cima da mesa. São dois falhanços, e o primeiro é muito pior.

## Antipadrões

- ❌ Fazer spawn só de Scouts, "primeiro o material, depois as pontuações" — o resultado medido é 50
  encontradas / 3 pontuadas, o que para o utilizador é uma app avariada.
- ❌ Esperar por um `[BRIDGE TICK]` antes do primeiro spawn: o trigger **é** o perfil pronto.
- ❌ Subir a escada de C-02 durante o burst — essa regra governa o regime estabelecido, esta janela é
  a exceção.
- ❌ Congelar a equipa para proteger o orçamento. Lento recupera-se, mudo não.
- ❌ Anunciar o burst ao utilizador na linguagem da infraestrutura ("4 workers spawnados, throttle
  300s"). Reporta posições, empresas, pontuações.

## Ver também

- `spawn-agent` — o lançamento propriamente dito, inalterado.
- `pipeline-triage` — que papel desbloqueia o estrangulamento, uma vez em regime estabelecido.
- `scaling-calc` / **C-02** — a calibração gradual que esta skill suspende.
- `chat-web` — como formular o primeiro relato ao utilizador.
