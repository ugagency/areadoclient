import { createContext, useContext, useEffect, useState, type ReactNode, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './lib/api';
import type { Sessao } from './lib/tipos';
import './estilo.css';
import { DefinirSenha, Login, RecuperarSenha } from './pages/Acesso';
import { Inicio } from './pages/Inicio';
import { Materiais } from './pages/Materiais';
import { ChamadoDetalhe, NovoChamado, Suporte } from './pages/Suporte';
import { Equipe } from './pages/Equipe';

type Ctx = { sessao: Sessao; org: string; trocarOrg: (id: string) => void };
const Contexto = createContext<Ctx | null>(null);
export const useApp = () => useContext(Contexto)!;

function Topo({ sessao, org, trocarOrg }: Ctx) {
  const cliente = sessao.vinculos.length > 0;
  const atual = sessao.vinculos.find((v) => v.organization_id === org);
  return (
    <header className="topo">
      <div className="topo-in">
        <div className="topo-esq">
          <span className="marca">prestaí</span>
          <nav className="nav" aria-label="Principal">
            {cliente && <NavLink to="/" end>Início</NavLink>}
            {cliente && <NavLink to="/materiais">Materiais</NavLink>}
            {cliente && <NavLink to="/suporte">Suporte</NavLink>}
            {sessao.equipe && <NavLink to="/equipe">Equipe</NavLink>}
          </nav>
        </div>
        <div className="topo-dir">
          {cliente && (
            <div className="chip">
              <span className="ponto" />
              {sessao.vinculos.length > 1 ? (
                <select aria-label="Organização" value={org} onChange={(e) => trocarOrg(e.target.value)}>
                  {sessao.vinculos.map((v) => (
                    <option key={v.organization_id} value={v.organization_id}>{v.razao_social}</option>
                  ))}
                </select>
              ) : <span>{atual?.razao_social}</span>}
            </div>
          )}
          <button className="btn contorno pequeno" onClick={() => api.sair()}>Sair</button>
        </div>
      </div>
    </header>
  );
}

function Autenticado({ sessao }: { sessao: Sessao | null }) {
  const { pathname } = useLocation();
  const [org, setOrg] = useState('');
  const atual = sessao?.vinculos.find((v) => v.organization_id === org)?.organization_id
    ?? sessao?.vinculos[0]?.organization_id ?? '';

  if (!sessao) return <Navigate to="/entrar" replace />;
  if (!sessao.vinculos.length && !sessao.equipe) {
    return (
      <div className="pagina estreita">
        <h1 className="titulo">Acesso ainda não habilitado.</h1>
        <p className="sub">Sua conta não está ligada a uma organização ativa. Fale com o administrador da sua organização.</p>
        <button className="btn contorno" onClick={() => api.sair()}>Sair</button>
      </div>
    );
  }
  if (!sessao.vinculos.length && pathname === '/') return <Navigate to="/equipe" replace />;

  const ctx = { sessao, org: atual, trocarOrg: setOrg };
  return (
    <Contexto.Provider value={ctx}>
      <Topo {...ctx} />
      <Outlet />
    </Contexto.Provider>
  );
}

function App() {
  const [sessao, setSessao] = useState<Sessao | null | undefined>(undefined);
  useEffect(() => {
    const ler = () => api.sessao().then(setSessao).catch(() => setSessao(null));
    ler();
    return api.aoMudarSessao(ler);
  }, []);
  if (sessao === undefined) return null;

  const SoCliente = ({ children }: { children: ReactNode }) =>
    sessao?.vinculos.length ? <>{children}</> : <Navigate to="/" replace />;

  return (
    <>
      {api.demo && <div className="faixa-demo">Demonstração com dados fictícios</div>}
      <Routes>
        <Route path="/entrar" element={sessao ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/recuperar-senha" element={<RecuperarSenha />} />
        <Route path="/definir-senha" element={<DefinirSenha />} />
        <Route element={<Autenticado sessao={sessao} />}>
          <Route path="/" element={<SoCliente><Inicio /></SoCliente>} />
          <Route path="/materiais" element={<SoCliente><Materiais /></SoCliente>} />
          <Route path="/suporte" element={<SoCliente><Suporte /></SoCliente>} />
          <Route path="/suporte/novo" element={<SoCliente><NovoChamado /></SoCliente>} />
          <Route path="/suporte/:id" element={<SoCliente><ChamadoDetalhe /></SoCliente>} />
          <Route path="/equipe" element={sessao?.equipe ? <Equipe /> : <Navigate to="/" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter><App /></BrowserRouter>
  </StrictMode>,
);
