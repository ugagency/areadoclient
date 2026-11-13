import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, data, mensagemErro } from '../lib/api';
import { PADRAO_UUID, ROTULO_TIPO, type Categoria, type Chamado, type Material, type Membro, type Organizacao, type ProjetoEquipe } from '../lib/tipos';
import { useApp } from '../main';
import { SeloStatus } from './Suporte';

function PassoMfa() {
  const [fator, setFator] = useState<Awaited<ReturnType<typeof api.mfaIniciar>> | null>(null);
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState('');

  useEffect(() => { api.mfaIniciar().then(setFator).catch((e) => setErro(mensagemErro(e))); }, []);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    try { await api.mfaConfirmar(fator!.fatorId, codigo); } catch (x) { setErro(mensagemErro(x)); }
  }

  return (
    <main className="pagina estreita">
      <div className="sobre">Equipe</div>
      <h1 className="titulo">Verificação em duas etapas</h1>
      <p className="sub">O painel da equipe só abre com a verificação concluída.</p>
      <form className="card" onSubmit={enviar}>
        {fator?.qr && (
          <div style={{ marginBottom: 18 }}>
            <p className="mudo" style={{ marginBottom: 12 }}>Leia o QR Code no seu app autenticador.</p>
            <div className="qr"><img src={fator.qr} alt="QR Code para o app autenticador" /></div>
            <p className="fraco" style={{ marginTop: 10 }}>Ou digite o código: <code>{fator.segredo}</code></p>
          </div>
        )}
        <label className="campo"><span>Código de 6 dígitos</span>
          <input inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" value={codigo} onChange={(e) => setCodigo(e.target.value)} />
        </label>
        {erro && <div className="alerta" role="alert">{erro}</div>}
        <button className="btn" disabled={!fator}>Confirmar</button>
      </form>
    </main>
  );
}

function IdPrestai({ rotulo, valor, aoSalvar }: { rotulo: string; valor: string | null; aoSalvar: (v: string | null) => Promise<void> }) {
  const [edit, setEdit] = useState(false);
  const [txt, setTxt] = useState(valor ?? '');
  useEffect(() => { setTxt(valor ?? ''); }, [valor]);
  if (!edit) {
    return (
      <div className="fraco" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>{rotulo}:</span>
        {valor ? <code>{valor}</code> : <span className="selo vez">Sem vínculo</span>}
        <button type="button" className="btn contorno pequeno" onClick={() => setEdit(true)}>{valor ? 'Alterar' : 'Informar'}</button>
      </div>
    );
  }
  return (
    <form style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }} onSubmit={async (e) => {
      e.preventDefault();
      await aoSalvar(txt.trim() || null);
      setEdit(false);
    }}>
      <input aria-label={rotulo} placeholder="uuid do PrestAí" pattern={PADRAO_UUID} value={txt} onChange={(e) => setTxt(e.target.value)} style={{ minWidth: 280 }} />
      <button className="btn pequeno">Salvar</button>
      <button type="button" className="btn contorno pequeno" onClick={() => { setTxt(valor ?? ''); setEdit(false); }}>Cancelar</button>
    </form>
  );
}

