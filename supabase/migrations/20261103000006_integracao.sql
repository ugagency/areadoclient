-- Funções usadas pelas Edge Functions e pelo n8n. Só service_role executa.

-- Convite de quem já tem conta (ex.: usuário de duas organizações).
create or replace function public.buscar_usuario_por_email(p_email text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

-- Entrega ao n8n os itens vencidos, já com os dados do chamado, e os reserva por
-- 5 minutos para uma execução paralela não criar página duplicada no Notion.
-- Mensagem e atualização esperam o chamado ter página no Notion.
create or replace function public.fila_notion_pendentes(p_limite integer default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ids bigint[];
  v jsonb;
begin
  select coalesce(array_agg(x.id), '{}') into v_ids from (
    select s.id
    from public.sync_outbox s
    left join public.chamado_mensagens m on s.entidade = 'mensagem' and m.id = s.entidade_id
    left join public.chamado_notion n on n.chamado_id = coalesce(m.chamado_id, s.entidade_id)
    where s.processado_em is null
      and s.proxima_tentativa_em <= now()
      and (s.operacao = 'criar' and s.entidade = 'chamado' or n.chamado_id is not null)
    order by s.id
    limit p_limite
    for update of s skip locked
  ) x;

  update public.sync_outbox
     set proxima_tentativa_em = now() + interval '5 minutes'
   where id = any (v_ids);

  select coalesce(jsonb_agg(jsonb_build_object(
    'fila_id', s.id,
    'entidade', s.entidade,
    'operacao', s.operacao,
    'notion_page_id', n.notion_page_id,
    'chamado', jsonb_build_object(
      'id', c.id, 'protocolo', c.protocolo, 'assunto', c.assunto, 'descricao', c.descricao,
      'status', c.status, 'severidade_sugerida', c.severidade_sugerida, 'origem', c.origem,
      'aberto_em', c.aberto_em, 'organizacao', o.razao_social, 'cnpj', o.cnpj,
      'pronac', p.pronac, 'categoria', cat.nome, 'exige_humano', cat.exige_humano,
      'solicitante_email', u.email
    ),
    'mensagem', case when m.id is null then null else
      jsonb_build_object('id', m.id, 'texto', m.texto, 'criada_em', m.created_at) end
  ) order by s.id), '[]') into v
  from public.sync_outbox s
  left join public.chamado_mensagens m on s.entidade = 'mensagem' and m.id = s.entidade_id
  join public.chamados c on c.id = coalesce(m.chamado_id, s.entidade_id)
  join public.organizations o on o.id = c.organization_id
  join public.chamado_categorias cat on cat.id = c.categoria_id
  left join public.projects p on p.id = c.project_id
  left join auth.users u on u.id = c.solicitante_id
  left join public.chamado_notion n on n.chamado_id = c.id
  where s.id = any (v_ids);

  return v;
end $$;

-- Confirma ou devolve o item. Falha volta com espera progressiva.
create or replace function public.fila_notion_concluir(
  p_fila_id bigint, p_ok boolean, p_erro text default null, p_notion_page_id text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.sync_outbox;
begin
  select * into v from public.sync_outbox where id = p_fila_id for update;
  if not found then
    raise exception 'Item da fila não encontrado' using errcode = 'P0002';
  end if;

  if p_ok then
    if v.entidade = 'chamado' and v.operacao = 'criar' then
      if p_notion_page_id is null then
        raise exception 'notion_page_id obrigatório ao criar chamado' using errcode = '22023';
      end if;
      insert into public.chamado_notion (chamado_id, notion_page_id)
      values (v.entidade_id, p_notion_page_id)
      on conflict (chamado_id) do update set sincronizado_em = now();
    end if;
    update public.sync_outbox set processado_em = now(), erro = null where id = p_fila_id;
  else
    update public.sync_outbox
       set tentativas = tentativas + 1,
           erro = left(p_erro, 2000),
           proxima_tentativa_em = now() + make_interval(mins => least(power(2, tentativas + 1)::integer, 60))
     where id = p_fila_id;
  end if;
end $$;

create or replace function public.emails_pendentes(p_limite integer default 20)
returns setof public.email_outbox language sql security definer set search_path = '' as $$
  update public.email_outbox
     set proxima_tentativa_em = now() + interval '5 minutes'
   where id in (
     select id from public.email_outbox
     where enviado_em is null and proxima_tentativa_em <= now() and tentativas < 8
     order by id limit p_limite
     for update skip locked
   )
  returning *;
$$;

create or replace function public.email_concluir(p_id bigint, p_ok boolean, p_erro text default null)
returns void language sql security definer set search_path = '' as $$
  update public.email_outbox
     set enviado_em = case when p_ok then now() else null end,
         erro = case when p_ok then null else left(p_erro, 2000) end,
         tentativas = tentativas + case when p_ok then 0 else 1 end,
         proxima_tentativa_em = case when p_ok then proxima_tentativa_em
           else now() + make_interval(mins => least(power(2, tentativas + 1)::integer, 60)) end
   where id = p_id;
$$;

revoke all on function public.buscar_usuario_por_email(text) from public, anon, authenticated;
revoke all on function public.fila_notion_pendentes(integer) from public, anon, authenticated;
revoke all on function public.fila_notion_concluir(bigint, boolean, text, text) from public, anon, authenticated;
revoke all on function public.emails_pendentes(integer) from public, anon, authenticated;
revoke all on function public.email_concluir(bigint, boolean, text) from public, anon, authenticated;

grant execute on function public.buscar_usuario_por_email(text) to service_role;
grant execute on function public.fila_notion_pendentes(integer) to service_role;
grant execute on function public.fila_notion_concluir(bigint, boolean, text, text) to service_role;
grant execute on function public.emails_pendentes(integer) to service_role;
grant execute on function public.email_concluir(bigint, boolean, text) to service_role;
