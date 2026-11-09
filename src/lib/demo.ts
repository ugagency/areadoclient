// Dados fictícios em memória, para demonstração e verificação de tela sem Supabase.
// Só entra no pacote com VITE_DEMO=1.
import type { Api, Categoria, Chamado, Material, Membro, Mensagem, Organizacao, Sessao } from './tipos';

const agora = () => new Date().toISOString();
const atras = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
const gid = () => Math.random().toString(36).slice(2);

const orgs: Organizacao[] = [
  { id: 'org1', razao_social: 'Instituto Exemplo de Cultura', cnpj: '00000000000100', status: 'ativa' },
  { id: 'org2', razao_social: 'Associação Modelo das Artes', cnpj: '00000000000200', status: 'ativa' },
];
const categorias: Categoria[] = [
  { id: 'c1', nome: 'Dúvida de uso', ativa: true, exige_humano: false },
  { id: 'c2', nome: 'Erro no sistema', ativa: true, exige_humano: true },
  { id: 'c3', nome: 'Acessos e usuários', ativa: true, exige_humano: false },
];
const chamados: Chamado[] = [
  { id: 'd1', protocolo: '2026-0002', organization_id: 'org1', project_id: 'p1', solicitante_id: 'u1', categoria_id: 'c2', assunto: 'Extrato não importou', descricao: 'Texto de exemplo do chamado. Dados fictícios para demonstração.', severidade_sugerida: 'alta', status: 'aguardando_cliente', responsavel: 'Atendente', aberto_em: atras(26), primeira_resposta_em: atras(25), updated_at: atras(2), categoria: 'Erro no sistema', pronac: '000001', organizacao: orgs[0].razao_social },
  { id: 'd2', protocolo: '2026-0001', organization_id: 'org1', project_id: null, solicitante_id: 'u1', categoria_id: 'c3', assunto: 'Incluir novo usuário', descricao: 'Texto de exemplo do chamado.', severidade_sugerida: 'baixa', status: 'resolvido', responsavel: 'Atendente', aberto_em: atras(90), primeira_resposta_em: atras(88), updated_at: atras(80), categoria: 'Acessos e usuários', pronac: null, organizacao: orgs[0].razao_social },
];
const mensagens: Record<string, Mensagem[]> = {
  d1: [{ id: 'm1', autor_tipo: 'atendente', texto: 'Pode enviar o arquivo que deu erro?', visibilidade: 'cliente', created_at: atras(2) }],
  d2: [{ id: 'm2', autor_tipo: 'atendente', texto: 'Usuário incluído.', visibilidade: 'cliente', created_at: atras(80) }],
};
const anexos: Record<string, any[]> = {};
const materiais: Material[] = [
  { id: 'a1', titulo: 'Manual de exemplo', descricao: 'Material fictício para demonstração.', tipo: 'manual', modulo: 'Comprovação Financeira', arquivo_path: 'x.pdf', url_externa: null, versao: '1', ativo: true, updated_at: atras(48) },
  { id: 'a2', titulo: 'Infográfico de exemplo', descricao: 'Material fictício para demonstração.', tipo: 'infografico', modulo: 'Prestação de Contas', arquivo_path: 'y.pdf', url_externa: null, versao: '2', ativo: true, updated_at: atras(72) },
  { id: 'a3', titulo: 'Vídeo de exemplo', descricao: null, tipo: 'video', modulo: 'Gestão de Contrapartidas', arquivo_path: null, url_externa: '#', versao: '1', ativo: true, updated_at: atras(96) },
];
const membros: Record<string, Membro[]> = {
  org1: [
    { id: 'mb1', nome: 'Pessoa Administradora', papel: 'admin', situacao: 'ativo', user_id: 'u1' },
    { id: 'mb2', nome: 'Pessoa Convidada', papel: 'membro', situacao: 'convidado', user_id: 'u2' },
  ],
  org2: [],
};

let logado: 'cliente' | 'equipe' | null = null;
let mfaOk = false;
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());