function Organizacoes() {
  const [orgs, setOrgs] = useState<Organizacao[]>([]);
  const [sel, setSel] = useState<Organizacao | null>(null);
  const [membros, setMembros] = useState<Membro[]>([]);
  const [projetos, setProjetos] = useState<ProjetoEquipe[]>([]);
  const [novoProj, setNovoProj] = useState({ pronac: '', nome: '', prestaiProjeto: '' });
  const [nova, setNova] = useState({ razao: '', cnpj: '', prestaiOrg: '' });
  const [conv, setConv] = useState({ nome: '', email: '', papel: 'admin' });
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');

  const carregar = useCallback(() => api.organizacoes().then(setOrgs).catch((e) => setErro(mensagemErro(e))), []);
  useEffect(() => { carregar(); }, [carregar]);
  const verMembros = (o: Organizacao) => Promise.all([api.membros(o.id), api.projetosOrg(o.id)]).then(([m, p]) => { setSel(o); setMembros(m); setProjetos(p); });
  const recarregarSel = async (id: string) => {
    const lista = await api.organizacoes(); setOrgs(lista);
    const o = lista.find((x) => x.id === id); if (o) await verMembros(o);
  };

  async function tentar(fn: () => Promise<void>, sucesso = '') {
    setErro(''); setOk('');
    try { await fn(); setOk(sucesso); } catch (x) { setErro(mensagemErro(x)); }
  }

  return (
    <div className="duas">
      <div>
        <form className="card" style={{ marginBottom: 16 }} onSubmit={(e) => {
          e.preventDefault();
          tentar(async () => { await api.criarOrganizacao(nova); setNova({ razao: '', cnpj: '', prestaiOrg: '' }); await carregar(); });
        }}>
          <h2 className="h2" style={{ marginBottom: 16 }}>Nova organização</h2>
          <label className="campo"><span>Razão social</span><input required value={nova.razao} onChange={(e) => setNova({ ...nova, razao: e.target.value })} /></label>
          <label className="campo"><span>CNPJ (opcional)</span><input pattern="[0-9]{2}\.?[0-9]{3}\.?[0-9]{3}\/?[0-9]{4}-?[0-9]{2}" title="CNPJ com 14 dígitos" value={nova.cnpj} onChange={(e) => setNova({ ...nova, cnpj: e.target.value })} /></label>
          <label className="campo"><span>ID da organização no PrestAí</span><input pattern={PADRAO_UUID} placeholder="uuid copiado do PrestAí" value={nova.prestaiOrg} onChange={(e) => setNova({ ...nova, prestaiOrg: e.target.value })} /></label>
          <button className="btn pequeno">Criar</button>
        </form>
        <div className="lista">
          {orgs.map((o) => (
            <button key={o.id} className="linha" style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }} onClick={() => verMembros(o)}>
              <div className="corpo"><b>{o.razao_social}</b><div className="fraco">{o.cnpj ?? 'Sem CNPJ'}</div></div>
              {!o.prestai_org_id && <span className="selo vez">Sem ID PrestAí</span>}
              <span className="selo">{o.status}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        {erro && <div className="alerta" role="alert">{erro}</div>}
        {ok && <div className="aviso" role="status">{ok}</div>}
        {!sel ? <p className="mudo">Selecione uma organização para ver e convidar usuários.</p> : (
          <>
            <h2 className="h2" style={{ marginBottom: 10 }}>{sel.razao_social}</h2>
            <div style={{ marginBottom: 16 }}>
              <IdPrestai rotulo="ID no PrestAí" valor={sel.prestai_org_id} aoSalvar={async (v) => { await tentar(async () => { await api.vincularOrganizacao(sel.id, v); await recarregarSel(sel.id); }, 'Vínculo atualizado.'); }} />
            </div>
            <div className="lista" style={{ marginBottom: 20 }}>
              {membros.map((m) => (
                <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div>
                    <b style={{ fontSize: 14.5 }}>{m.nome}</b><div className="fraco">{m.papel} · {m.situacao}</div>
                    <IdPrestai rotulo="ID do usuário no PrestAí" valor={m.prestai_user_id} aoSalvar={async (v) => { await tentar(async () => { await api.vincularMembro(m.id, v); await verMembros(sel); }, 'Vínculo atualizado.'); }} />
                  </div>
                  {m.situacao === 'ativo' && <button className="btn contorno pequeno" onClick={() => tentar(async () => { await api.alterarMembro(m.id, 'suspenso'); await verMembros(sel); })}>Suspender</button>}
                  {m.situacao === 'suspenso' && <button className="btn contorno pequeno" onClick={() => tentar(async () => { await api.alterarMembro(m.id, 'ativo'); await verMembros(sel); })}>Reativar</button>}
                </div>
              ))}
              {!membros.length && <p className="mudo">Nenhum usuário.</p>}
            </div>
            <form onSubmit={(e) => {
              e.preventDefault();
              tentar(async () => { await api.convidar(sel.id, conv.email, conv.nome, conv.papel); setConv({ nome: '', email: '', papel: 'membro' }); await verMembros(sel); }, 'Convite enviado.');
            }}>
              <label className="campo"><span>Nome</span><input required value={conv.nome} onChange={(e) => setConv({ ...conv, nome: e.target.value })} /></label>
              <label className="campo"><span>E-mail</span><input type="email" required value={conv.email} onChange={(e) => setConv({ ...conv, email: e.target.value })} /></label>
              <label className="campo"><span>Papel</span>
                <select value={conv.papel} onChange={(e) => setConv({ ...conv, papel: e.target.value })}>
                  <option value="admin">Administrador</option><option value="membro">Membro</option>
                </select>
              </label>
              <button className="btn pequeno">Enviar convite</button>
            </form>
            <h3 className="h2" style={{ margin: '24px 0 12px' }}>Projetos</h3>
            <div className="lista" style={{ marginBottom: 16 }}>
              {projetos.map((p) => (
                <div key={p.id}>
                  <b style={{ fontSize: 14.5 }}>{p.pronac} · {p.nome}</b>
                  <IdPrestai rotulo="ID do projeto no PrestAí" valor={p.prestai_project_id} aoSalvar={async (v) => { await tentar(async () => { await api.vincularProjeto(p.id, v); await verMembros(sel); }, 'Vínculo atualizado.'); }} />
                </div>
              ))}
              {!projetos.length && <p className="mudo">Nenhum projeto.</p>}
            </div>
            <form onSubmit={(e) => {
              e.preventDefault();
              tentar(async () => { await api.criarProjeto(sel.id, novoProj); setNovoProj({ pronac: '', nome: '', prestaiProjeto: '' }); await verMembros(sel); }, 'Projeto criado.');
            }}>
              <label className="campo"><span>PRONAC</span><input required value={novoProj.pronac} onChange={(e) => setNovoProj({ ...novoProj, pronac: e.target.value })} /></label>
              <label className="campo"><span>Nome do projeto</span><input required value={novoProj.nome} onChange={(e) => setNovoProj({ ...novoProj, nome: e.target.value })} /></label>
              <label className="campo"><span>ID do projeto no PrestAí (opcional)</span><input pattern={PADRAO_UUID} value={novoProj.prestaiProjeto} onChange={(e) => setNovoProj({ ...novoProj, prestaiProjeto: e.target.value })} /></label>
              <button className="btn pequeno">Criar projeto</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function MateriaisEquipe() {
  const [itens, setItens] = useState<Material[]>([]);
  const [f, setF] = useState({ titulo: '', tipo: 'manual', modulo: '', url: '' });
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erro, setErro] = useState('');
  const carregar = useCallback(() => api.todosMateriais().then(setItens).catch((e) => setErro(mensagemErro(e))), []);
  useEffect(() => { carregar(); }, [carregar]);

  async function enviar(e: FormEvent) {
    e.preventDefault(); setErro('');
    if (!arquivo && !f.url) return setErro('Envie um arquivo ou informe um link.');
    try {
      await api.publicarMaterial({ ...f, arquivo });
      setF({ titulo: '', tipo: 'manual', modulo: '', url: '' }); setArquivo(null);
      (e.target as HTMLFormElement).reset();
      await carregar();
    } catch (x) { setErro(mensagemErro(x)); }
  }

  return (
    <div className="duas">
      <form className="card" onSubmit={enviar}>
        <h2 className="h2" style={{ marginBottom: 16 }}>Publicar material</h2>
        <label className="campo"><span>Título</span><input required value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} /></label>
        <div className="grade-campos">
          <label className="campo"><span>Tipo</span>
            <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
              {Object.entries(ROTULO_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="campo"><span>Módulo</span><input value={f.modulo} onChange={(e) => setF({ ...f, modulo: e.target.value })} /></label>
        </div>
        <label className="campo arquivo"><span>Arquivo</span>
          <input type="file" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
          <div className="arquivo-falso"><b>Escolher arquivo</b><em>{arquivo?.name ?? 'Nenhum arquivo selecionado'}</em></div>
        </label>
        <label className="campo"><span>Ou link (vídeo)</span><input type="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></label>
        {erro && <div className="alerta" role="alert">{erro}</div>}
        <button className="btn pequeno">Publicar para todos</button>
      </form>
      <div className="lista">
        {itens.map((m) => (
          <div className="linha" key={m.id}>
            <div className="corpo"><b>{m.titulo}</b><div className="fraco">{ROTULO_TIPO[m.tipo]} · {m.ativo ? 'Publicado' : 'Oculto'}</div></div>
            <button className="btn contorno pequeno" onClick={() => api.alternarMaterial(m.id, !m.ativo).then(carregar)}>{m.ativo ? 'Ocultar' : 'Publicar'}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Categorias() {
  const [itens, setItens] = useState<Categoria[]>([]);
  const [nome, setNome] = useState('');
  const [humano, setHumano] = useState(false);
  const [erro, setErro] = useState('');
  const carregar = useCallback(() => api.todasCategorias().then(setItens).catch((e) => setErro(mensagemErro(e))), []);
  useEffect(() => { carregar(); }, [carregar]);
  return (
    <div className="duas">
      <form className="card" onSubmit={async (e) => {
        e.preventDefault(); setErro('');
        try { await api.criarCategoria(nome, humano); setNome(''); setHumano(false); await carregar(); } catch (x) { setErro(mensagemErro(x)); }
      }}>
        <h2 className="h2" style={{ marginBottom: 16 }}>Novo tipo de demanda</h2>
        <label className="campo"><span>Nome</span><input required value={nome} onChange={(e) => setNome(e.target.value)} /></label>
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }} className="mudo">
          <input type="checkbox" checked={humano} onChange={(e) => setHumano(e.target.checked)} /> Exige atendimento humano
        </label>
        {erro && <div className="alerta" role="alert">{erro}</div>}
        <button className="btn pequeno">Adicionar</button>
      </form>
      <div className="lista">
        {itens.map((c) => (
          <div className="linha" key={c.id}>
            <div className="corpo"><b>{c.nome}</b><div className="fraco">{c.exige_humano ? 'Atendimento humano' : 'Geral'} · {c.ativa ? 'Ativo' : 'Inativo'}</div></div>
            <button className="btn contorno pequeno" onClick={() => api.alternarCategoria(c.id, !c.ativa).then(carregar)}>{c.ativa ? 'Desativar' : 'Ativar'}</button>
          </div>
        ))}
        {!itens.length && <div className="vazio">Nenhum tipo cadastrado. Sem isso o cliente não consegue abrir chamado.</div>}
      </div>
    </div>
  );
}

function ChamadosEquipe() {
  const [itens, setItens] = useState<Chamado[]>([]);
  useEffect(() => { api.todosChamados().then(setItens).catch(() => setItens([])); }, []);
  return (
    <>
      <p className="mudo" style={{ marginBottom: 16 }}>Leitura. O atendimento acontece no Notion.</p>
      <div className="lista">
        {itens.map((c) => (
          <div className="linha" key={c.id}>
            <span className="protocolo">{c.protocolo}</span>
            <div className="corpo"><b>{c.assunto}</b><div className="mudo">{[c.organizacao, c.categoria, c.responsavel, data(c.aberto_em)].filter(Boolean).join(' · ')}</div></div>
            <SeloStatus status={c.status} />
          </div>
        ))}
        {!itens.length && <div className="vazio">Nenhum chamado.</div>}
      </div>
    </>
  );
}

const ABAS = { organizacoes: 'Organizações', materiais: 'Materiais', categorias: 'Tipos de demanda', chamados: 'Chamados' };

export function Equipe() {
  const { sessao } = useApp();
  const [aba, setAba] = useState<keyof typeof ABAS>('organizacoes');
  if (sessao.aal !== 'aal2') return <PassoMfa />;
  return (
    <main className="pagina">
      <div className="sobre">Painel interno</div>
      <h1 className="titulo">Equipe</h1>
      <div className="abas" role="tablist" style={{ marginTop: 22 }}>
        {Object.entries(ABAS).map(([k, v]) => (
          <button key={k} role="tab" aria-selected={aba === k} className={`aba ${aba === k ? 'ativa' : ''}`} onClick={() => setAba(k as any)}>{v}</button>
        ))}
      </div>
      {aba === 'organizacoes' && <Organizacoes />}
      {aba === 'materiais' && <MateriaisEquipe />}
      {aba === 'categorias' && <Categorias />}
      {aba === 'chamados' && <ChamadosEquipe />}
    </main>
  );
}
