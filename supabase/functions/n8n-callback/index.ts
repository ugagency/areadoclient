// Recebe do n8n o que mudou no Notion: status, prioridade, responsável e resposta.
// Só os campos cujo dono é o Notion passam por aqui.
import { json, segredoValido, servico } from '../_shared/comum.ts';

const STATUS = ['aberto', 'em_triagem', 'em_atendimento', 'aguardando_cliente', 'resolvido', 'encerrado'];

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ erro: 'Método não permitido' }, 405);
  if (!segredoValido(req)) return json({ erro: 'Não autorizado' }, 401);

  const { chamado_id, status, prioridade, responsavel, resposta } = await req.json().catch(() => ({}));
  if (!chamado_id) return json({ erro: 'chamado_id obrigatório' }, 400);
  if (status && !STATUS.includes(status)) return json({ erro: 'Status inválido' }, 400);

  const { error } = await servico().rpc('aplicar_atualizacao_notion', {
    p_chamado_id: chamado_id,
    p_status: status ?? null,
    p_prioridade: prioridade ?? null,
    p_responsavel: responsavel ?? null,
    p_resposta: resposta ?? null,
  });
  return error ? json({ erro: error.message }, 400) : json({ ok: true });
});
