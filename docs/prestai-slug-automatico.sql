-- PATCH PARA O SISTEMA PRESTAÍ (repositório ugagency/cultops). NAO APLICADO. NAO TESTADO.
-- Objetivo: o slug da organização é gerado pelo sistema, nunca digitado, e não muda depois.
-- Antes de aplicar: rodar tudo dentro de uma transação com ROLLBACK numa cópia do banco,
-- e conferir o resultado do passo 3 (lista do que o backfill vai alterar).
-- Observação: no repositório, migration_org.sql declara slug sem NOT NULL, mas setup.sql declara
-- NOT NULL. Confirmar no banco real. Este patch funciona nos dois casos.

-- 1. Extensão para tirar acentos. No Supabase ela costuma ficar no schema "extensions";
--    ajustar o prefixo da chamada em gerar_slug_organizacao se for outro.
create extension if not exists unaccent with schema extensions;

-- 2. Geração: minúsculas, sem acento, só [a-z0-9] separados por hífen, sem hífen nas pontas,
--    e sufixo numérico quando já existe (instituto-exemplo, instituto-exemplo-2, ...).
create or replace function public.gerar_slug_organizacao(p_nome text, p_ignorar_id uuid default null)
returns text language plpgsql set search_path = public, extensions as $$
declare
  base text;
  cand text;
  n int := 1;
begin
  base := lower(unaccent(coalesce(p_nome, '')));
  base := regexp_replace(base, '[^a-z0-9]+', '-', 'g');
  base := trim(both '-' from base);
  if base = '' then base := 'organizacao'; end if;
  cand := base;
  while exists (select 1 from public.organizations o
                where o.slug = cand and (p_ignorar_id is null or o.id <> p_ignorar_id)) loop
    n := n + 1;
    cand := base || '-' || n;
  end loop;
  return cand;
end $$;

-- 3. PREVIA DO BACKFILL: confira antes de executar o passo 4.
--    Só entram slugs vazios ou fora do formato (ex.: "associa-o-modelo"). Slug válido em uso NAO muda.
-- select id, nome, slug as slug_atual, public.gerar_slug_organizacao(nome, id) as slug_novo
--   from public.organizations
--  where slug is null or slug = '' or slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$';

-- 4. Backfill (rodar ANTES de criar o gatilho de imutabilidade do passo 6).
update public.organizations
   set slug = public.gerar_slug_organizacao(nome, id)
 where slug is null or slug = '' or slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$';

-- 5. Novas organizações: se o slug não vier, o banco gera.
create or replace function public.organizacao_slug_ao_inserir()
returns trigger language plpgsql as $$
begin
  if new.slug is null or new.slug = '' then
    new.slug := public.gerar_slug_organizacao(new.nome);
  end if;
  return new;
end $$;

drop trigger if exists organizacao_slug_ins on public.organizations;
create trigger organizacao_slug_ins before insert on public.organizations
  for each row execute function public.organizacao_slug_ao_inserir();

-- 6. Imutável: depois de definido, o slug não muda (é a chave de vínculo com a Área do Cliente).
create or replace function public.organizacao_slug_imutavel()
returns trigger language plpgsql as $$
begin
  if old.slug is not null and new.slug is distinct from old.slug then
    raise exception 'O slug da organização não pode ser alterado.' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists organizacao_slug_upd on public.organizations;
create trigger organizacao_slug_upd before update on public.organizations
  for each row execute function public.organizacao_slug_imutavel();

-- 7. Garantia de formato e obrigatoriedade (só depois do backfill).
-- alter table public.organizations add constraint organizations_slug_formato
--   check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
-- alter table public.organizations alter column slug set not null;

-- MUDANCAS DE CODIGO NO PRESTAÍ (junto com a migração):
--  a) app.js (cadastro dentro do app, ~linha 5818): remover a linha
--       slug: orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
--     do insert. O gatilho do passo 5 passa a gerar o slug.
--  b) plataforma.html (campo "Slug") e server.js (~linha 3350, "nome e slug são obrigatórios"):
--     tornar o slug opcional ou remover o campo, para o sistema gerar. Mostrar o slug gerado
--     na resposta e na lista de organizações. suporte.html já exibe o slug; manter.
