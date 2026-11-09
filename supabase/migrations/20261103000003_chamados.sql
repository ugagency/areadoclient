-- Chamados com protocolo. O cliente nunca grava direto nas tabelas: toda escrita
-- passa pelas RPCs abaixo. Status e atendimento vêm do Notion, via service_role.

create table public.chamado_categorias (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  exige_humano boolean not null default false,
  ativa boolean not null default true,
  ordem integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.protocolo_contadores (
  ano integer primary key,
  ultimo integer not null
);

create table public.chamados (
  id uuid primary key default gen_random_uuid(),
  protocolo text not null unique,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid references public.projects(id) on delete restrict,
  solicitante_id uuid not null references auth.users(id) on delete restrict,
  categoria_id uuid not null references public.chamado_categorias(id) on delete restrict,
  assunto text not null check (length(trim(assunto)) between 1 and 200),
  descricao text not null check (length(trim(descricao)) between 1 and 10000),
  severidade_sugerida text not null default 'media' check (severidade_sugerida in ('baixa', 'media', 'alta')),
  status text not null default 'aberto' check (status in
    ('aberto', 'em_triagem', 'em_atendimento', 'aguardando_cliente', 'resolvido', 'encerrado', 'reaberto')),
  prioridade text,
  responsavel text,
  origem text not null default 'portal' check (origem in ('portal', 'prisma')),
  aberto_em timestamptz not null default now(),
  primeira_resposta_em timestamptz,
  resolvido_em timestamptz,
  encerrado_em timestamptz,
  updated_at timestamptz not null default now()
);
create index chamados_org_idx on public.chamados (organization_id, aberto_em desc);
create index chamados_solicitante_idx on public.chamados (solicitante_id);

-- Vínculo com o Notion fora de chamados: o cliente nunca vê referência ao Notion.
create table public.chamado_notion (
  chamado_id uuid primary key references public.chamados(id) on delete cascade,
  notion_page_id text not null unique,
  sincronizado_em timestamptz not null default now()
);

create table public.chamado_mensagens (
  id uuid primary key default gen_random_uuid(),
  chamado_id uuid not null references public.chamados(id) on delete restrict,
  autor_id uuid references auth.users(id) on delete restrict,
  autor_tipo text not null check (autor_tipo in ('cliente', 'atendente', 'sistema')),
  texto text not null check (length(trim(texto)) between 1 and 10000),
  visibilidade text not null default 'cliente' check (visibilidade in ('cliente', 'interna')),
  created_at timestamptz not null default now()
);
create index chamado_mensagens_chamado_idx on public.chamado_mensagens (chamado_id, created_at);

create table public.chamado_anexos (
  id uuid primary key default gen_random_uuid(),
  chamado_id uuid not null references public.chamados(id) on delete restrict,
  storage_path text not null unique,
  nome text not null,
  mime text,
  bytes bigint,
  criado_por uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create trigger chamado_categorias_updated before update on public.chamado_categorias
  for each row execute function app.set_updated_at();
create trigger chamados_updated before update on public.chamados
  for each row execute function app.set_updated_at();

-- Admin da organização vê todos os chamados dela; membro vê os próprios.
create or replace function app.pode_ver_chamado(p_chamado uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.chamados c
    where c.id = p_chamado
      and (
        app.is_org_admin(c.organization_id)
        or (c.solicitante_id = auth.uid() and app.is_member(c.organization_id))
      )
  );
$$;

alter table public.chamado_categorias enable row level security;
alter table public.protocolo_contadores enable row level security;
alter table public.chamados enable row level security;
alter table public.chamado_notion enable row level security;
alter table public.chamado_mensagens enable row level security;
alter table public.chamado_anexos enable row level security;

create policy categorias_select on public.chamado_categorias for select to authenticated
  using ((ativa and app.is_any_member()) or app.is_staff());
create policy categorias_staff_write on public.chamado_categorias for all to authenticated
  using (app.is_staff(array['atendimento'])) with check (app.is_staff(array['atendimento']));

create policy chamados_select on public.chamados for select to authenticated
  using (app.pode_ver_chamado(id) or app.is_staff());

create policy mensagens_select on public.chamado_mensagens for select to authenticated
  using (
    (visibilidade = 'cliente' and app.pode_ver_chamado(chamado_id))
    or app.is_staff()
  );

create policy anexos_select on public.chamado_anexos for select to authenticated
  using (app.pode_ver_chamado(chamado_id) or app.is_staff());

-- Protocolo sequencial por ano, gerado no banco: 2026-0001.
create or replace function app.proximo_protocolo()
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_ano integer := extract(year from now() at time zone 'America/Sao_Paulo')::integer;
  v_n integer;
begin
  insert into public.protocolo_contadores as p (ano, ultimo)
  values (v_ano, 1)
  on conflict (ano) do update set ultimo = p.ultimo + 1
  returning ultimo into v_n;
  return v_ano::text || '-' || case when v_n < 10000 then lpad(v_n::text, 4, '0') else v_n::text end;
end $$;

create or replace function public.abrir_chamado(
  p_organization_id uuid,
  p_categoria_id uuid,
  p_assunto text,
  p_descricao text,
  p_project_id uuid default null,
  p_severidade text default 'media',
  p_origem text default 'portal'
) returns public.chamados
language plpgsql security definer set search_path = '' as $$
declare
  v public.chamados;
begin
  if auth.uid() is null or not app.is_member(p_organization_id) then
    raise exception 'Sem acesso a esta organização' using errcode = '42501';
  end if;
  if not exists (select 1 from public.chamado_categorias c where c.id = p_categoria_id and c.ativa) then
    raise exception 'Categoria inválida' using errcode = '22023';
  end if;
  if p_project_id is not null and not exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.organization_id = p_organization_id and p.ativo
  ) then
    raise exception 'Projeto inválido' using errcode = '22023';
  end if;

  insert into public.chamados
    (protocolo, organization_id, project_id, solicitante_id, categoria_id,
     assunto, descricao, severidade_sugerida, origem)
  values
    (app.proximo_protocolo(), p_organization_id, p_project_id, auth.uid(), p_categoria_id,
     trim(p_assunto), trim(p_descricao), p_severidade, p_origem)
  returning * into v;
  return v;
end $$;

create or replace function public.responder_chamado(p_chamado_id uuid, p_texto text)
returns public.chamado_mensagens
language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
  v_msg public.chamado_mensagens;
begin
  select status into v_status from public.chamados where id = p_chamado_id for update;
  if not found or not app.pode_ver_chamado(p_chamado_id) then
    raise exception 'Chamado não encontrado' using errcode = 'P0002';
  end if;
  if v_status in ('resolvido', 'encerrado') then
    raise exception 'Chamado finalizado não recebe resposta' using errcode = 'P0001';
  end if;

  insert into public.chamado_mensagens (chamado_id, autor_id, autor_tipo, texto)
  values (p_chamado_id, auth.uid(), 'cliente', trim(p_texto))
  returning * into v_msg;

  if v_status = 'aguardando_cliente' then
    update public.chamados set status = 'em_atendimento' where id = p_chamado_id;
  end if;
  return v_msg;
end $$;

-- Reabertura só a partir de 'resolvido'. Encerrado é definitivo.
create or replace function public.reabrir_chamado(p_chamado_id uuid, p_motivo text)
returns public.chamados
language plpgsql security definer set search_path = '' as $$
declare
  v public.chamados;
begin
  select * into v from public.chamados where id = p_chamado_id for update;
  if not found or not app.pode_ver_chamado(p_chamado_id) then
    raise exception 'Chamado não encontrado' using errcode = 'P0002';
  end if;
  if v.status <> 'resolvido' then
    raise exception 'Só chamado resolvido pode ser reaberto' using errcode = 'P0001';
  end if;

  insert into public.chamado_mensagens (chamado_id, autor_id, autor_tipo, texto)
  values (p_chamado_id, auth.uid(), 'cliente', trim(p_motivo));

  update public.chamados
     set status = 'reaberto', resolvido_em = null
   where id = p_chamado_id
   returning * into v;
  return v;
end $$;

create or replace function public.registrar_anexo(
  p_chamado_id uuid, p_storage_path text, p_nome text, p_mime text default null, p_bytes bigint default null
) returns public.chamado_anexos
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v public.chamado_anexos;
begin
  select organization_id into v_org from public.chamados where id = p_chamado_id;
  if not found or not app.pode_ver_chamado(p_chamado_id) then
    raise exception 'Chamado não encontrado' using errcode = 'P0002';
  end if;
  if position(v_org::text || '/' || p_chamado_id::text || '/' in p_storage_path) <> 1 then
    raise exception 'Caminho de anexo inválido' using errcode = '22023';
  end if;
  insert into public.chamado_anexos (chamado_id, storage_path, nome, mime, bytes, criado_por)
  values (p_chamado_id, p_storage_path, p_nome, p_mime, p_bytes, auth.uid())
  returning * into v;
  return v;
end $$;

-- Aplica o que veio do Notion. Só service_role (Edge Function n8n-callback).
create or replace function public.aplicar_atualizacao_notion(
  p_chamado_id uuid,
  p_status text default null,
  p_prioridade text default null,
  p_responsavel text default null,
  p_resposta text default null
) returns public.chamados
language plpgsql security definer set search_path = '' as $$
declare
  v public.chamados;
  v_status text;
begin
  perform set_config('app.origem', 'notion', true);

  select * into v from public.chamados where id = p_chamado_id for update;
  if not found then
    raise exception 'Chamado não encontrado' using errcode = 'P0002';
  end if;

  v_status := coalesce(p_status, v.status);
  if v_status = 'reaberto' and v.status <> 'reaberto' then
    raise exception 'Reabertura só parte do cliente' using errcode = 'P0001';
  end if;

  if nullif(trim(coalesce(p_resposta, '')), '') is not null then
    insert into public.chamado_mensagens (chamado_id, autor_tipo, texto)
    values (p_chamado_id, 'atendente', trim(p_resposta));
  end if;

  update public.chamados
     set status = v_status,
         prioridade = coalesce(p_prioridade, prioridade),
         responsavel = coalesce(p_responsavel, responsavel),
         primeira_resposta_em = case
           when primeira_resposta_em is null and nullif(trim(coalesce(p_resposta, '')), '') is not null
           then now() else primeira_resposta_em end,
         resolvido_em = case
           when v_status = 'resolvido' and status <> 'resolvido' then now()
           when v_status not in ('resolvido', 'encerrado') then null
           else resolvido_em end,
         encerrado_em = case
           when v_status = 'encerrado' and status <> 'encerrado' then now()
           else encerrado_em end
   where id = p_chamado_id
   returning * into v;
  return v;
end $$;
