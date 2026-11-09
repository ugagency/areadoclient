import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, data, duracao, mensagemErro } from '../lib/api';
import {
  ABERTOS, ROTULO_SEVERIDADE, ROTULO_STATUS,
  type Anexo, type Categoria, type Chamado, type Mensagem, type Projeto, type StatusChamado,
} from '../lib/tipos';
import { useApp } from '../main';

const TAMANHO_MAX = 20 * 1024 * 1024;

export function SeloStatus({ status }: { status: StatusChamado }) {
  const c = status === 'aguardando_cliente' ? 'vez'
    : status === 'resolvido' ? 'fim'
    : status === 'encerrado' ? 'mudo' : 'anda';
  return <span className={`selo ${c}`}>{ROTULO_STATUS[status]}</span>;
}

export function Suporte() {
  const { org } = useApp();
  const [itens, setItens] = useState<Chamado[] | null>(null);
  const [erro, setErro] = useState('');
  const [filtro, setFiltro] = useState<'abertos' | 'todos'>('abertos');

  useEffect(() => {
    setItens(null);
    api.chamados(org).then(setItens).catch((e) => { setItens([]); setErro(mensagemErro(e)); });
  }, [org]);

  const abertos = itens?.filter((c) => ABERTOS.includes(c.status)) ?? [];
  const respondidos = itens?.filter((c) => c.primeira_resposta_em) ?? [];
  const media = respondidos.length
    ? respondidos.reduce((s, c) => s + (+new Date(c.primeira_resposta_em!) - +new Date(c.aberto_em)), 0) / respondidos.length
    : null;
  const lista = filtro === 'abertos' ? abertos : itens ?? [];

  return (
    <main className="pagina">
      <div className="sobre">Digaí, canal de atendimento</div>
      <h1 className="titulo">Suporte ao usuário</h1>
      <p className="sub">Toda demanda entra por aqui e recebe protocolo. Você acompanha o andamento e o histórico de cada chamado.</p>
      {erro && <div className="alerta" role="alert">{erro}</div>}
      <div className="grade" style={{ marginBottom: 30 }}>
        <div className="card metrica"><b>{itens ? abertos.length : ' '}</b><span>Chamados abertos</span></div>
        <div className="card metrica"><b style={{ color: 'var(--verde)' }}>{media === null ? 'Sem dados' : duracao(media)}</b><span>Tempo médio até a primeira resposta</span></div>
      </div>
      <div className="cabeca-lista">
        <h2 className="h2">Seus chamados</h2>
        <div className="topo-dir">
          <select className="btn contorno pequeno" aria-label="Filtrar chamados" value={filtro} onChange={(e) => setFiltro(e.target.value as any)}>
            <option value="abertos">Abertos</option>
            <option value="todos">Todos</option>
          </select>
          <Link className="btn" to="/suporte/novo">Abrir chamado</Link>
        </div>
      </div>
      <div className="lista">
        {lista.map((c) => (
          <Link className="linha" to={`/suporte/${c.id}`} key={c.id}>
            <span className="protocolo">{c.protocolo}</span>
            <div className="corpo">
              <b>{c.assunto}</b>
              <div className="mudo">{[c.categoria, c.pronac && `PRONAC ${c.pronac}`, data(c.aberto_em)].filter(Boolean).join(' · ')}</div>
            </div>
            <SeloStatus status={c.status} />
          </Link>
        ))}
        {itens && !lista.length && (
          <div className="vazio">{filtro === 'abertos' ? 'Nenhum chamado aberto.' : 'Nenhum chamado até agora.'}</div>
        )}
      </div>
    </main>
  );
}

