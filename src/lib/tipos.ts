export type StatusChamado =
  | 'aberto' | 'em_triagem' | 'em_atendimento' | 'aguardando_cliente'
  | 'resolvido' | 'encerrado' | 'reaberto';

export type Vinculo = { organization_id: string; razao_social: string; papel: 'admin' | 'membro' };

export type Sessao = {
  userId: string;
  email: string;
  nome: string;
  vinculos: Vinculo[];
  equipe: null | { papel: 'admin' | 'comercial' | 'implantacao' | 'atendimento' };
  aal: 'aal1' | 'aal2';
};

export type Projeto = { id: string; pronac: string; nome: string };
export type Categoria = { id: string; nome: string; ativa: boolean; exige_humano: boolean };

export type Chamado = {
  id: string;
  protocolo: string;
  organization_id: string;
  project_id: string | null;
  solicitante_id: string;
  categoria_id: string;
  assunto: string;
  descricao: string;
  severidade_sugerida: 'baixa' | 'media' | 'alta';
  status: StatusChamado;
  responsavel: string | null;
  aberto_em: string;
  primeira_resposta_em: string | null;
  updated_at: string;
  categoria?: string;
  pronac?: string | null;
  organizacao?: string;
};

export type Mensagem = {
  id: string;
  autor_tipo: 'cliente' | 'atendente' | 'sistema';
  texto: string;
  visibilidade: 'cliente' | 'interna';
  created_at: string;
};

export type Anexo = { id: string; storage_path: string; nome: string; created_at: string };

export type Material = {
  id: string;
  titulo: string;
  descricao: string | null;
  tipo: string;
  modulo: string | null;
  arquivo_path: string | null;
  url_externa: string | null;
  versao: string;
  ativo: boolean;
  updated_at: string;
};

export type BuscaPrestai = { nome: string; slug: string; ativa: boolean; jaCadastrada: boolean; projetos: { pronac: string | null; nome: string }[] };
export type Organizacao = { id: string; razao_social: string; status: string; prestai_org_id: string | null; prestai_org_slug: string | null };
export type Membro = { id: string; nome: string; papel: 'admin' | 'membro'; situacao: string; user_id: string; prestai_user_id: string | null };
export type ProjetoEquipe = { id: string; pronac: string; nome: string; ativo: boolean; prestai_project_id: string | null };

// Identificador do sistema PrestAí: UUID, cadastrado à mão pelo comercial.
/** Slug do PrestAí: minúsculas, números e hífens, sem hífen no começo, no fim ou repetido. */
export const PADRAO_SLUG = '[a-z0-9]+(-[a-z0-9]+)*';
export const PADRAO_UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

export const ROTULO_STATUS: Record<StatusChamado, string> = {
  aberto: 'Aberto',
  em_triagem: 'Em triagem',
  em_atendimento: 'Em atendimento',
  aguardando_cliente: 'Aguardando você',
  resolvido: 'Resolvido',
  encerrado: 'Encerrado',
  reaberto: 'Reaberto',
};

export const ROTULO_TIPO: Record<string, string> = {
  manual: 'Manual', infografico: 'Infográfico', mapa_mental: 'Mapa mental', apresentacao: 'Apresentação',
  roteiro: 'Roteiro', checklist: 'Checklist', video: 'Vídeo', outro: 'Outro',
};

export const ROTULO_SEVERIDADE = { baixa: 'Baixa', media: 'Média', alta: 'Alta' };

export const ABERTOS: StatusChamado[] = ['aberto', 'em_triagem', 'em_atendimento', 'aguardando_cliente', 'reaberto'];

export type Api = {
  demo: boolean;
  sessao(): Promise<Sessao | null>;
  aoMudarSessao(cb: () => void): () => void;
  entrar(email: string, senha: string): Promise<void>;
  sair(): Promise<void>;
  recuperarSenha(email: string): Promise<void>;
  definirSenha(senha: string): Promise<void>;
  projetos(org: string): Promise<Projeto[]>;
  categorias(): Promise<Categoria[]>;
  chamados(org: string): Promise<Chamado[]>;
  chamado(id: string): Promise<{ chamado: Chamado; mensagens: Mensagem[]; anexos: Anexo[] }>;
  abrirChamado(d: { org: string; categoria: string; assunto: string; descricao: string; projeto: string | null; severidade: string }): Promise<Chamado>;
  responder(id: string, texto: string): Promise<void>;
  reabrir(id: string, motivo: string): Promise<void>;
  anexar(c: Chamado, arquivo: File): Promise<void>;
  urlAnexo(path: string): Promise<string>;
  acompanhar(id: string, cb: () => void): () => void;
  materiais(): Promise<Material[]>;
  urlMaterial(path: string): Promise<string>;
  mfaIniciar(): Promise<{ fatorId: string; qr: string; segredo: string } | { fatorId: string; qr: null; segredo: null }>;
  mfaConfirmar(fatorId: string, codigo: string): Promise<void>;
  organizacoes(): Promise<Organizacao[]>;
  /** Cadastro manual, só para quando o PrestAí não responder. O caminho normal é buscar pelo slug. */
  criarOrganizacao(d: { razao: string; prestaiSlug: string }): Promise<void>;
  buscarOrganizacaoPrestai(slug: string): Promise<BuscaPrestai>;
  cadastrarOrganizacaoPrestai(slug: string): Promise<{ criados: number; ignorados: number }>;
  vincularSlugOrganizacao(id: string, slug: string | null): Promise<void>;
  vincularOrganizacao(id: string, prestaiOrg: string | null): Promise<void>;
  membros(org: string): Promise<Membro[]>;
  vincularMembro(id: string, prestaiUser: string | null): Promise<void>;
  projetosOrg(org: string): Promise<ProjetoEquipe[]>;
  criarProjeto(org: string, d: { pronac: string; nome: string; prestaiProjeto: string }): Promise<void>;
  /** Cadastra vários projetos de uma vez. PRONAC já existente na organização é ignorado. */
  importarProjetos(org: string, itens: { pronac: string; nome: string }[]): Promise<{ criados: number; ignorados: number }>;
  vincularProjeto(id: string, prestaiProjeto: string | null): Promise<void>;
  convidar(org: string, email: string, nome: string, papel: string): Promise<void>;
  alterarMembro(id: string, situacao: string): Promise<void>;
  todosMateriais(): Promise<Material[]>;
  publicarMaterial(d: { titulo: string; tipo: string; modulo: string; arquivo: File | null; url: string }): Promise<void>;
  alternarMaterial(id: string, ativo: boolean): Promise<void>;
  todasCategorias(): Promise<Categoria[]>;
  criarCategoria(nome: string, exigeHumano: boolean): Promise<void>;
  alternarCategoria(id: string, ativa: boolean): Promise<void>;
  todosChamados(): Promise<Chamado[]>;
};
