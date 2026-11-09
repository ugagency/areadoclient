import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, data } from '../lib/api';
import { ABERTOS, type Chamado, type Material } from '../lib/tipos';
import { useApp } from '../main';

export function Inicio() {
  const { org } = useApp();
  const [chamados, setChamados] = useState<Chamado[] | null>(null);
  const [materiais, setMateriais] = useState<Material[] | null>(null);

  useEffect(() => {
    api.chamados(org).then(setChamados).catch(() => setChamados([]));
    api.materiais().then(setMateriais).catch(() => setMateriais([]));
  }, [org]);

  const abertos = chamados?.filter((c) => ABERTOS.includes(c.status)) ?? [];
  const aguardando = abertos.filter((c) => c.status === 'aguardando_cliente').length;
  const ultimo = chamados?.[0];

  return (
    <main className="pagina">
      <div className="sobre">Área do Cliente</div>
      <h1 className="titulo" style={{ maxWidth: '24ch' }}>Por onde você quer começar hoje?</h1>
      <p className="sub">Consulte os materiais do Prestaí ou resolva o que estiver travando.</p>
      <div className="grade">
        <Link to="/materiais" className="caminho verde">
          <div className="caminho-topo">
            <span className="num verde">1</span>
            {materiais && <span className="selo-t" style={{ color: 'var(--verde)' }}>{materiais.length} {materiais.length === 1 ? 'material' : 'materiais'}</span>}
          </div>
          <div>
            <strong>Materiais</strong>
            <p className="mudo">Manuais, infográficos, roteiros, apresentações e vídeos para baixar e consultar.</p>
          </div>
        </Link>
        <Link to="/suporte" className="caminho azul">
          <div className="caminho-topo">
            <span className="num azul">2</span>
            {chamados && <span className="selo-t" style={{ color: 'var(--azul3)' }}>{abertos.length} {abertos.length === 1 ? 'chamado aberto' : 'chamados abertos'}</span>}
          </div>
          <div>
            <strong>Suporte ao usuário</strong>
            <p className="mudo">Abra e acompanhe chamados pelo Digaí, com protocolo e histórico.</p>
          </div>
          <span className="fraco">
            {aguardando > 0
              ? `${aguardando} ${aguardando === 1 ? 'chamado aguarda' : 'chamados aguardam'} sua resposta`
              : ultimo ? `Último chamado: ${data(ultimo.aberto_em)}, protocolo ${ultimo.protocolo}` : 'Nenhum chamado até agora'}
          </span>
        </Link>
      </div>
    </main>
  );
}
