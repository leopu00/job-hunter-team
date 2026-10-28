---
name: first-run-burst
description: "A primeira meia hora em que um utilizador acabado de chegar vê a equipa a trabalhar. Abre esta skill quando receberes `[PROFILO-PRONTO]` do Assistente, ou ao acordar se o `first_run.py status` reportar a fase `awaiting_profile` / `burst`. Derroga a calibração gradual (C-02) apenas para a primeira janela, e define o sucesso como posições COM PONTUAÇÃO no ecrã — não como posições encontradas."
allowed-tools: Bash(python3 /app/shared/skills/first_run.py *), Bash(python3 /app/shared/skills/plan_registry.py *), Bash(python3 /app/shared/skills/db_query.py *), Bash(/app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/throttle-config.py *), Bash(jht-tmux-send *), Bash(jht-send *)
---
<!-- @translation: pt, ai-translated 2026-08-03 -->

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
`target_scored`, todos derivados da subscrição que o utilizador declarou. Se recusar (`ok: false`,
«plano de subscrição não selecionado»), ainda não há plano declarado: **não adivinhes** um roster, uma
sobrestimativa queima-lhe a janela logo no primeiro dia. Pergunta-lho com `python3 /app/shared/skills/first_run.py ask-plan`: é a única forma, porque publica o cartão na app, com os planos e o que a linha `Codex reports:` indica marcado como sugerido — uma sugestão, nunca a tua escolha. Uma pergunta escrita como texto no teu painel não chega a ninguém: o utilizador olha para a app, não para o teu painel. Quando o utilizador responder, escreve exatamente a escolha dele com `python3 /app/shared/skills/plan_registry.py set <provider>:<id>` (serve o id do cartão: `pro_max` é `pro-max`) e volta a lançar `begin-burst`. Se responder «não sei», para e di-lo; volta a perguntar no teu próximo despertar.

**Enquanto o burst corre, o plano pode desaparecer** (a configuração foi reposta, o fornecedor mudou, o
ficheiro foi editado). `first_run.py status` e `begin-burst` trazem então `plan_missing: true` com um `hint`:
não leias «burst already in progress» como «está tudo bem». O burst continua e o plano declara-se da mesma
forma: pergunta com `python3 /app/shared/skills/first_run.py ask-plan` (o cartão, nunca texto simples) e escreve exatamente a escolha dele com `python3 /app/shared/skills/plan_registry.py set <provider>:<id>`. O
Assistente pergunta o mesmo quando o utilizador fala com ele.

**O plano pergunta-se uma só vez.** Enquanto a tua pergunta sobre o plano estiver sem resposta no chat, não a repitas, nem por outras palavras: uma nova mensagem «perfil pronto», outro despertar ou `plan_missing` no próximo `status` não mudam o que esperas. Vê primeiro o chat: se já perguntaste e o utilizador não respondeu, espera. Só voltas a perguntar depois de o utilizador responder «não sei». O `ask-plan` não publica um segundo cartão enquanto o primeiro não tiver resposta: se disser que a pergunta está aberta, espera. Se não perguntares, o sistema publica o cartão poucos minutos depois da importação do perfil. Depois de «não sei» volta a publicar o cartão só passada uma hora, e nunca mais de três vezes no total: se o disser, espera e não perguntes por texto.

**Nunca antes do perfil, e o cartão vai para onde está o utilizador.** O `ask-plan` não publica nada enquanto o perfil não estiver guardado (`wait_for_profile: true`): não perguntes o plano na boas-vindas nem enquanto o perfil se constrói, e espera a mensagem de perfil pronto. Enquanto o utilizador confirma o perfil com o Assistente, o cartão vai para o chat do Assistente, seja quem for que lance `ask-plan` (`agent` e `in_your_chat` na resposta dizem onde está). Quando lhe falares dele, nomeia o chat que o tem — «o chat com o Assistente» — nunca «este chat» se `in_your_chat` for `false`.

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
