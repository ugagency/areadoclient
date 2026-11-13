-- O suporte do PrestAí enxerga o slug da organização (e não o uuid). O slug passa a ser
-- a chave de trabalho do vínculo manual. O uuid continua opcional para uma integração futura.
alter table public.organizations add column prestai_org_slug text
  check (prestai_org_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

create unique index organizations_prestai_slug_uidx
  on public.organizations (prestai_org_slug) where prestai_org_slug is not null;
