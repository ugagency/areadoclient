import { createClient } from '@supabase/supabase-js';
import type { Api, Chamado, Sessao } from './tipos';

const sb = createClient(import.meta.env.VITE_SUPABASE_URL ?? '', import.meta.env.VITE_SUPABASE_ANON_KEY ?? '');

// Mensagens de regra de negócio vêm do banco em português. O resto vira texto genérico.
const REGRA = new Set(['P0001', 'P0002', '22023', '42501']);
export class ErroApp extends Error {}

// Duplicidade vem do banco com o nome da restrição; aqui vira frase para quem cadastra.
function duplicado(m: string) {
  if (m.includes('slug')) return 'Esse slug do PrestAí já está ligado a outra organização.';
  if (m.includes('prestai')) return 'Esse ID do PrestAí já está ligado a outro registro.';
  if (m.includes('pronac')) return 'Esse PRONAC já está cadastrado nesta organização.';
  return 'Esse registro já existe.';
}

type FatorMfa = Awaited<ReturnType<Api['mfaIniciar']>>;
let mfaEmCurso: Promise<FatorMfa> | null = null;

function ok<T>(r: { data: T | null; error: { code?: string; message: string } | null }): T {
  if (r.error) {
    const msg = r.error.code === '23505' ? duplicado(r.error.message)
      : r.error.code === '23514' && /slug/i.test(r.error.message) ? 'Slug inválido. Use letras minúsculas, números e hífens, como no PrestAí.'
      : r.error.code && REGRA.has(r.error.code) ? r.error.message : 'Não foi possível concluir. Tente de novo.';
    throw new ErroApp(msg);
  }
  return r.data as T;
}

const normalizar = (c: any): Chamado => ({
  ...c,
  categoria: c.chamado_categorias?.nome,
  pronac: c.projects?.pronac ?? null,
  organizacao: c.organizations?.razao_social,
});
const SEL = '*, chamado_categorias(nome), projects(pronac), organizations(razao_social)';

const assinada = async (bucket: string, path: string) =>
  ok(await sb.storage.from(bucket).createSignedUrl(path, 300)).signedUrl;

async function mfaIniciarUmaVez(): Promise<FatorMfa> {
  const fatores = ok(await sb.auth.mfa.listFactors());
  const pronto = fatores.totp.find((f) => f.status === 'verified');
  if (pronto) return { fatorId: pronto.id, qr: null, segredo: null };
  const f = ok<any>((await sb.auth.mfa.enroll({ factorType: 'totp' })) as any);
  return { fatorId: f.id as string, qr: f.totp.qr_code as string, segredo: f.totp.secret as string };
}

