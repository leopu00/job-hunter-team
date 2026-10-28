---
name: profile-yaml
description: "Maintain `$JHT_HOME/profile/candidate_profile.yml` — the structured candidate data the entire team consumes. The frontend polls this file every ~2s; an invalid YAML makes the user's left panel go silently blank. Owned by the Assistente. Use this skill on EVERY new piece of information from the user (text or uploaded file): write incrementally, validate immediately, talk to the user only after the validator says VALID_PROFILE. Also covers `ready.flag` (the unlock for the \"Vai alla dashboard\" button) with its strict 3-step verify-then-announce protocol."
allowed-tools: Bash(jht profile validate *), Bash(python3 *), Bash(mkdir -p *), Bash(date *), Bash(test *), Bash(rm -f *)
---
<!-- @translation: pt, ai-translated 2026-06-06 -->

# profile-yaml — fonte unica de verdade sobre o candidato

A equipa le `candidate_profile.yml` para cada CV, cada score, cada decisao de correspondencia. Se o mantiver correto, o resto do sistema funciona; se o deixar desatualizar, os Writers produzem CVs estereis e o Scorer avalia mal as posicoes.

## 🌍 Idioma do texto livre (vinculativo)

O texto de `narrative`, `key_points` e `timeline` do perfil é escrito no idioma do utilizador (`python3 /app/shared/skills/text_language.py lang` imprime-o), **mesmo que o CV de onde vem esteja noutro idioma** (RULE-T14). O `validate_profile.py` imprime `WARN: LANGUAGE: …` para um texto longo claramente noutro idioma: reescreve-o, não ignores o aviso. Nomes, empresas e ferramentas ficam como estão.

## Caminho & propriedade

| Caminho                                       | Quem escreve         | Quem le                  |
|-----------------------------------------------|----------------------|--------------------------|
| `$JHT_HOME/profile/candidate_profile.yml`     | **Assistente** (voce), Capitano, utilizador via a interface web | todos os outros agentes (apenas leitura — T10) |
| `$JHT_HOME/profile/ready.flag`                | **Assistente** (voce) | o gate CTA do painel |

Crie o diretorio se nao existir:
```bash
mkdir -p "$JHT_HOME/profile"
```

## Atualizacao em tempo real — incremental, apos CADA entrada relevante

O frontend consulta o ficheiro a cada ~2s. Nao espere ate ao fim da conversa; **cada vez que o utilizador lhe der um novo dado, escreva-o agora**.

- "chamo-me Mario" → escreva `name: Mario` imediatamente.
- "procuro um cargo de cozinheiro" → atualize `target_role: cuoco` imediatamente.
- informacao escrita no chat → atualize **todos** os campos pertinentes num unico Write.

Cada novo dado = um `Write` ou `Edit` no ficheiro. Depois valide. Depois continue a conversa.

### Os CV carregados são revistos antes de se tornarem dados persistidos

Uma mensagem que contenha `[FILE ALLEGATI]` é a única exceção à escrita direta. Depois de ler o CV:

1. Escreva apenas os campos extraídos em `$JHT_AGENT_DIR/profile-review.yml`. Nunca os escreva diretamente em `candidate_profile.yml`.
2. Execute `python3 /app/shared/skills/profile_review.py stage`.
3. Só quando devolver `ok: true`, publique o cartão de confirmação: `python3 /app/shared/skills/profile_review.py ask-confirm --inferred <campos>`, onde `<campos>` são os campos que o CV NÃO dizia e que você deduziu (por exemplo `seniority_target,target_role,location`, ou uma preferência como `location_preferences`); sem `--inferred` se não deduziu nada. O cartão leva o resumo e os dois botões: não reescreva o resumo e não nomeie nenhum painel nem botão da app. Não afirme que o perfil já foi guardado.
4. Quando a pessoa responder ao cartão, execute `python3 /app/shared/skills/profile_review.py apply-confirmed`. Com `ok: true` o perfil está guardado: diga-o numa linha e pergunte pelo primeiro campo de `missing`. Se o plano ainda não estiver declarado (`plan_registry.py get` diz `PLAN_MISSING`), pergunte-o agora e só com o cartão (`first_run.py ask-plan --agent assistente`, skill `onboarding-flow`), nunca em texto. Com o erro `wants_correction`, pergunte o que corrigir, atualize `profile-review.yml`, execute `stage` e depois `ask-confirm` outra vez. Com qualquer outro erro diga que a confirmação não pôde ser aplicada; nunca edite o perfil canónico para a contornar.
5. Se a pessoa escrever «sim, guarda» por palavras, não guarde e não a ignore: execute `ask-confirm`. `open: true` → uma linha, «carrega em **Confirmar e guardar** no cartão acima». `asked: true` (o cartão já não estava lá, publica-se um novo) → uma linha a dizer que o pôs outra vez abaixo. `confirmed: true` → execute `apply-confirmed`. Erro `no_review` → o perfil já está guardado ou não há nada a confirmar: diga-o. Nunca deixe a pessoa sem um passo seguinte.
6. Se a preparação falhar, diga que não foi possível preparar a revisão. Não peça lembretes no chat nem contorne a revisão editando o perfil canónico.

