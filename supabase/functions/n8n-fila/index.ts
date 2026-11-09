// Fila para o Notion, consumida pelo n8n.
// POST {"acao":"pendentes","limite":20}
// POST {"acao":"concluir","fila_id":1,"ok":true,"notion_page_id":"..."}
// POST {"acao":"concluir","fila_id":1,"ok":false,"erro":"..."}
import { json, segredoValido, servico } from '../_shared/comum.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ erro: 'Método não permitido' }, 405);
  if (!segredoValido(req)) return json({ erro: 'Não autorizado' }, 401);

  const corpo = await req.json().catch(() => ({}));
  const db = servico();

  if (corpo.acao === 'pendentes') {
    const { data, error } = await db.rpc('fila_notion_pendentes', { p_limite: corpo.limite ?? 20 });
    return error ? json({ erro: error.message }, 500) : json({ itens: data });
  }
  if (corpo.acao === 'concluir') {
    const { error } = await db.rpc('fila_notion_concluir', {
      p_fila_id: corpo.fila_id,
      p_ok: corpo.ok === true,
      p_erro: corpo.erro ?? null,
      p_notion_page_id: corpo.notion_page_id ?? null,
    });
    return error ? json({ erro: error.message }, 400) : json({ ok: true });
  }
  return json({ erro: 'Ação desconhecida' }, 400);
});