export const real: Api = {
  demo: false,

  async sessao() {
    const { data } = await sb.auth.getSession();
    const s = data.session;
    if (!s) return null;
    const { data: nivel } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    const uid = s.user.id;
    const m = ok(await sb.from('org_members')
      .select('organization_id, papel, nome, organizations(razao_social)')
      .eq('user_id', uid).eq('situacao', 'ativo'));
    const eq = ok<any>(await sb.from('staff').select('papel, nome').eq('user_id', uid).eq('ativo', true).maybeSingle());
    return {
      userId: uid,
      email: s.user.email ?? '',
      nome: eq?.nome ?? (m as any[])[0]?.nome ?? s.user.email ?? '',
      vinculos: (m as any[]).map((x) => ({
        organization_id: x.organization_id, papel: x.papel, razao_social: x.organizations?.razao_social ?? '',
      })),
      equipe: eq ? { papel: eq.papel } : null,
      aal: (nivel?.currentLevel ?? 'aal1') as Sessao['aal'],
    } as Sessao;
  },

  aoMudarSessao(cb) {
    const { data } = sb.auth.onAuthStateChange(() => { setTimeout(cb, 0); });
    return () => data.subscription.unsubscribe();
  },

  async entrar(email, senha) {
    const { error } = await sb.auth.signInWithPassword({ email, password: senha });
    // Não indica qual campo errou.
    if (error) throw new ErroApp('E-mail ou senha incorretos.');
    await sb.rpc('ativar_meu_acesso');
  },
  async sair() { await sb.auth.signOut(); },
  async recuperarSenha(email) {
    await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/definir-senha` });
  },
  async definirSenha(senha) {
    const { error } = await sb.auth.updateUser({ password: senha });
    if (error) throw new ErroApp('Não foi possível definir a senha. O link pode ter expirado.');
    await sb.rpc('ativar_meu_acesso');
  },

  async projetos(org) {
    return ok(await sb.from('projects').select('id, pronac, nome').eq('organization_id', org).eq('ativo', true).order('pronac'));
  },
  async categorias() {
    return ok(await sb.from('chamado_categorias').select('id, nome, ativa, exige_humano').eq('ativa', true).order('ordem').order('nome'));
  },
  async chamados(org) {
    const r = ok(await sb.from('chamados').select(SEL).eq('organization_id', org).order('aberto_em', { ascending: false }));
    return (r as any[]).map(normalizar);
  },
  async chamado(id) {
    const c = ok(await sb.from('chamados').select(SEL).eq('id', id).single());
    const mensagens = ok(await sb.from('chamado_mensagens').select('id, autor_tipo, texto, visibilidade, created_at').eq('chamado_id', id).order('created_at'));
    const anexos = ok(await sb.from('chamado_anexos').select('id, storage_path, nome, created_at').eq('chamado_id', id).order('created_at'));
    return { chamado: normalizar(c), mensagens: mensagens as any, anexos: anexos as any };
  },
  async abrirChamado(d) {
    return ok(await sb.rpc('abrir_chamado', {
      p_organization_id: d.org, p_categoria_id: d.categoria, p_assunto: d.assunto, p_descricao: d.descricao,
      p_project_id: d.projeto, p_severidade: d.severidade,
    }));
  },
  async responder(id, texto) { ok(await sb.rpc('responder_chamado', { p_chamado_id: id, p_texto: texto })); },
  async reabrir(id, motivo) { ok(await sb.rpc('reabrir_chamado', { p_chamado_id: id, p_motivo: motivo })); },
  async anexar(c, arquivo) {
    const limpo = arquivo.name.normalize('NFD').replace(/[^\w.-]+/g, '_');
    const path = `${c.organization_id}/${c.id}/${crypto.randomUUID()}-${limpo}`;
    ok(await sb.storage.from('anexos').upload(path, arquivo));
    ok(await sb.rpc('registrar_anexo', {
      p_chamado_id: c.id, p_storage_path: path, p_nome: arquivo.name, p_mime: arquivo.type, p_bytes: arquivo.size,
    }));
  },
  urlAnexo: (path) => assinada('anexos', path),
  acompanhar(id, cb) {
    const canal = sb.channel(`chamado-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chamados', filter: `id=eq.${id}` }, cb)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chamado_mensagens', filter: `chamado_id=eq.${id}` }, cb)
      .subscribe();
    return () => { sb.removeChannel(canal); };
  },

  async materiais() {
    return ok(await sb.from('conteudos').select('*').eq('ativo', true).order('titulo')) as any;
  },
  urlMaterial: (path) => assinada('materiais', path),

  mfaIniciar() {
    // Em desenvolvimento o React executa o efeito duas vezes; sem isso saem dois cadastros de fator.
    return (mfaEmCurso ??= mfaIniciarUmaVez().finally(() => { mfaEmCurso = null; }));
  },
  async mfaConfirmar(fatorId, codigo) {
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: fatorId, code: codigo });
    if (error) throw new ErroApp('Código inválido.');
  },

  async organizacoes() {
    return ok(await sb.from('organizations').select('id, razao_social, status, prestai_org_id, prestai_org_slug').order('razao_social')) as any;
  },
  async criarOrganizacao(d) {
    ok(await sb.from('organizations').insert({
      razao_social: d.razao.trim(), prestai_org_slug: d.prestaiSlug.trim().toLowerCase() || null,
    }));
  },
  async buscarOrganizacaoPrestai(slug) {
    const { data, error } = await sb.functions.invoke('organizacao-prestai', { body: { acao: 'buscar', slug } });
    if (error || data?.erro) throw new ErroApp(data?.erro ?? 'Não foi possível consultar o PrestAí.');
    return data;
  },
  async cadastrarOrganizacaoPrestai(slug) {
    const { data, error } = await sb.functions.invoke('organizacao-prestai', { body: { acao: 'cadastrar', slug } });
    if (error || data?.erro) throw new ErroApp(data?.erro ?? 'Não foi possível cadastrar a organização.');
    return { criados: data.criados, ignorados: data.ignorados };
  },
  async vincularSlugOrganizacao(id, slug) {
    ok(await sb.from('organizations').update({ prestai_org_slug: slug ? slug.trim().toLowerCase() : null }).eq('id', id));
  },
  async vincularOrganizacao(id, prestaiOrg) {
    ok(await sb.from('organizations').update({ prestai_org_id: prestaiOrg }).eq('id', id));
  },
  async membros(org) {
    return ok(await sb.from('org_members').select('id, nome, papel, situacao, user_id, prestai_user_id').eq('organization_id', org).order('nome')) as any;
  },
  async vincularMembro(id, prestaiUser) {
    ok(await sb.rpc('vincular_usuario_prestai', { p_member_id: id, p_prestai_user_id: prestaiUser }));
  },
  async projetosOrg(org) {
    return ok(await sb.from('projects').select('id, pronac, nome, ativo, prestai_project_id').eq('organization_id', org).order('pronac')) as any;
  },
  async criarProjeto(org, d) {
    ok(await sb.from('projects').insert({
      organization_id: org, pronac: d.pronac.trim(), nome: d.nome.trim(), prestai_project_id: d.prestaiProjeto.trim() || null,
    }));
  },
  async importarProjetos(org, itens) {
    if (!itens.length) return { criados: 0, ignorados: 0 };
    const linhas = itens.map((i) => ({ organization_id: org, pronac: i.pronac.trim(), nome: i.nome.trim() }));
    const novos = ok<any[]>(await sb.from('projects')
      .upsert(linhas, { onConflict: 'organization_id,pronac', ignoreDuplicates: true }).select('id'));
    return { criados: novos.length, ignorados: linhas.length - novos.length };
  },
  async vincularProjeto(id, prestaiProjeto) {
    ok(await sb.from('projects').update({ prestai_project_id: prestaiProjeto }).eq('id', id));
  },
  async convidar(org, email, nome, papel) {
    const { data, error } = await sb.functions.invoke('convidar-usuario', {
      body: { organization_id: org, email, nome, papel },
    });
    if (error || data?.erro) throw new ErroApp(data?.erro ?? 'Não foi possível enviar o convite.');
  },
  async alterarMembro(id, situacao) { ok(await sb.rpc('alterar_membro', { p_member_id: id, p_situacao: situacao })); },

  async todosMateriais() {
    return ok(await sb.from('conteudos').select('*').order('updated_at', { ascending: false })) as any;
  },
  async publicarMaterial(d) {
    let arquivo_path: string | null = null;
    if (d.arquivo) {
      arquivo_path = `${crypto.randomUUID()}-${d.arquivo.name.normalize('NFD').replace(/[^\w.-]+/g, '_')}`;
      ok(await sb.storage.from('materiais').upload(arquivo_path, d.arquivo));
    }
    ok(await sb.from('conteudos').insert({
      titulo: d.titulo, tipo: d.tipo, modulo: d.modulo || null, arquivo_path,
      url_externa: d.url || null, ativo: true, publicado_em: new Date().toISOString(),
    }));
  },
  async alternarMaterial(id, ativo) { ok(await sb.from('conteudos').update({ ativo }).eq('id', id)); },

  async todasCategorias() {
    return ok(await sb.from('chamado_categorias').select('id, nome, ativa, exige_humano').order('ordem').order('nome')) as any;
  },
  async criarCategoria(nome, exigeHumano) {
    ok(await sb.from('chamado_categorias').insert({ nome, exige_humano: exigeHumano }));
  },
  async alternarCategoria(id, ativa) { ok(await sb.from('chamado_categorias').update({ ativa }).eq('id', id)); },
  async todosChamados() {
    const r = ok(await sb.from('chamados').select(SEL).order('aberto_em', { ascending: false }).limit(200));
    return (r as any[]).map(normalizar);
  },
};