function SeletorArquivos({ arquivos, aoMudar }: { arquivos: File[]; aoMudar: (f: File[]) => void }) {
  return (
    <label className="campo arquivo"><span>Anexos (até 20 MB cada)</span>
      <input type="file" multiple onChange={(e) => { aoMudar([...arquivos, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} />
      <div className="arquivo-falso">
        <b>Escolher arquivos</b>
        <em>{arquivos.length ? arquivos.map((f) => f.name).join(', ') : 'Nenhum arquivo selecionado'}</em>
      </div>
    </label>
  );
}

export function NovoChamado() {
  const { org } = useApp();
  const ir = useNavigate();
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [f, setF] = useState({ categoria: '', projeto: '', assunto: '', descricao: '', severidade: 'media' });
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const muda = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    api.categorias().then(setCategorias).catch((e) => setErro(mensagemErro(e)));
    api.projetos(org).then(setProjetos).catch(() => setProjetos([]));
  }, [org]);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (arquivos.some((a) => a.size > TAMANHO_MAX)) return setErro('Cada anexo pode ter até 20 MB.');
    setErro(''); setEnviando(true);
    try {
      const c = await api.abrirChamado({ org, categoria: f.categoria, assunto: f.assunto, descricao: f.descricao, projeto: f.projeto || null, severidade: f.severidade });
      for (const a of arquivos) await api.anexar(c, a);
      ir(`/suporte/${c.id}`, { replace: true, state: { novo: true } });
    } catch (x) { setErro(mensagemErro(x)); setEnviando(false); }
  }

  return (
    <main className="pagina estreita">
      <div className="sobre"><Link to="/suporte" style={{ color: 'inherit' }}>Suporte</Link></div>
      <h1 className="titulo">Abrir chamado</h1>
      <form className="card" onSubmit={enviar} style={{ marginTop: 26 }}>
        <div className="grade-campos">
          <label className="campo"><span>Tipo de demanda</span>
            <select required value={f.categoria} onChange={muda('categoria')}>
              <option value="">Selecione</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
          <label className="campo"><span>Projeto (PRONAC)</span>
            <select value={f.projeto} onChange={muda('projeto')}>
              <option value="">Não se aplica</option>
              {projetos.map((p) => <option key={p.id} value={p.id}>{p.pronac} · {p.nome}</option>)}
            </select>
          </label>
          <label className="campo"><span>Urgência</span>
            <select value={f.severidade} onChange={muda('severidade')}>
              {Object.entries(ROTULO_SEVERIDADE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
        <label className="campo"><span>Assunto</span>
          <input required maxLength={200} value={f.assunto} onChange={muda('assunto')} />
        </label>
        <label className="campo"><span>Descrição</span>
          <textarea required maxLength={10000} value={f.descricao} onChange={muda('descricao')} />
        </label>
        <SeletorArquivos arquivos={arquivos} aoMudar={setArquivos} />
        {erro && <div className="alerta" role="alert">{erro}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn" disabled={enviando}>{enviando ? 'Enviando' : 'Abrir chamado'}</button>
        </div>
      </form>
    </main>
  );
}

export function ChamadoDetalhe() {
  const { id = '' } = useParams();
  const [d, setD] = useState<{ chamado: Chamado; mensagens: Mensagem[]; anexos: Anexo[] } | null>(null);
  const [naoAchou, setNaoAchou] = useState(false);
  const [texto, setTexto] = useState('');
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(() => api.chamado(id).then(setD).catch(() => setNaoAchou(true)), [id]);
  useEffect(() => { carregar(); return api.acompanhar(id, carregar); }, [id, carregar]);

  if (naoAchou) return <main className="pagina estreita"><div className="vazio">Chamado não encontrado. <Link to="/suporte">Voltar</Link></div></main>;
  if (!d) return null;
  const { chamado: c, mensagens, anexos } = d;
  const finalizado = c.status === 'resolvido' || c.status === 'encerrado';

  async function acao(ev: FormEvent, fn: () => Promise<void>) {
    ev.preventDefault();
    if (arquivos.some((a) => a.size > TAMANHO_MAX)) return setErro('Cada anexo pode ter até 20 MB.');
    setErro(''); setEnviando(true);
    try {
      await fn();
      for (const a of arquivos) await api.anexar(c, a);
      setTexto(''); setArquivos([]);
      await carregar();
    } catch (x) { setErro(mensagemErro(x)); }
    setEnviando(false);
  }

  async function baixar(a: Anexo) {
    try { window.open(await api.urlAnexo(a.storage_path), '_blank', 'noopener'); }
    catch (x) { setErro(mensagemErro(x)); }
  }

  return (
    <main className="pagina estreita">
      <div className="sobre"><Link to="/suporte" style={{ color: 'inherit' }}>Suporte</Link> · {c.protocolo}</div>
      <div className="cabeca-lista">
        <h1 className="titulo" style={{ margin: 0 }}>{c.assunto}</h1>
        <SeloStatus status={c.status} />
      </div>
      <div className="card" style={{ marginTop: 20 }}>
        <div className="detalhes" style={{ marginBottom: 18 }}>
          <div><span>Tipo de demanda</span><b>{c.categoria}</b></div>
          <div><span>Projeto</span><b>{c.pronac ?? 'Não se aplica'}</b></div>
          <div><span>Urgência</span><b>{ROTULO_SEVERIDADE[c.severidade_sugerida]}</b></div>
          <div><span>Aberto em</span><b>{data(c.aberto_em)}</b></div>
        </div>
        <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'var(--texto2)' }}>{c.descricao}</p>
        {anexos.length > 0 && (
          <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {anexos.map((a) => <button key={a.id} className="btn contorno pequeno" onClick={() => baixar(a)}>{a.nome}</button>)}
          </div>
        )}
      </div>

      <div className="conversa" aria-live="polite">
        {mensagens.map((m) => (
          <div key={m.id} className={`bolha ${m.autor_tipo === 'cliente' ? 'nos' : 'eles'}`}>
            <small>{m.autor_tipo === 'cliente' ? 'Você' : 'Equipe Prestaí'} · {data(m.created_at)}</small>
            {m.texto}
          </div>
        ))}
      </div>

      {erro && <div className="alerta" role="alert">{erro}</div>}
      {c.status === 'encerrado' ? (
        <div className="vazio">Chamado encerrado. Se precisar, abra um novo.</div>
      ) : c.status === 'resolvido' ? (
        <form className="card" onSubmit={(e) => acao(e, () => api.reabrir(c.id, texto))}>
          <label className="campo"><span>O problema continua? Conte o que aconteceu para reabrir</span>
            <textarea required value={texto} onChange={(e) => setTexto(e.target.value)} />
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn contorno" disabled={enviando}>Reabrir chamado</button></div>
        </form>
      ) : !finalizado && (
        <form className="card" onSubmit={(e) => acao(e, () => api.responder(c.id, texto))}>
          <label className="campo"><span>Sua resposta</span>
            <textarea required maxLength={10000} value={texto} onChange={(e) => setTexto(e.target.value)} />
          </label>
          <SeletorArquivos arquivos={arquivos} aoMudar={setArquivos} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn" disabled={enviando}>{enviando ? 'Enviando' : 'Enviar'}</button></div>
        </form>
      )}
    </main>
  );
}
