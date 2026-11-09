-- Central de materiais: manuais, infográficos, roteiros, apresentações, vídeos.

create table public.conteudos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (length(trim(titulo)) > 0),
  descricao text,
  tipo text not null check (tipo in ('manual', 'infografico', 'mapa_mental', 'apresentacao', 'roteiro', 'checklist', 'video', 'outro')),
  modulo text,
  arquivo_path text unique,
  url_externa text,
  versao text not null default '1',
  publico text not null default 'todos' check (publico in ('todos', 'organizacoes')),
  ativo boolean not null default false,
  publicado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (arquivo_path is not null or url_externa is not null)
);

create table public.conteudo_organizacoes (
  conteudo_id uuid not null references public.conteudos(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  primary key (conteudo_id, organization_id)
);

create trigger conteudos_updated before update on public.conteudos
  for each row execute function app.set_updated_at();

create or replace function app.is_any_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.org_members m
    join public.organizations o on o.id = m.organization_id
    where m.user_id = auth.uid() and m.situacao = 'ativo' and o.status = 'ativa'
  );
$$;

create or replace function app.pode_ler_conteudo(p_conteudo uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conteudos c
    where c.id = p_conteudo
      and c.ativo
      and (
        (c.publico = 'todos' and app.is_any_member())
        or exists (
          select 1 from public.conteudo_organizacoes co
          where co.conteudo_id = c.id and app.is_member(co.organization_id)
        )
      )
  );
$$;

alter table public.conteudos enable row level security;
alter table public.conteudo_organizacoes enable row level security;

create policy conteudos_select on public.conteudos for select to authenticated
  using (app.pode_ler_conteudo(id) or app.is_staff());
create policy conteudos_staff_write on public.conteudos for all to authenticated
  using (app.is_staff(array['implantacao'])) with check (app.is_staff(array['implantacao']));

-- O cliente não precisa saber para quais outras organizações um material foi liberado.
create policy conteudo_org_select on public.conteudo_organizacoes for select to authenticated
  using (app.is_member(organization_id) or app.is_staff());
create policy conteudo_org_staff_write on public.conteudo_organizacoes for all to authenticated
  using (app.is_staff(array['implantacao'])) with check (app.is_staff(array['implantacao']));
