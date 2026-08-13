---
name: cloud-push-quarantine
description: Inspeciona e recupera linhas isoladas pelo push cloud após rejeição do servidor, sem expor o conteúdo. Use quando sync-health indicar push_quarantine.
allowed-tools: Bash(jht cloud quarantine *)
---

# cloud-push-quarantine — inspecionar, tentar novamente, resolver

O push deixa os dados válidos avançarem e guarda para a linha rejeitada apenas
metadados seguros: tabela/tipo, identidade opaca, motivo sanitizado, tentativas
e timestamps. Nunca peça nem imprima a linha de origem.

1. Inspecione com `jht cloud quarantine list`. Informe apenas quantidade,
   tabela, identidade opaca, código do motivo, tentativas e timestamps.
2. Corrija a causa local pelo workflow responsável. Não edite `jobs.db`
   manualmente nem crie casos especiais por tabela ou código de erro.
3. Tente novamente com `jht cloud quarantine retry <opaque-id>`. É usado o
   writer cloud canónico. Leia o resultado e repita list: sucesso vira
   `resolved`.
4. Use `jht cloud quarantine resolve <opaque-id> --confirm` apenas após
   verificar que a linha local foi removida ou substituída intencionalmente e
   que não precisa de retry. O histórico de auditoria é preservado.

`retry all` só é permitido após corrigir uma causa comum e verificar todas as
tabelas. Nunca copie corpos, títulos, caminhos, user IDs, detalhes do servidor
ou credenciais para chats, logs ou logbook.
