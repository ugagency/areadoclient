import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

export const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') ?? '',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

export const servico = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

// Comparação em tempo constante do segredo compartilhado com o n8n e o agendador.
export function segredoValido(req: Request): boolean {
  const esperado = new TextEncoder().encode(Deno.env.get('N8N_WEBHOOK_SECRET') ?? '');
  const recebido = new TextEncoder().encode(req.headers.get('x-webhook-secret') ?? '');
  if (esperado.length === 0 || esperado.length !== recebido.length) return false;
  let diferenca = 0;
  for (let i = 0; i < esperado.length; i++) diferenca |= esperado[i] ^ recebido[i];
  return diferenca === 0;
}
