-- Vínculo por identificador com o sistema PrestAí (decisões Q2, D3, D4 e D5).
-- O comercial cadastra os identificadores à mão. Nada aqui lê o banco do PrestAí.

-- D3: a organização do PrestAí não tem CNPJ. O formato continua validado quando vier.
alter table public.organizations alter column cnpj drop not null;

alter table public.org_members add column prestai_user_id uuid;
alter table public.projects add column prestai_project_id uuid;

-- Cada identificador do PrestAí aponta para um registro só. Sem isso, um erro de
-- digitação no cadastro manual ligaria duas organizações à mesma do PrestAí.
create unique index organizations_prestai_org_uidx
  on public.organizations (prestai_org_id) where prestai_org_id is not null;
create unique index projects_prestai_project_uidx
  on public.projects (prestai_project_id) where prestai_project_id is not null;
create unique index org_members_prestai_user_uidx
  on public.org_members (organization_id, prestai_user_id) where prestai_user_id is not null;

-- org_members não aceita escrita direta. O comercial grava o identificador por aqui.
create or replace function public.vincular_usuario_prestai(p_member_id uuid, p_prestai_user_id uuid)
returns public.org_members
language plpgsql security definer set search_path = '' as $$
declare
  v public.org_members;
begin
  if not app.is_staff(array['comercial']) then
    raise exception 'Sem acesso' using errcode = '42501';
  end if;
  update public.org_members
     set prestai_user_id = p_prestai_user_id
   where id = p_member_id
   returning * into v;
  if not found then
    raise exception 'Usuário não encontrado' using errcode = 'P0002';
  end if;
  return v;
end $$;

revoke all on function public.vincular_usuario_prestai(uuid, uuid) from public, anon, authenticated;
grant execute on function public.vincular_usuario_prestai(uuid, uuid) to authenticated;
