<!-- @translation: pt, ai-translated 2026-09-13 -->
---
name: apply-authorization
description: As duas portas entre a equipa e a caixa de um recrutador, e como ler as suas recusas. Uma candidatura sai SÓ se o utilizador deu o consentimento geral (`applications.auto_apply` na config do utilizador) E marcou essa mesma posição. Ambas fail-closed e verificadas no código por `apply_gate.py`. Usa-a no arranque e antes de cada posição para ler a queue do CLOSER, e sempre que precisares de explicar porque é que uma posição não saiu. Do CLOSER; o Capitano lê a mesma queue para decidir se o spawna.
allowed-tools: Bash(python3 /app/shared/skills/apply_gate.py *)
---

# apply-authorization — o que pode sair, e porque é que o resto não

Uma candidatura só sai do box quando se verificam **duas** condições. Ausente,
partido ou não reconhecido conta como **não**, sempre.

| # | Condição | Onde vive | Quem a define |
|---|---|---|---|
| 1 | consentimento geral | `applications.auto_apply.enabled = true` em `$JHT_HOME/jht.config.json` | o utilizador, na ativação |
| 2 | autorização por posição | `positions.apply_requested = 1` com `apply_requested_at` e `apply_requested_by` = `user_web` / `user_local` | o utilizador, nessa posição |

O flag do utilizador **é** a autorização para enviar. Não há uma segunda pergunta.

## A queue — um comando, lido por dois papéis

```bash
python3 /app/shared/skills/apply_gate.py queue --json
```

Exit `0` só quando algo pode sair agora; exit `1` caso contrário. O JSON:

| Campo | Significado |
|---|---|
| `ready` | `true` = pelo menos uma posição pode ser tomada agora |
| `reason` | token estável, ver abaixo |
| `mode` | `authorised` (envia) ou `dry_run` (diagnóstico, preenche e para antes do botão) |
| `max_per_day` / `sent_today` / `remaining_today` | as enviadas hoje pelo CLOSER e o limite diário se o utilizador definiu um (null = sem limite, nada é recusado pelo número) |
| `positions` | o que podes tomar, por ordem de autorização: `position_id`, `url`, `cv_pdf_path` |
| `held` | posições autorizadas que NÃO devem ser tomadas agora, cada uma com o seu `reason` |

O CLOSER toma a primeira entrada de `positions`. O Capitano só spawna o CLOSER
quando o comando sai com `0`.

## Porque é que a queue está fechada (`reason`)

| Token | Significado | O que fazer |
|---|---|---|
| `config_missing` / `config_unreadable` / `config_malformed` | a config do utilizador não se lê | nada: não é possível estabelecer consentimento |
| `consent_absent` / `consent_disabled` | o utilizador não deu consentimento | nada. Nunca sugerir ligá-lo (RULE-T18) |
| `consent_mode_unknown` / `consent_cap_invalid` | o bloco existe mas um valor não é reconhecido | nada: a porta recusa em vez de adivinhar |
| `db_unavailable` / `queue_unreadable` | a base de dados local não se lê | `[BLOCKED]` ao Capitano |
| `queue_empty` | nenhuma posição autorizada pode ser tomada | sai |
| `daily_cap_reached` | o utilizador definiu `max_per_day` e o CLOSER já enviou esse número hoje (nunca sem limite) | sai; a queue reabre amanhã |

## Porque é que uma posição está retida (`held[].reason`)

| Token | Significado |
|---|---|
| `already_submitted` | a candidatura já saiu (estado `applied`/`response`, ou a linha application diz applied). O flag fica ligado depois do envio: não é um novo pedido |
| `position_not_authorised` | o flag está desligado (o utilizador revogou-o) |
| `authorisation_undated` | o flag não tem timestamp |
| `authorisation_not_from_user` | o flag não foi definido por um canal do utilizador. Um flag ligado por um processo não é uma autorização |
| `url_missing` / `cv_pdf_missing` | não há com que preencher o formulário |
| `checkpoint_blocked_human` | o fluxo já parou nesta posição e perguntou ao utilizador. Só volta quando o utilizador a autorizar outra vez |
| `checkpoint_dry_run` | já preenchida em modo diagnóstico |
| `checkpoint_unreadable` | o checkpoint do fluxo não se lê: incerteza, portanto não |

## Uma posição, um veredito

```bash
python3 /app/shared/skills/apply_gate.py position <ID> --json
```

`allowed: true` só com `reason: apply_allowed`. É a mesma verificação que
`apply_flow.py` faz no arranque e outra vez mesmo antes do clique. Não precisas de
a correr antes do fluxo; usa-a para explicar uma recusa.

## Regras

- **Nunca escrevas a autorização.** `apply_requested*` pertence ao utilizador.
- **Nunca contornes uma recusa.** Uma porta fechada é a resposta, não um obstáculo.
- **Nunca peças ao utilizador para autorizar mais.** A equipa está completa mesmo
  sem uma única candidatura (RULE-T18).
