-- Fundação: organizações, usuários, equipe e projetos.
-- Cada licenciado roda em projeto Supabase próprio. Não há coluna de tenant:
-- o isolamento aqui é entre as organizações clientes do licenciado.

create schema if not exists app;

create or replace function app.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  razao_social text not null check (length(trim(razao_social)) > 0),
  cnpj text not null unique check (cnpj ~ '^[0-9]{14}$'),
  status text not null default 'ativa' check (status in ('ativa', 'suspensa', 'encerrada')),
  prestai_org_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.org_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  nome text not null,
  papel text not null default 'membro' check (papel in ('admin', 'membro')),
  situacao text not null default 'convidado' check (situacao in ('convidado', 'ativo', 'suspenso', 'removido')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index org_members_user_idx on public.org_members (user_id);

create table public.staff (
  user_id uuid primary key references auth.users(id) on delete restrict,
  nome text not null,
  papel text not null check (papel in ('admin', 'comercial', 'implantacao', 'atendimento')),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  pronac text not null check (length(trim(pronac)) > 0),
  nome text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, pronac)
);

create trigger organizations_updated before update on public.organizations
  for each row execute function app.set_updated_at();
create trigger org_members_updated before update on public.org_members
  for each row execute function app.set_updated_at();
create trigger staff_updated before update on public.staff
  for each row execute function app.set_updated_at();
create trigger projects_updated before update on public.projects
  for each row execute function app.set_updated_at();

-- Auxiliares usadas nas policies. SECURITY DEFINER evita recursão de RLS.

-- Membro ativo de organização ativa. Organização suspensa perde o acesso e
-- preserva os dados, como prevê a cláusula de inadimplência da licença.
create or replace function app.is_member(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.org_members m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = p_org
      and m.user_id = auth.uid()
      and m.situacao = 'ativo'
      and o.status = 'ativa'
  );
$$;

create or replace function app.is_org_admin(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.org_members m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = p_org
      and m.user_id = auth.uid()
      and m.situacao = 'ativo'
      and m.papel = 'admin'
      and o.status = 'ativa'
  );
$$;

-- Equipe só vale com MFA concluído (aal2) na sessão.
create or replace function app.is_staff(p_papeis text[] default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (
       select 1 from public.staff s
       where s.user_id = auth.uid()
         and s.ativo
         and (p_papeis is null or s.papel = 'admin' or s.papel = any (p_papeis))
     );
$$;

alter table public.organizations enable row level security;
alter table public.org_members enable row level security;
alter table public.staff enable row level security;
alter table public.projects enable row level security;

create policy organizations_select on public.organizations for select to authenticated
  using (app.is_member(id) or app.is_staff());
create policy organizations_staff_insert on public.organizations for insert to authenticated
  with check (app.is_staff(array['comercial']));
create policy organizations_staff_update on public.organizations for update to authenticated
  using (app.is_staff(array['comercial'])) with check (app.is_staff(array['comercial']));

-- Membro comum vê a si mesmo; admin da organização vê todos dela.
create policy org_members_select on public.org_members for select to authenticated
  using (user_id = auth.uid() or app.is_org_admin(organization_id) or app.is_staff());

create policy staff_select on public.staff for select to authenticated
  using (app.is_staff());
create policy staff_write on public.staff for all to authenticated
  using (app.is_staff(array[]::text[])) with check (app.is_staff(array[]::text[]));

create policy projects_select on public.projects for select to authenticated
  using (app.is_member(organization_id) or app.is_staff());
create policy projects_staff_write on public.projects for all to authenticated
  using (app.is_staff(array['comercial'])) with check (app.is_staff(array['comercial']));

-- Admin do cliente suspende, reativa ou remove usuários e muda papéis.
-- Não deixa a organização sem admin ativo.
create or replace function public.alterar_membro(
  p_member_id uuid,
  p_situacao text default null,
  p_papel text default null
) returns public.org_members
language plpgsql security definer set search_path = '' as $$
declare
  v public.org_members;
  v_novo_papel text;
  v_nova_situacao text;
begin
  select * into v from public.org_members where id = p_member_id for update;
  if not found or not (app.is_org_admin(v.organization_id) or app.is_staff(array['comercial'])) then
    raise exception 'Usuário não encontrado' using errcode = 'P0002';
  end if;

  v_novo_papel := coalesce(p_papel, v.papel);
  v_nova_situacao := coalesce(p_situacao, v.situacao);

  if v.papel = 'admin' and v.situacao = 'ativo'
     and (v_novo_papel <> 'admin' or v_nova_situacao <> 'ativo')
     and not exists (
       select 1 from public.org_members o
       where o.organization_id = v.organization_id
         and o.id <> v.id and o.papel = 'admin' and o.situacao = 'ativo'
     ) then
    raise exception 'A organização precisa manter um administrador ativo' using errcode = 'P0001';
  end if;

  update public.org_members
     set papel = v_novo_papel, situacao = v_nova_situacao
   where id = p_member_id
   returning * into v;
  return v;
end $$;

-- O convite passa de 'convidado' a 'ativo' no primeiro acesso, pelo próprio usuário.
create or replace function public.ativar_meu_acesso()
returns void language sql security definer set search_path = '' as $$
  update public.org_members
     set situacao = 'ativo'
   where user_id = auth.uid() and situacao = 'convidado';
$$;
