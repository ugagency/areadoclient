-- Buckets privados e fechamento de permissões.

insert into storage.buckets (id, name, public)
values ('materiais', 'materiais', false), ('anexos', 'anexos', false)
on conflict (id) do nothing;

create or replace function app.pode_ler_material(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conteudos c
    where c.arquivo_path = p_path and app.pode_ler_conteudo(c.id)
  );
$$;

-- Caminho do anexo: <organization_id>/<chamado_id>/<arquivo>
create or replace function app.pode_usar_anexo(p_path text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_partes text[] := string_to_array(p_path, '/');
  v_chamado uuid;
begin
  if array_length(v_partes, 1) <> 3 then
    return false;
  end if;
  begin
    v_chamado := v_partes[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return exists (
    select 1 from public.chamados c
    where c.id = v_chamado
      and c.organization_id::text = v_partes[1]
      and app.pode_ver_chamado(c.id)
  );
end $$;

create policy materiais_ler on storage.objects for select to authenticated
  using (bucket_id = 'materiais' and (app.pode_ler_material(name) or app.is_staff()));
create policy materiais_equipe_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'materiais' and app.is_staff(array['implantacao']));
create policy materiais_equipe_alterar on storage.objects for update to authenticated
  using (bucket_id = 'materiais' and app.is_staff(array['implantacao']));
create policy materiais_equipe_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'materiais' and app.is_staff(array['implantacao']));

create policy anexos_ler on storage.objects for select to authenticated
  using (bucket_id = 'anexos' and (app.pode_usar_anexo(name) or app.is_staff()));
create policy anexos_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'anexos' and app.pode_usar_anexo(name));

-- O Supabase concede tudo a anon e authenticated por padrão em tabelas novas.
-- Aqui fica explícito: leitura pelas policies, escrita do cliente só por RPC.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema app from public, anon, authenticated;
revoke all on schema app from public, anon;

grant usage on schema app to authenticated;
grant execute on function
  app.is_member(uuid), app.is_org_admin(uuid), app.is_staff(text[]), app.is_any_member(),
  app.pode_ler_conteudo(uuid), app.pode_ver_chamado(uuid),
  app.pode_ler_material(text), app.pode_usar_anexo(text)
to authenticated;

grant select on
  public.organizations, public.org_members, public.staff, public.projects,
  public.conteudos, public.conteudo_organizacoes,
  public.chamado_categorias, public.chamados, public.chamado_mensagens, public.chamado_anexos,
  public.sync_outbox, public.email_outbox, public.audit_log
to authenticated;

-- Escrita direta da equipe, limitada pelas policies de papel.
grant insert, update on public.organizations, public.projects, public.conteudos, public.chamado_categorias to authenticated;
grant delete on public.projects, public.conteudos, public.chamado_categorias to authenticated;
grant insert, delete on public.conteudo_organizacoes to authenticated;
grant insert, update, delete on public.staff to authenticated;

grant execute on function
  public.abrir_chamado(uuid, uuid, text, text, uuid, text, text),
  public.responder_chamado(uuid, text),
  public.reabrir_chamado(uuid, text),
  public.registrar_anexo(uuid, text, text, text, bigint),
  public.alterar_membro(uuid, text, text),
  public.ativar_meu_acesso()
to authenticated;

grant usage on schema app to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
grant execute on all functions in schema app to service_role;
