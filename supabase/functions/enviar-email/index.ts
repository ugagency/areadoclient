// Processa a fila de e-mails. Chamada a cada minuto por agendamento (pg_cron + pg_net).
import { json, segredoValido, servico } from '../_shared/comum.ts';

const STATUS: Record<string, string> = {
  aberto: 'Aberto', em_triagem: 'Em triagem', em_atendimento: 'Em atendimento',
  aguardando_cliente: 'Aguardando você', resolvido: 'Resolvido', encerrado: 'Encerrado', reaberto: 'Reaberto',
};

function modelo(nome: string, d: Record<string, string>) {
  const link = `${Deno.env.get('APP_URL')}/suporte`;
  const rodape = `Acompanhe em ${link}`;
  switch (nome) {
    case 'chamado_recebido':
      return {
        assunto: `Chamado ${d.protocolo} recebido`,
        texto: `Recebemos seu chamado "${d.assunto}".\nProtocolo: ${d.protocolo}\n\n${rodape}`,
      };
    case 'chamado_resposta':
      return {
        assunto: `Nova resposta no chamado ${d.protocolo}`,
        texto: `A equipe respondeu ao chamado "${d.assunto}".\n\n${rodape}`,
      };
    default:
      return {
        assunto: `Chamado ${d.protocolo}: ${STATUS[d.status] ?? d.status}`,
        texto: `O chamado "${d.assunto}" está em: ${STATUS[d.status] ?? d.status}.\n\n${rodape}`,
      };
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ erro: 'Método não permitido' }, 405);
  if (!segredoValido(req)) return json({ erro: 'Não autorizado' }, 401);

  const db = servico();
  const { data: itens, error } = await db.rpc('emails_pendentes', { p_limite: 20 });
  if (error) return json({ erro: error.message }, 500);

  let enviados = 0;
  for (const item of itens ?? []) {
    const { assunto, texto } = modelo(item.modelo, item.dados);
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: Deno.env.get('EMAIL_REMETENTE'), to: item.para, subject: assunto, text: texto }),
      });
      if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
      await db.rpc('email_concluir', { p_id: item.id, p_ok: true });
      enviados++;
    } catch (e) {
      await db.rpc('email_concluir', { p_id: item.id, p_ok: false, p_erro: String(e) });
    }
  }
  return json({ enviados, total: (itens ?? []).length });
});