O crachá lê apenas o `candidate_profile.yml` persistido. Não deve avançar enquanto houver uma revisão de CV pendente.

## Validacao obrigatoria apos CADA write/edit

Valide contra o **schema canonico** (nao apenas "e YAML parseavel"): veja a skill
[`profile-schema`](../profile-schema/SKILL.md) para o schema completo.

```bash
jht profile validate
# fallback direto:
# python3 /app/shared/skills/validate_profile.py "$JHT_HOME/profile/candidate_profile.yml"
```

`VALID_PROFILE` → prossiga. `INVALID_PROFILE` → leia os `ERROR:` (campo + motivo),
corrija esse campo, revalide. Os `WARN:` (chaves legacy, ex. `languages[].name` em vez
de `language`) nao bloqueiam mas devem ser corrigidos quando tocar nessa secao.

**NAO continue a conversa com o utilizador ate obter `VALID_PROFILE`.** Um perfil quebrado
esvazia todo o painel esquerdo; o utilizador pensa que a aplicacao crashou.

Se esqueceu de adicionar o passo de validacao, pode ter a certeza de que o ficheiro esta quebrado — nao existe "provavelmente ok". Execute-o sempre.

## Regras de seguranca YAML

O parser do frontend e estrito. Cinco regras que previnem todos os problemas encontrados:

1. **Scalar de bloco (`|-` ou `>-`) para qualquer texto > 60 caracteres** — descricoes, resumos, notas livres, pontos fortes. Strings inline quebram em virgulas, dois-pontos, aspas, quebras de linha, parenteses.
   ```yaml
   summary: |-
     Aqui pode escrever texto longo, mesmo com virgulas, dois-pontos, apostrofos,
     quebras de linha, parenteses: o parser aceita-o tal como esta.
   ```
2. **Coloque entre aspas strings inline com caracteres especiais** — se precisar manter uma string inline e ela contiver `"`, `:`, `#`, `&`, `*`, `>`, `|`, `%`, `@`, envolva-a com aspas duplas (`"…"`) ou mude para scalar de bloco.
3. **Espaco apos cada `:`** — `role: Senior` ✅ · `role:Senior` ❌.
4. **Indentacao com 2 espacos, nunca tabs** — os marcadores de lista indentam na mesma coluna que o primeiro caracter de conteudo do elemento pai.
5. **Sem travessoes longos / aspas tipograficas** — colar de editores de texto rico injeta `—`, `"`, `"`. Substitua por `-`, `"` simples, ou use scalar de bloco.

## Esquema minimo (o piso)

O frontend tem um fallback que desbloqueia "Vai alla dashboard" quando os oito campos minimos estao presentes + nao vazios: nome, email, cargo alvo, cidade, anos de experiencia, `seniority_target`, pelo menos 2 competencias principais, pelo menos 1 lingua (para que o utilizador possa prosseguir mesmo antes de voce criar `ready.flag`). Preencha primeiro esses. O resto do esquema abaixo e recomendado, experiencias e formacoes incluidas: peca-o logo a seguir ao desbloqueio, e nunca o invente so para preencher o esquema.

