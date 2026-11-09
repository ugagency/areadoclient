// Convida usuário para uma organização. Quem pode: admin ativo da organização
// ou equipe (admin/comercial) com MFA. A organização é validada contra a sessão.
import { cors, json, servico } from '../_shared/comum.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ erro: 'Método não permitido' }, 405);

  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const admin = servico();
  const { data: sessao } = await admin.auth.getUser(token);
  const quem = sessao?.user;
  if (!quem) return json({ erro: 'Sessão inválida' }, 401);

  const { organization_id, email, nome, papel = 'membro' } = await req.json().catch(() => ({}));
  if (!organization_id || !email || !nome || !['admin', 'membro'].includes(papel)) {
    return json({ erro: 'Dados incompletos' }, 400);
  }

  const { data: membro } = await admin.from('org_members').select('papel, situacao, organizations(status)')
    .eq('organization_id', organization_id).eq('user_id', quem.id).maybeSingle();
  const { data: equipe } = await admin.from('staff').select('papel, ativo').eq('user_id', quem.id).maybeSingle();
  const aal = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal;

  const adminDaOrg = membro?.papel === 'admin' && membro?.situacao === 'ativo'
    && (membro.organizations as unknown as { status: string })?.status === 'ativa';
  const equipeLiberada = equipe?.ativo && aal === 'aal2' && ['admin', 'comercial'].includes(equipe.papel);
  if (!adminDaOrg && !equipeLiberada) return json({ erro: 'Sem permissão' }, 403);

  let userId: string | null = null;
  const convite = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${Deno.env.get('APP_URL')}/definir-senha`,
    data: { nome },
  });
  if (convite.data?.user) {
    userId = convite.data.user.id;
  } else {
    const { data } = await admin.rpc('buscar_usuario_por_email', { p_email: email });
    userId = data;
  }
  if (!userId) return json({ erro: 'Não foi possível enviar o convite' }, 502);

  // Usuário com conta existente entra ativo, porque não passa pelo primeiro acesso.
  const { error } = await admin.from('org_members').upsert({
    organization_id, user_id: userId, nome, papel,
    situacao: convite.data?.user ? 'convidado' : 'ativo',
  }, { onConflict: 'organization_id,user_id', ignoreDuplicates: true });
  if (error) return json({ erro: 'Não foi possível registrar o usuário' }, 500);

  // A função roda como serviço: registra aqui quem convidou.
  await admin.from('audit_log').insert({
    ator_id: quem.id, acao: 'convite', entidade: 'org_members', entidade_id: userId,
    organization_id, depois: { nome, papel },
  });

  return json({ ok: true });
});
