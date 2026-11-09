# Área do Cliente Prestaí

Plataforma da SSYS, licenciada ao Prestaí (Opção 2 da proposta de 19/10/2026), separada do sistema principal. Este repositório cobre a Fase 1: login por organização, central de materiais, chamados com protocolo, integração com o Notion da equipe e aviso por e-mail, mais o painel interno `/equipe`.

## Rodar

    npm install
    npm run demo      # telas com dados fictícios, sem Supabase, em localhost:5199
    npm run test:db   # 28 testes de banco em Postgres local
    npm run build

## Estrutura

- `supabase/migrations`: banco, RLS, filas e auditoria.
- `supabase/functions`: `convidar-usuario`, `n8n-fila`, `n8n-callback`, `enviar-email`.
- `src`: aplicação React. `lib/real.ts` fala com o Supabase; `lib/demo.ts` só entra com `VITE_DEMO=1`.
- `docs/integracao-n8n.md`: contrato com o n8n.
- `docs/pendencias.md`: o que falta e o que precisa de decisão.

## Decisões

- Projeto Supabase exclusivo por licenciado. Não há coluna de tenant; reutilizar para outro cliente é subir outro projeto com outra marca.
- Contas em nome da SSYS (Supabase, hospedagem, e-mail, n8n).
- O cliente não grava em tabela: toda escrita passa por RPC. Permissões padrão do Supabase são revogadas na migration 5.
- Status, prioridade, responsável e resposta têm o Notion como dono. Protocolo e dados do chamado têm a plataforma como dono.
- Equipe só acessa com MFA concluído (`aal2`), exigido no banco.
- Organização suspensa perde o acesso e mantém os dados (cláusula de inadimplência).

## Publicar

1. Criar o projeto Supabase e aplicar `supabase db push`.
2. Em Auth: desligar cadastro público, ligar TOTP, definir Site URL e redirect `/definir-senha`.
3. Definir segredos: `APP_URL`, `N8N_WEBHOOK_SECRET`, `RESEND_API_KEY`, `EMAIL_REMETENTE`.
4. `supabase functions deploy convidar-usuario`; as funções `n8n-fila`, `n8n-callback` e `enviar-email` com `--no-verify-jwt`, pois usam segredo próprio.
5. Criar o primeiro usuário da equipe por SQL em `public.staff`.
6. Publicar o front com `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