```yaml
name: <Nome Apelido>
target_role: <cargo alvo>
location: <cidade ou area>
experience_years: <int>
has_degree: <true|false>        # opcional: ausente = não declarado; se existir, booleano
seniority_target: <junior|mid|senior>
industry: <setor>

skills:
  primary: [...]              # >= 2 entradas
  secondary: [...]

languages:                    # >= 1 entrada
  - language: <nome>
    level: <A1..C2 | native>

candidate:
  name: <mesmo que acima>
  target_role: <mesmo que acima>
  contacts:
    email: ...
    phone: ...
    linkedin: ...
    github: ...
  experience:                 # recomendado, nao obrigatorio: se existir, cada uma com company/role/years/summary
    - company: ...
      role: ...
      years: ...              # ex. "Mar 2022 - em curso" — usado para duracao real
      summary: |-
        ...
  education:                  # recomendado, nao obrigatorio: se existir, cada uma com institution/degree/year
    - institution: ...
      degree: ...
      year: ...

preferences:                  # CHAVES EXATAS — o frontend procura exatamente estas
  work_mode: <remoto|ibrido|in sede|flessibile>
  work_mode_flexibility: <opcional, texto livre>
  relocation: <true|false|"per la giusta posizione">
  salary_annual_eur: <ex. "30-35k" | null>

sector_details:
  <chaves livres, snake_case — ver secao abaixo>
```

As chaves `preferences.work_mode`, `preferences.relocation`, `preferences.salary_annual_eur` sao lidas literalmente pelo frontend para preencher a secao "Preferencias de trabalho". Nomes alternativos (`work_location`, `flexible`, `remote`) ficam escritos mas invisiveis para o utilizador.

Esquema completo + exemplos: `docs/examples/candidate_profile.yml.example` (para documentacao, **NAO copie os valores** — ver anti-alucinacao).

## `sector_details` — chaves livres para o setor do utilizador

Secao generica chave/valor que o frontend apresenta como lista. As chaves sao escolhidas por si com base na profissao do utilizador. Exemplos reais:

```yaml
# Cozinha
sector_details:
  specializzazione: Pasticceria
  brigate: "ristoranti grandi (10+ persone in cucina)"
  patenti: ["HACCP", "antincendio rischio medio"]
  ruolo_attuale: "Capo partita salata"

# Saude
sector_details:
  specializzazione_infermieristica: "Area critica"
  iscrizione_albo: "OPI Roma n. 12345"
  reparti: ["Pronto soccorso", "Terapia intensiva"]
  turni_abituali: "notturni + festivi"

# Construcao / instalacoes
sector_details:
  patenti: ["CAP carrello elevatore", "PES/PAV", "patentino ponteggi"]
  specializzazione: "Impianti elettrici industriali"
  anni_cantiere: 12

# Ensino
sector_details:
  classe_concorso: "A-12 (Italiano, Storia)"
  anni_ruolo: 8
  specializzazione_sostegno: true
```

Regras:
- Chaves em `snake_case`, curtas e legiveis.
- Insira apenas chaves com valor real do candidato. Se nao sabe → omita (nunca `null` / `""`).
- Valores: string, numero, booleano, array de strings.
- Setor nao na lista → invente as chaves adequadas, baseando-se no que e importante nessa profissao. Ex. camionista: `patente: CE+CQC`, `anni_alla_guida: 15`, `tratte_abituali: [...]`.

## `ready.flag` — desbloqueio "Vai alla dashboard"

O botao esta desativado por defeito. O frontend ativa-o SE:
- `$JHT_HOME/profile/ready.flag` existe (o flag explicito que VOCE cria), **OU**
- o backend deteta que o esquema minimo ja esta completo (fallback automatico).

Portanto, frequentemente o botao ja esta desbloqueado pelo fallback quando o perfil esta completo — **nao anuncie o desbloqueio se nao foi voce que criou o flag**.

### Quando criar o flag (3 passos RIGOROSOS, nunca saltar, nunca mudar a ordem)

```bash
# 1. Crie o flag com timestamp UTC
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$JHT_HOME/profile/ready.flag"

# 2. VERIFIQUE que o ficheiro realmente existe (pode falhar silenciosamente:
#    permissoes, diretorio em falta, quota de disco, etc.)
test -f "$JHT_HOME/profile/ready.flag" && echo FLAG_OK || echo FLAG_MISSING

# 3. SO se o passo 2 = FLAG_OK → envie a mensagem no chat.
#    Se FLAG_MISSING → corrija (ex. mkdir -p) e repita desde o passo 1.
#    NUNCA anuncie o desbloqueio sem FLAG_OK no passo anterior.
```


### 4. Avise o Capitano — e daqui que a equipa arranca

So depois de `FLAG_OK`, e uma unica vez:

