import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, mensagemErro } from '../lib/api';

function Moldura({ children }: { children: ReactNode }) {
  return (
    <div className="login">
      <div className="login-arte">
        <div className="marca">prestaí</div>
        <div>
          <div className="sobre">Área do Cliente</div>
          <h1>A arte acontece. A gente comprova.</h1>
          <p>Materiais do Prestaí, chamados de suporte e o histórico de cada atendimento, em um só lugar.</p>
        </div>
      </div>
      <div className="login-form">{children}</div>
    </div>
  );
}

export function Login() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const site = import.meta.env.VITE_SITE_URL;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(''); setEnviando(true);
    try { await api.entrar(email.trim(), senha); }
    catch (x) { setErro(mensagemErro(x)); setEnviando(false); }
  }

  return (
    <Moldura>
      <form onSubmit={enviar}>
        <h2>Entrar</h2>
        <p className="mudo" style={{ marginBottom: 30 }}>Use o e-mail e a senha do seu convite.</p>
        <label className="campo"><span>E-mail</span>
          <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="campo"><span>Senha</span>
          <input type="password" required autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
        </label>
        {erro && <div className="alerta" role="alert">{erro}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '14px 0 22px' }}>
          <Link className="link" to="/recuperar-senha">Esqueci a senha</Link>
        </div>
        <button className="btn bloco" disabled={enviando}>{enviando ? 'Entrando' : 'Entrar'}</button>
        {api.demo && <p className="fraco" style={{ marginTop: 18 }}>Demonstração: qualquer e-mail e senha entram como cliente. Com "equipe" no e-mail, entra como equipe.</p>}
        {site && <p style={{ marginTop: 22 }}><a className="link" href={site}>Voltar ao site</a></p>}
      </form>
    </Moldura>
  );
}

export function RecuperarSenha() {
  const [email, setEmail] = useState('');
  const [enviado, setEnviado] = useState(false);
  return (
    <Moldura>
      <form onSubmit={async (e) => { e.preventDefault(); await api.recuperarSenha(email.trim()); setEnviado(true); }}>
        <h2>Recuperar senha</h2>
        <p className="mudo" style={{ marginBottom: 30 }}>Enviamos um link para criar uma senha nova.</p>
        {enviado ? (
          <div className="aviso" role="status">Se este e-mail tiver acesso, o link chega em instantes.</div>
        ) : (
          <>
            <label className="campo"><span>E-mail</span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button className="btn bloco">Enviar link</button>
          </>
        )}
        <p style={{ marginTop: 22 }}><Link className="link" to="/entrar">Voltar para entrar</Link></p>
      </form>
    </Moldura>
  );
}

export function DefinirSenha() {
  const [senha, setSenha] = useState('');
  const [confirma, setConfirma] = useState('');
  const [erro, setErro] = useState('');
  const ir = useNavigate();

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (senha.length < 10) return setErro('Use pelo menos 10 caracteres.');
    if (senha !== confirma) return setErro('As senhas não coincidem.');
    try { await api.definirSenha(senha); ir('/', { replace: true }); }
    catch (x) { setErro(mensagemErro(x)); }
  }

  return (
    <Moldura>
      <form onSubmit={enviar}>
        <h2>Criar senha</h2>
        <p className="mudo" style={{ marginBottom: 30 }}>É a senha que você vai usar para entrar.</p>
        <label className="campo"><span>Nova senha</span>
          <input type="password" required autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
        </label>
        <label className="campo"><span>Confirmar senha</span>
          <input type="password" required autoComplete="new-password" value={confirma} onChange={(e) => setConfirma(e.target.value)} />
        </label>
        {erro && <div className="alerta" role="alert">{erro}</div>}
        <button className="btn bloco">Salvar e entrar</button>
      </form>
    </Moldura>
  );
}
