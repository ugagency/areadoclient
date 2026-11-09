# Integração com Notion via n8n

O navegador nunca fala com n8n nem Notion. O n8n fala com a plataforma por duas Edge Functions, com o cabeçalho `x-webhook-secret` igual a `N8N_WEBHOOK_SECRET`.

## W1: plataforma para Notion (agendado, a cada 1 min)

1. `POST /functions/v1/n8n-fila` com `{"acao":"pendentes","limite":20}`. Devolve `{"itens":[...]}`. Cada item fica reservado por 5 minutos.
2. Para cada item:
   - `entidade=chamado`, `operacao=criar`: criar a página no Notion.
   - `entidade=chamado`, `operacao=atualizar`: atualizar o status em `notion_page_id`.
   - `entidade=mensagem`: acrescentar `mensagem.texto` como bloco no corpo da página.
3. Confirmar item a item em `n8n-fila`:
   - Sucesso: `{"acao":"concluir","fila_id":1,"ok":true,"notion_page_id":"..."}`. O `notion_page_id` é obrigatório ao criar.
   - Falha: `{"acao":"concluir","fila_id":1,"ok":false,"erro":"..."}`. Volta para a fila com espera progressiva, até 60 min.

Mensagem e atualização só saem depois de o chamado ter página no Notion.

## W2: Notion para plataforma (agendado, 1 a 5 min)

Ler páginas editadas desde a última execução e chamar `POST /functions/v1/n8n-callback`:

    {"chamado_id":"...","status":"em_atendimento","prioridade":"...","responsavel":"...","resposta":"..."}

- Todos os campos, exceto `chamado_id`, são opcionais.
- `status`: aberto, em_triagem, em_atendimento, aguardando_cliente, resolvido, encerrado. `reaberto` é recusado: só o cliente reabre.
- `resposta` vira mensagem para o cliente e dispara e-mail. Depois de enviar, limpar "Resposta ao cliente" e "Enviar resposta" no Notion.
- O corpo da página é nota interna e nunca é lido.

## Configurações já aprendidas

`matchType: allFilters` e `executeOnce: false` nos nós que filtram registros.

## E-mail

`POST /functions/v1/enviar-email` com o mesmo segredo, a cada minuto, por pg_cron + pg_net ou pelo n8n. Se o n8n cair, o chamado continua registrado e os e-mails param até o agendamento voltar; por isso a recomendação é pg_cron.