```bash
jht-tmux-send CAPITANO "[@assistente -> @capitano] [PROFILO-PRONTO] perfil do candidato completo e validado — a equipa pode arrancar."
```

O Capitano nao olha para o ficheiro do perfil: enquanto ninguem lhe disser, no
primeiro arranque deixa o utilizador perante um escritorio quase parado. Esta
mensagem e o gatilho da sua skill `first-run-burst` (equipa completa de imediato
em vez da subida gradual). Sem ela, no primeiro dia o utilizador ve uma posicao
a cada dez minutos e conclui que a aplicacao esta avariada.

### Anti-alucinacao do passo 2

E sabido que um LLM tende a escrever "fiz X" mesmo quando a chamada de ferramenta nao foi emitida. O `test -f` existe precisamente para o interromper se saltou a criacao: ve `FLAG_MISSING` e lembra-se de voltar atras. **Nao confie na sua memoria, confie apenas na saida de `test -f`.**

### Quando remover o flag

Se durante a conversa surgir que um campo da checklist de bloqueio esta errado ou em falta (ex. o utilizador diz "ah nao, essa experiencia nao era realmente minha"):

```bash
rm -f "$JHT_HOME/profile/ready.flag"
```

E avise o utilizador: "voltei a colocar o botao em espera — vamos rever este ponto antes de prosseguir".

### NAO criar o flag se

- a ultima validacao do perfil mostrou `INVALID_PROFILE` (mesmo uma unica vez apos o ultimo Write);
- faltam (os oito campos minimos): nome, email, cargo alvo, cidade, anos de experiencia, `seniority_target`, competencias (≥2), linguas (≥1).

Experiencias e formacoes sao recomendadas: nao bloqueiam o flag. Pede-as logo a seguir a cria-lo.

## 🎓 `has_degree` — a partir da formacao, nunca como valor provisorio

`has_degree` e opcional: ausente quer dizer «nao declarado», nunca «nao». E um facto sobre o candidato, nao um valor por omissao; podes perguntar (esta entre os opcionais), mas nao bloqueia nem o perfil nem o desbloqueio:
- `true` quando `education` (CV ou chat) inclui um curso superior: licenciatura, mestrado, doutoramento ou equivalente.
- `false` so depois de o utilizador te dizer que nao tem nenhum.
- Se nao sabes, deixa a chave de fora: nada de `false` por prudencia, nenhum valor vazio, nenhum texto (`"sim"`): se a chave la esta, tem de ser `true` ou `false`. Nunca `false` para preencher uma lacuna: o Scorer compara-o com os requisitos de formacao de cada vaga.

## ⚠️ Anti-alucinacao — a regra critica

**NUNCA ler `docs/examples/candidate_profile.yml.example` ou `docs/examples/candidate_profile.hr.yml.example` como fonte de valores.** Esses ficheiros documentam a *estrutura*, nao o candidato. Se os ler, arrisca escrever "Mario Rossi" / "mario.rossi@example.com" no perfil real.

Use APENAS:
- o que o utilizador lhe disse no chat
- o que extraiu de um CV / ficheiro carregado

Se nao conhece um campo: **deixe `""` ou omita**, nunca invente um valor plausivel.

## Anti-patterns

- ❌ Escrever o perfil no seu cwd `$JHT_AGENT_DIR` em vez de `$JHT_HOME/profile/` — o frontend nao o encontra.
- ❌ Saltar a validacao "era so uma pequena alteracao" — cada Write pode quebrar o YAML, sempre.
- ❌ Mostrar YAML / JSON / caminhos no chat — o utilizador e nao-tecnico (ver `assistente.md` secao linguagem do utilizador).
- ❌ Anunciar o desbloqueio sem o `test -f` — e a alucinacao classica "fiz X" sem o ter feito.
- ❌ Append (Edit) em secoes existentes sem rever o contexto — o YAML deve ser reescrito de forma coerente, nao remendado aleatoriamente.

## Ver tambem

- `profile-summaries` — os 4 MDs narrativos escritos em paralelo com o YAML.
- `onboarding-flow` — o protocolo conversacional que decide quando atualizar o que.
- `chat-web` — como comunicar a confirmacao ao utilizador (1 linha, sem caminhos, sem jargao).
- `agents/_team/team-rules.md` T10 — o perfil e apenas leitura para os outros agentes, citacao verbatim.
