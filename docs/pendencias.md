# Pendências da Fase 1

## Da SSYS

- Criar a organização e o projeto Supabase da SSYS. A conexão atual enxerga só a organização Prestaí, que não deve receber este software.
- Montar W1 e W2 no n8n (`docs/integracao-n8n.md`).
- Definir conta de e-mail transacional e remetente.
- Implementar a extração completa de dados, exigida pela cláusula de Dados da licença. Ainda não existe.

## Do Prestaí (insumos da proposta)

- Lista final dos tipos de chamado (o Levantamento cita cerca de 34; a lista não foi encontrada).
- Acesso ao Notion e definição: base Ocorrências ou base nova.
- Subdomínio e materiais da central.
- Responsável pela homologação.

## Regras adotadas provisoriamente

- Admin da organização vê todos os chamados; membro vê os próprios.
- Só chamado resolvido pode ser reaberto, sem limite de prazo. Encerrado é definitivo.
- Severidade do cliente: baixa, média e alta. SLA não exibido.
- Senha mínima de 10 caracteres. Anexo de até 20 MB.
- Material novo é publicado para todas as organizações. Restrição por organização existe no banco e ainda não tem tela.

## Fora desta fase

- Chamado sem login ("Não consigo entrar"): está na especificação, não na proposta.
- Assistente, WhatsApp (Fase 2). Agenda, trilha e adesão (Fase 3).

## Não verificado

- Migrations, RLS e filas foram testadas em Postgres local que imita o Supabase, não em projeto real.
- Edge Functions não foram executadas.
- Telas foram testadas em navegador com `demo.ts`; `real.ts` não rodou contra um Supabase real.

## Passo 7 — vínculo com o PrestAí (09/11/2026)

- Feito no código: migração 20261109000007 (prestai_user_id, prestai_project_id, CNPJ opcional, índices únicos, RPC vincular_usuario_prestai), 3 testes novos (31 no total) e telas da equipe (ID PrestAí por organização, usuário e projeto; criação de projeto).
- Pendente: aplicar a migração 7 no projeto Supabase real e validar real.ts contra ele (nunca foi executado contra o banco real).
- Pendente: confirmar com o PrestAí que os ids de organização, projeto e usuário são uuid (premissa do campo).
