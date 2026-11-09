import { useEffect, useMemo, useState } from 'react';
import { api, data, mensagemErro } from '../lib/api';
import { ROTULO_TIPO, type Material } from '../lib/tipos';

export function Materiais() {
  const [itens, setItens] = useState<Material[] | null>(null);
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState('');
  const [erro, setErro] = useState('');

  useEffect(() => { api.materiais().then(setItens).catch((e) => { setItens([]); setErro(mensagemErro(e)); }); }, []);

  const tipos = useMemo(() => [...new Set((itens ?? []).map((m) => m.tipo))], [itens]);
  const visiveis = (itens ?? []).filter((m) =>
    (!tipo || m.tipo === tipo) &&
    `${m.titulo} ${m.descricao ?? ''} ${m.modulo ?? ''}`.toLowerCase().includes(busca.trim().toLowerCase()));

  async function abrir(m: Material) {
    setErro('');
    try {
      const url = m.arquivo_path ? await api.urlMaterial(m.arquivo_path) : m.url_externa;
      if (url) window.open(url, '_blank', 'noopener');
    } catch (e) { setErro(mensagemErro(e)); }
  }

  return (
    <main className="pagina">
      <div className="sobre" style={{ color: 'var(--verde)' }}>Central de materiais</div>
      <h1 className="titulo">Materiais</h1>
      <p className="sub">Tudo o que a equipe publicou para o seu dia a dia no Prestaí.</p>
      {erro && <div className="alerta" role="alert">{erro}</div>}
      <div className="filtros">
        <input aria-label="Buscar material" placeholder="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <select aria-label="Filtrar por tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="">Todos os tipos</option>
          {tipos.map((t) => <option key={t} value={t}>{ROTULO_TIPO[t] ?? t}</option>)}
        </select>
      </div>
      <div className="lista">
        {visiveis.map((m) => (
          <div className="linha" key={m.id}>
            <div className="corpo">
              <b>{m.titulo}</b>
              <div className="mudo">{m.descricao}</div>
              <div className="fraco">
                {[ROTULO_TIPO[m.tipo] ?? m.tipo, m.modulo, `versão ${m.versao}`, `atualizado em ${data(m.updated_at).split(',')[0]}`].filter(Boolean).join(' · ')}
              </div>
            </div>
            <button className="btn contorno pequeno" onClick={() => abrir(m)}>{m.arquivo_path ? 'Baixar' : 'Abrir'}</button>
          </div>
        ))}
        {itens && !visiveis.length && (
          <div className="vazio">{itens.length ? 'Nenhum material com esse filtro.' : 'Nenhum material publicado ainda.'}</div>
        )}
      </div>
    </main>
  );
}