export const demo: Api = {
  demo: true,
  async sessao() {
    if (!logado) return null;
    const cliente = logado === 'cliente';
    return {
      userId: cliente ? 'u1' : 'u9', email: cliente ? 'cliente@demo' : 'equipe@demo',
      nome: cliente ? 'Pessoa Administradora' : 'Atendente',
      vinculos: cliente ? [{ organization_id: 'org1', razao_social: orgs[0].razao_social, papel: 'admin' }] : [],
      equipe: cliente ? null : { papel: 'admin' },
      aal: mfaOk ? 'aal2' : 'aal1',
    } as Sessao;
  },
  aoMudarSessao(cb) { ouvintes.add(cb); return () => ouvintes.delete(cb); },
  async entrar(email) { logado = email.includes('equipe') ? 'equipe' : 'cliente'; avisar(); },
  async sair() { logado = null; mfaOk = false; avisar(); },
  async recuperarSenha() {},
  async definirSenha() { logado = 'cliente'; avisar(); },
  async projetos() { return [{ id: 'p1', pronac: '000001', nome: 'Projeto de exemplo' }]; },
  async categorias() { return categorias.filter((c) => c.ativa); },
  async chamados(org) { return chamados.filter((c) => c.organization_id === org); },
  async chamado(id) {
    const c = chamados.find((x) => x.id === id);
    if (!c) throw new Error('Chamado não encontrado');
    return { chamado: { ...c }, mensagens: [...(mensagens[id] ?? [])], anexos: [...(anexos[id] ?? [])] };
  },
  async abrirChamado(d) {
    const n = String(chamados.length + 1).padStart(4, '0');
    const c: Chamado = {
      id: gid(), protocolo: `2026-${n}`, organization_id: d.org, project_id: d.projeto, solicitante_id: 'u1',
      categoria_id: d.categoria, assunto: d.assunto, descricao: d.descricao, severidade_sugerida: d.severidade as any,
      status: 'aberto', responsavel: null, aberto_em: agora(), primeira_resposta_em: null, updated_at: agora(),
      categoria: categorias.find((x) => x.id === d.categoria)?.nome, pronac: d.projeto ? '000001' : null,
      organizacao: orgs[0].razao_social,
    };
    chamados.unshift(c);
    return c;
  },
  async responder(id, texto) {
    (mensagens[id] ??= []).push({ id: gid(), autor_tipo: 'cliente', texto, visibilidade: 'cliente', created_at: agora() });
    const c = chamados.find((x) => x.id === id)!;
    if (c.status === 'aguardando_cliente') c.status = 'em_atendimento';
  },
  async reabrir(id, motivo) {
    (mensagens[id] ??= []).push({ id: gid(), autor_tipo: 'cliente', texto: motivo, visibilidade: 'cliente', created_at: agora() });
    chamados.find((x) => x.id === id)!.status = 'reaberto';
  },
  async anexar(c, arquivo) {
    (anexos[c.id] ??= []).push({ id: gid(), storage_path: arquivo.name, nome: arquivo.name, created_at: agora() });
  },
  async urlAnexo() { return '#'; },
  acompanhar() { return () => {}; },
  async materiais() { return materiais.filter((m) => m.ativo); },
  async urlMaterial() { return '#'; },
  async mfaIniciar() { return { fatorId: 'f', qr: null, segredo: null }; },
  async mfaConfirmar() { mfaOk = true; avisar(); },
  async organizacoes() { return orgs; },
  async criarOrganizacao(razao, cnpj) {
    const id = gid();
    orgs.push({ id, razao_social: razao, cnpj, status: 'ativa' });
    membros[id] = [];
  },
  async membros(org) { return membros[org] ?? []; },
  async convidar(org, _email, nome, papel) {
    (membros[org] ??= []).push({ id: gid(), nome, papel: papel as any, situacao: 'convidado', user_id: gid() });
  },
  async alterarMembro(id, situacao) {
    Object.values(membros).flat().filter((m) => m.id === id).forEach((m) => { m.situacao = situacao; });
  },
  async todosMateriais() { return materiais; },
  async publicarMaterial(d) {
    materiais.unshift({ id: gid(), titulo: d.titulo, descricao: null, tipo: d.tipo, modulo: d.modulo || null, arquivo_path: d.arquivo?.name ?? null, url_externa: d.url || null, versao: '1', ativo: true, updated_at: agora() });
  },
  async alternarMaterial(id, ativo) { materiais.find((m) => m.id === id)!.ativo = ativo; },
  async todasCategorias() { return categorias; },
  async criarCategoria(nome, exige) { categorias.push({ id: gid(), nome, ativa: true, exige_humano: exige }); },
  async alternarCategoria(id, ativa) { categorias.find((c) => c.id === id)!.ativa = ativa; },
  async todosChamados() { return chamados; },
};
