// FUNCAO PARA PUBLICAR NO PROJETO SUPABASE DO PRESTAÍ (nome: consulta-organizacao).
// NAO PUBLICADA. Responde, a quem tem o segredo, o nome e os projetos de uma organização
// a partir do slug. Só leitura. Devolve também e-mail, nome e papel dos usuários da organização.
// Não devolve documentos, valores nem senhas.
//
// Segredo necessário no PrestAí: CLIENTE_API_SECRET (texto longo e aleatório).
// O mesmo valor vai na Área do Cliente como PRESTAI_API_SECRET, e a URL desta função como
// PRESTAI_API_URL (https://<ref-do-prestai>.supabase.co/functions/v1/consulta-organizacao).
// Publicar com verify_jwt desligado: a autenticação é o segredo abaixo.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

function segredoValido(req: Request): boolean {
  const esperado = new TextEncoder().encode(Deno.env.get('CLIENTE_API_SECRET') ?? '');
  const recebido = new TextEncoder().encode(req.headers.get('x-api-secret') ?? '');
  if (esperado.length < 32 || esperado.length !== recebido.length) return false;
  let diferenca = 0;
  for (let i = 0; i < esperado.length; i++) diferenca |= esperado[i] ^ recebido[i];
  return diferenca === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return resposta({ erro: 'Método não permitido' }, 405);
  if (!segredoValido(req)) return resposta({ erro: 'Não autorizado' }, 401);

  const { slug } = await req.json().catch(() => ({}));
  if (typeof slug !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return resposta({ erro: 'Slug inválido' }, 400);
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: org } = await db.from('organizations').select('id, nome, slug, ativo').eq('slug', slug).maybeSingle();
  if (!org) return resposta({ erro: 'Não encontrada' }, 404);

  const { data: projetos } = await db.from('projects').select('id, pronac, nome')
    .eq('organization_id', org.id).order('created_at', { ascending: true });

  // Usuários da organização: só e-mail, nome (se houver) e papel na organização (admin ou membro).
  const { data: vinculos } = await db.from('organization_users').select('user_id, role').eq('organization_id', org.id);
  const usuarios = (await Promise.all((vinculos ?? []).map(async (v) => {
    const { data } = await db.auth.admin.getUserById(v.user_id);
    const email = data?.user?.email;
    if (!email) return null;
    const nome = data.user.user_metadata?.nome;
    return { email, nome: typeof nome === 'string' ? nome : null, papel: v.role === 'admin' ? 'admin' : 'membro' };
  }))).filter(Boolean);

  return resposta({ id: org.id, nome: org.nome, slug: org.slug, ativo: org.ativo, projetos: projetos ?? [], usuarios });
});
