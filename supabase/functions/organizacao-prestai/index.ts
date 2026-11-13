// Busca e cadastra uma organização a partir do slug do PrestAí. Só a equipe (admin ou
// comercial) com MFA. O nome e os projetos vêm do PrestAí; ninguém digita razão social.
// Exige os segredos PRESTAI_API_URL e PRESTAI_API_SECRET (a função "consulta-organizacao"
// publicada no projeto do PrestAí).
import { cors, json, servico } from '../_shared/comum.ts';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Dados = { id?: string; nome: string; slug: string; ativo?: boolean; projetos: { id?: string; pronac: string | null; nome: string }[] };

async function consultarPrestai(slug: string): Promise<{ dados?: Dados; status?: number; erro?: string }> {
  const url = Deno.env.get('PRESTAI_API_URL');
  const segredo = Deno.env.get('PRESTAI_API_SECRET');
  if (!url || !segredo) return { status: 503, erro: 'A ligação com o PrestAí ainda não foi configurada.' };
  let r: Response;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-secret': segredo },
      body: JSON.stringify({ slug }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return { status: 502, erro: 'Não foi possível falar com o PrestAí. Tente de novo.' };
  }
  if (r.status === 404) return { status: 404, erro: 'Organização não encontrada no PrestAí.' };
  if (!r.ok) return { status: 502, erro: 'O PrestAí não respondeu como esperado.' };
  const d = await r.json().catch(() => null);
  if (!d || typeof d.nome !== 'string' || !d.nome.trim() || !Array.isArray(d.projetos)) {
    return { status: 502, erro: 'O PrestAí respondeu em um formato inesperado.' };
  }
  return { dados: d as Dados };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ erro: 'Método não permitido' }, 405);

  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const admin = servico();
  const { data: sessao } = await admin.auth.getUser(token);
  const quem = sessao?.user;
  if (!quem) return json({ erro: 'Sessão inválida' }, 401);

  const { data: equipe } = await admin.from('staff').select('papel, ativo').eq('user_id', quem.id).maybeSingle();
  const aal = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal;
  if (!(equipe?.ativo && aal === 'aal2' && ['admin', 'comercial'].includes(equipe.papel))) {
    return json({ erro: 'Sem permissão' }, 403);
  }

  const { acao, slug } = await req.json().catch(() => ({}));
  if (!['buscar', 'cadastrar'].includes(acao) || typeof slug !== 'string' || !SLUG.test(slug)) {
    return json({ erro: 'Informe um slug válido: letras minúsculas, números e hífens.' }, 400);
  }

  const consulta = await consultarPrestai(slug);
  if (!consulta.dados) return json({ erro: consulta.erro }, consulta.status ?? 502);
  const d = consulta.dados;

  const { data: existente } = await admin.from('organizations').select('id').eq('prestai_org_slug', slug).maybeSingle();
  const projetos = d.projetos.filter((p) => typeof p.pronac === 'string' && p.pronac.trim() && typeof p.nome === 'string' && p.nome.trim());

  if (acao === 'buscar') {
    return json({
      nome: d.nome.trim(), slug, ativa: d.ativo !== false, jaCadastrada: !!existente,
      projetos: d.projetos.map((p) => ({ pronac: p.pronac ?? null, nome: p.nome })),
    });
  }

  if (existente) return json({ erro: 'Esta organização já está cadastrada.' }, 409);
  if (d.ativo === false) return json({ erro: 'Esta organização está inativa no PrestAí.' }, 409);

  const { data: org, error: erroOrg } = await admin.from('organizations').insert({
    razao_social: d.nome.trim(), prestai_org_slug: slug,
    prestai_org_id: d.id && UUID.test(d.id) ? d.id : null,
  }).select('id').single();
  if (erroOrg || !org) return json({ erro: 'Não foi possível cadastrar a organização.' }, 500);

  let criados = 0;
  if (projetos.length) {
    const { data: novos, error: erroProj } = await admin.from('projects').upsert(
      projetos.map((p) => ({
        organization_id: org.id, pronac: p.pronac!.trim(), nome: p.nome.trim(),
        prestai_project_id: p.id && UUID.test(p.id) ? p.id : null,
      })),
      { onConflict: 'organization_id,pronac', ignoreDuplicates: true },
    ).select('id');
    if (erroProj) {
      return json({ erro: 'A organização foi cadastrada, mas os projetos não. Use a importação em lote.' }, 500);
    }
    criados = novos?.length ?? 0;
  }

  await admin.from('audit_log').insert({
    ator_id: quem.id, acao: 'cadastro_por_slug', entidade: 'organizations', entidade_id: org.id,
    organization_id: org.id, depois: { slug, projetos: criados },
  });

  return json({ ok: true, organization_id: org.id, criados, ignorados: d.projetos.length - criados });
});
