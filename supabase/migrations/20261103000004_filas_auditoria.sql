-- Filas de saída (Notion e e-mail) e trilha de auditoria.
-- O chamado é registrado primeiro aqui: se o Notion ou o e-mail falharem,
-- nada se perde e o item fica na fila para nova tentativa.

create table public.sync_outbox (
  id bigint generated always as identity primary key,
  entidade text not null check (entidade in ('chamado', 'mensagem')),
  entidade_id uuid not null,
  operacao text not null check (operacao in ('criar', 'atualizar')),
  tentativas integer not null default 0,
  proxima_tentativa_em timestamptz not null default now(),
  erro text,
  processado_em timestamptz,
  created_at timestamptz not null default now()
);
create index sync_outbox_pendentes_idx on public.sync_outbox (proxima_tentativa_em) where processado_em is null;

create table public.email_outbox (
  id bigint generated always as identity primary key,
  para text not null,
  modelo text not null check (modelo in ('chamado_recebido', 'chamado_status', 'chamado_resposta')),
  dados jsonb not null default '{}',
  tentativas integer not null default 0,
  proxima_tentativa_em timestamptz not null default now(),
  erro text,
  enviado_em timestamptz,
  created_at timestamptz not null default now()
);
create index email_outbox_pendentes_idx on public.email_outbox (proxima_tentativa_em) where enviado_em is null;

create table public.audit_log (
  id bigint generated always as identity primary key,
  ator_id uuid,
  acao text not null,
  entidade text not null,
  entidade_id text,
  organization_id uuid,
  antes jsonb,
  depois jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_entidade_idx on public.audit_log (entidade, entidade_id);

alter table public.sync_outbox enable row level security;
alter table public.email_outbox enable row level security;
alter table public.audit_log enable row level security;

create policy sync_outbox_staff_select on public.sync_outbox for select to authenticated
  using (app.is_staff(array[]::text[]));
create policy email_outbox_staff_select on public.email_outbox for select to authenticated
  using (app.is_staff(array[]::text[]));
create policy audit_log_staff_select on public.audit_log for select to authenticated
  using (app.is_staff(array[]::text[]));

create or replace function app.enfileirar_email(p_chamado public.chamados, p_modelo text, p_extra jsonb default '{}')
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
begin
  select u.email into v_email from auth.users u where u.id = p_chamado.solicitante_id;
  if v_email is null then
    return;
  end if;
  insert into public.email_outbox (para, modelo, dados)
  values (v_email, p_modelo,
    jsonb_build_object('protocolo', p_chamado.protocolo, 'assunto', p_chamado.assunto, 'status', p_chamado.status) || p_extra);
end $$;

create or replace function app.chamado_apos_inserir()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.sync_outbox (entidade, entidade_id, operacao) values ('chamado', new.id, 'criar');
  perform app.enfileirar_email(new, 'chamado_recebido');
  return null;
end $$;

create trigger chamados_apos_inserir after insert on public.chamados
  for each row execute function app.chamado_apos_inserir();

-- Mudança de status avisa o cliente. Se partiu do cliente (resposta, reabertura),
-- também sobe ao Notion; se veio do Notion, não volta para lá.
create or replace function app.chamado_apos_atualizar()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    perform app.enfileirar_email(new, 'chamado_status');
    if coalesce(current_setting('app.origem', true), '') <> 'notion' then
      insert into public.sync_outbox (entidade, entidade_id, operacao) values ('chamado', new.id, 'atualizar');
    end if;
  end if;
  return null;
end $$;

create trigger chamados_apos_atualizar after update on public.chamados
  for each row execute function app.chamado_apos_atualizar();

create or replace function app.mensagem_apos_inserir()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_chamado public.chamados;
begin
  if new.autor_tipo = 'cliente' then
    insert into public.sync_outbox (entidade, entidade_id, operacao) values ('mensagem', new.id, 'criar');
  elsif new.autor_tipo = 'atendente' and new.visibilidade = 'cliente' then
    select * into v_chamado from public.chamados where id = new.chamado_id;
    perform app.enfileirar_email(v_chamado, 'chamado_resposta');
  end if;
  return null;
end $$;

create trigger chamado_mensagens_apos_inserir after insert on public.chamado_mensagens
  for each row execute function app.mensagem_apos_inserir();

create or replace function app.auditar()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_antes jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_depois jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_linha jsonb := coalesce(v_depois, v_antes);
begin
  insert into public.audit_log (ator_id, acao, entidade, entidade_id, organization_id, antes, depois)
  values (
    auth.uid(), lower(tg_op), tg_table_name,
    coalesce(v_linha ->> 'id', v_linha ->> 'user_id'),
    case when tg_table_name = 'organizations' then (v_linha ->> 'id')::uuid
         else (v_linha ->> 'organization_id')::uuid end,
    v_antes, v_depois
  );
  return null;
end $$;

create trigger auditar_organizations after insert or update or delete on public.organizations
  for each row execute function app.auditar();
create trigger auditar_org_members after insert or update or delete on public.org_members
  for each row execute function app.auditar();
create trigger auditar_staff after insert or update or delete on public.staff
  for each row execute function app.auditar();
create trigger auditar_projects after insert or update or delete on public.projects
  for each row execute function app.auditar();
create trigger auditar_conteudos after insert or update or delete on public.conteudos
  for each row execute function app.auditar();
create trigger auditar_categorias after insert or update or delete on public.chamado_categorias
  for each row execute function app.auditar();
create trigger auditar_chamados after update on public.chamados
  for each row execute function app.auditar();

-- Atualização ao vivo do chamado na tela do cliente.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.chamados, public.chamado_mensagens;
  end if;
end $$;
