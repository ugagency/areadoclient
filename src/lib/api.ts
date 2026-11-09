import type { Api } from './tipos';

// Importação dinâmica: o modo demonstração não entra no pacote de produção.
export const api: Api = import.meta.env.VITE_DEMO === '1'
  ? (await import('./demo')).demo
  : (await import('./real')).real;

export const data = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export const duracao = (ms: number) => {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h}h${String(min % 60).padStart(2, '0')}` : `${Math.round(h / 24)} dias`;
};

export const mensagemErro = (e: unknown) =>
  e instanceof Error && e.message ? e.message : 'Não foi possível concluir. Tente de novo.';
