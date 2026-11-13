// Testes de banco em Postgres local (PGlite), com um ambiente que imita o Supabase:
// papéis anon/authenticated/service_role, auth.uid(), auth.jwt() e storage.
// Inclui as concessões padrão do Supabase, para provar que a migration as fecha.
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const db = new PGlite();
const dir = 'supabase/migrations';

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema storage;
  create table auth.users (id uuid primary key, email text);
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
  grant usage on schema auth, storage to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;
  grant select on auth.users to service_role;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant all on storage.objects to authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`);

for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(join(dir, f), 'utf8'));

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = { adminA: id(1), membroA: id(2), membro2A: id(3), adminB: id(4), equipe: id(5), semMfa: id(6) };
const ORG_A = id(101), ORG_B = id(102), CAT = id(201), CAT_OFF = id(202), PROJ_A = id(301), PROJ_B = id(302);
const MAT_TODOS = id(401), MAT_B = id(402), MAT_RASCUNHO = id(403);

await db.exec(`
  insert into auth.users values
    ('${U.adminA}','admin@a.test'),('${U.membroA}','membro@a.test'),('${U.membro2A}','membro2@a.test'),
    ('${U.adminB}','admin@b.test'),('${U.equipe}','equipe@p.test'),('${U.semMfa}','semmfa@p.test');
  insert into public.organizations (id, razao_social, cnpj) values
    ('${ORG_A}','Org A','11111111111111'),('${ORG_B}','Org B','22222222222222');
  insert into public.org_members (organization_id, user_id, nome, papel, situacao) values
    ('${ORG_A}','${U.adminA}','Admin A','admin','ativo'),
    ('${ORG_A}','${U.membroA}','Membro A','membro','ativo'),
    ('${ORG_A}','${U.membro2A}','Membro 2 A','membro','ativo'),
    ('${ORG_B}','${U.adminB}','Admin B','admin','ativo');
  insert into public.staff (user_id, nome, papel) values
    ('${U.equipe}','Atendente','atendimento'),('${U.semMfa}','Sem MFA','atendimento');
  insert into public.projects (id, organization_id, pronac, nome) values
    ('${PROJ_A}','${ORG_A}','111111','Projeto A'),('${PROJ_B}','${ORG_B}','222222','Projeto B');
  insert into public.chamado_categorias (id, nome, ativa) values
    ('${CAT}','Dúvida',true),('${CAT_OFF}','Antiga',false);
  insert into public.conteudos (id, titulo, tipo, arquivo_path, publico, ativo) values
    ('${MAT_TODOS}','Manual','manual','manual.pdf','todos',true),
    ('${MAT_B}','Só B','manual','so-b.pdf','organizacoes',true),
    ('${MAT_RASCUNHO}','Rascunho','manual','rascunho.pdf','todos',false);
  insert into public.conteudo_organizacoes values ('${MAT_B}','${ORG_B}');
`);

async function como(user, fn, aal = 'aal1') {
  const role = user === 'anon' ? 'anon' : user === 'service' ? 'service_role' : 'authenticated';
  const claims = user === 'anon' || user === 'service' ? '{}' : JSON.stringify({ sub: user, aal });
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  await db.exec(`set role ${role}`);
  try { return await fn(); } finally {
    await db.exec(`reset role`);
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
}
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const nega = (p, msg) => assert.rejects(p, msg ?? /.*/);
const abrir = (org, proj = null, cat = CAT) =>
  q(`select * from public.abrir_chamado($1,$2,'Assunto','Descrição',$3)`, [org, cat, proj]);

let ok = 0, falhas = 0;
async function t(nome, fn) {
  try { await fn(); ok++; console.log('ok   ', nome); }
  catch (e) { falhas++; console.log('FALHA', nome, '\n     ', e.message); await db.exec('reset role').catch(() => {}); }
}

let chamadoA, chamadoA2, chamadoB;

await t('protocolo sequencial e único', async () => {
  [chamadoA] = await como(U.membroA, () => abrir(ORG_A, PROJ_A));
  [chamadoA2] = await como(U.membro2A, () => abrir(ORG_A));
  [chamadoB] = await como(U.adminB, () => abrir(ORG_B));
  const ano = new Date().getFullYear();
  assert.equal(chamadoA.protocolo, `${ano}-0001`);
  assert.equal(chamadoA2.protocolo, `${ano}-0002`);
  assert.equal(chamadoB.protocolo, `${ano}-0003`);
});
await t('membro não abre chamado em outra organização', () =>
  como(U.membroA, () => nega(abrir(ORG_B))));
await t('não usa projeto de outra organização', () =>
  como(U.membroA, () => nega(abrir(ORG_A, PROJ_B))));
await t('não usa categoria inativa', () =>
  como(U.membroA, () => nega(abrir(ORG_A, null, CAT_OFF))));
await t('anônimo não lê nem abre', () => como('anon', async () => {
  await nega(q(`select * from public.chamados`));
  await nega(abrir(ORG_A));
  await nega(q(`select * from public.organizations`));
}));
await t('isolamento: B não lê nada de A', () => como(U.adminB, async () => {
  assert.equal((await q(`select 1 from public.chamados where organization_id=$1`, [ORG_A])).length, 0);
  assert.equal((await q(`select 1 from public.organizations where id=$1`, [ORG_A])).length, 0);
  assert.equal((await q(`select 1 from public.org_members where organization_id=$1`, [ORG_A])).length, 0);
  assert.equal((await q(`select 1 from public.projects where organization_id=$1`, [ORG_A])).length, 0);
}));
await t('admin vê todos da organização, membro só os próprios', async () => {
  assert.equal((await como(U.adminA, () => q(`select 1 from public.chamados`))).length, 2);
  const m = await como(U.membroA, () => q(`select id from public.chamados`));
  assert.deepEqual(m.map((x) => x.id), [chamadoA.id]);
});
await t('cliente não grava direto em chamados nem mensagens', () => como(U.adminA, async () => {
  await nega(q(`update public.chamados set status='encerrado' where id=$1`, [chamadoA.id]));
  await nega(q(`delete from public.chamados where id=$1`, [chamadoA.id]));
  await nega(q(`insert into public.chamado_mensagens (chamado_id,autor_tipo,texto) values ($1,'atendente','x')`, [chamadoA.id]));
  await nega(q(`update public.org_members set papel='admin'`));
}));
await t('cliente não acessa Notion, filas nem auditoria', () => como(U.adminA, async () => {
  await nega(q(`select * from public.chamado_notion`));
  assert.equal((await q(`select 1 from public.sync_outbox`)).length, 0);
  assert.equal((await q(`select 1 from public.email_outbox`)).length, 0);
  assert.equal((await q(`select 1 from public.audit_log`)).length, 0);
}));
await t('cliente não chama RPC exclusiva do Notion', () => como(U.adminA, () =>
  nega(q(`select public.aplicar_atualizacao_notion($1,'encerrado')`, [chamadoA.id]))));
await t('abertura cria fila do Notion e e-mail de recebimento', async () => {
  const s = await q(`select * from public.sync_outbox where entidade_id=$1`, [chamadoA.id]);
  const e = await q(`select * from public.email_outbox where dados->>'protocolo'=$1`, [chamadoA.protocolo]);
  assert.equal(s.length, 1); assert.equal(s[0].operacao, 'criar');
  assert.equal(e.length, 1); assert.equal(e[0].modelo, 'chamado_recebido'); assert.equal(e[0].para, 'membro@a.test');
});
await t('resposta do Notion chega ao cliente, gera e-mail, não volta à fila', async () => {
  const antes = (await q(`select count(*)::int n from public.sync_outbox`))[0].n;
  await como('service', () => q(`select public.aplicar_atualizacao_notion($1,'aguardando_cliente','Alta','Felipe','Envie o PDF')`, [chamadoA.id]));
  assert.equal((await q(`select count(*)::int n from public.sync_outbox`))[0].n, antes);
  const m = await como(U.membroA, () => q(`select texto, autor_tipo from public.chamado_mensagens where chamado_id=$1`, [chamadoA.id]));
  assert.deepEqual(m, [{ texto: 'Envie o PDF', autor_tipo: 'atendente' }]);
  const [c] = await q(`select * from public.chamados where id=$1`, [chamadoA.id]);
  assert.ok(c.primeira_resposta_em); assert.equal(c.responsavel, 'Felipe');
  const e = await q(`select modelo from public.email_outbox where dados->>'protocolo'=$1 order by id`, [chamadoA.protocolo]);
  assert.deepEqual(e.map((x) => x.modelo).sort(), ['chamado_recebido', 'chamado_resposta', 'chamado_status']);
});
await t('nota interna nunca chega ao cliente', async () => {
  await q(`insert into public.chamado_mensagens (chamado_id,autor_tipo,texto,visibilidade) values ($1,'atendente','nota secreta','interna')`, [chamadoA.id]);
  for (const u of [U.membroA, U.adminA]) {
    const m = await como(u, () => q(`select texto from public.chamado_mensagens where chamado_id=$1`, [chamadoA.id]));
    assert.ok(!m.some((x) => x.texto === 'nota secreta'));
  }
  const n = await q(`select count(*)::int n from public.email_outbox where dados->>'protocolo'=$1 and modelo='chamado_resposta'`, [chamadoA.protocolo]);
  assert.equal(n[0].n, 1);
});
await t('resposta do cliente retoma atendimento e sobe ao Notion', async () => {
  const [m] = await como(U.membroA, () => q(`select * from public.responder_chamado($1,'Segue')`, [chamadoA.id]));
  assert.equal((await q(`select status from public.chamados where id=$1`, [chamadoA.id]))[0].status, 'em_atendimento');
  assert.equal((await q(`select 1 from public.sync_outbox where entidade='mensagem' and entidade_id=$1`, [m.id])).length, 1);
  assert.equal((await q(`select 1 from public.sync_outbox where entidade='chamado' and entidade_id=$1 and operacao='atualizar'`, [chamadoA.id])).length, 1);
});
await t('outro membro da organização não responde chamado alheio', () =>
  como(U.membro2A, () => nega(q(`select * from public.responder_chamado($1,'x')`, [chamadoA.id]))));
await t('reabre resolvido; não reabre encerrado; Notion não reabre', async () => {
  await como('service', () => q(`select public.aplicar_atualizacao_notion($1,'resolvido')`, [chamadoA.id]));
  await como(U.membroA, () => nega(q(`select * from public.responder_chamado($1,'x')`, [chamadoA.id])));
  await como('service', () => nega(q(`select public.aplicar_atualizacao_notion($1,'reaberto')`, [chamadoA.id])));
  const [c] = await como(U.membroA, () => q(`select * from public.reabrir_chamado($1,'Voltou o erro')`, [chamadoA.id]));
  assert.equal(c.status, 'reaberto'); assert.equal(c.resolvido_em, null);
  await como('service', () => q(`select public.aplicar_atualizacao_notion($1,'encerrado')`, [chamadoA.id]));
  await como(U.membroA, () => nega(q(`select * from public.reabrir_chamado($1,'x')`, [chamadoA.id])));
});
await t('equipe só enxerga com MFA', async () => {
  assert.equal((await como(U.equipe, () => q(`select 1 from public.chamados`), 'aal1')).length, 0);
  assert.ok((await como(U.equipe, () => q(`select 1 from public.chamados`), 'aal2')).length >= 3);
});
await t('equipe lê notas internas com MFA e papel limita a escrita', async () => {
  const m = await como(U.equipe, () => q(`select 1 from public.chamado_mensagens where visibilidade='interna'`), 'aal2');
  assert.equal(m.length, 1);
  await como(U.equipe, () => nega(q(`insert into public.organizations (razao_social,cnpj) values ('X','33333333333333')`)), 'aal2');
  await como(U.equipe, () => nega(q(`insert into public.staff (user_id,nome,papel) values ($1,'X','admin')`, [U.adminA])), 'aal2');
  await como(U.equipe, () => q(`insert into public.chamado_categorias (nome) values ('Nova')`), 'aal2');
});
await t('materiais: publicado para todos, restrito e rascunho', async () => {
  const a = await como(U.membroA, () => q(`select id from public.conteudos`));
  assert.deepEqual(a.map((x) => x.id), [MAT_TODOS]);
  const b = await como(U.adminB, () => q(`select id from public.conteudos order by id`));
  assert.deepEqual(b.map((x) => x.id), [MAT_TODOS, MAT_B]);
});
await t('storage: material e anexo respeitam organização', async () => {
  const pathA = `${ORG_A}/${chamadoA2.id}/f.pdf`;
  await q(`insert into storage.objects (bucket_id,name) values ('materiais','so-b.pdf'),('materiais','rascunho.pdf')`);
  assert.equal((await como(U.membroA, () => q(`select 1 from storage.objects where bucket_id='materiais'`))).length, 0);
  assert.equal((await como(U.adminB, () => q(`select 1 from storage.objects where bucket_id='materiais'`))).length, 1);
  await como(U.membro2A, () => q(`insert into storage.objects (bucket_id,name) values ('anexos',$1)`, [pathA]));
  await como(U.adminB, () => nega(q(`insert into storage.objects (bucket_id,name) values ('anexos',$1)`, [pathA + '2'])));
  await como(U.membroA, () => nega(q(`insert into storage.objects (bucket_id,name) values ('anexos',$1)`, [pathA + '3'])));
  assert.equal((await como(U.adminB, () => q(`select 1 from storage.objects where bucket_id='anexos'`))).length, 0);
  assert.equal((await como(U.adminA, () => q(`select 1 from storage.objects where bucket_id='anexos'`))).length, 1);
  await como(U.membro2A, () => q(`select public.registrar_anexo($1,$2,'f.pdf')`, [chamadoA2.id, pathA]));
  await como(U.membro2A, () => nega(q(`select public.registrar_anexo($1,$2,'f.pdf')`, [chamadoA2.id, `${ORG_B}/${chamadoB.id}/f.pdf`])));
});
await t('organização suspensa perde acesso e preserva dados', async () => {
  await q(`update public.organizations set status='suspensa' where id=$1`, [ORG_B]);
  await como(U.adminB, async () => {
    assert.equal((await q(`select 1 from public.chamados`)).length, 0);
    assert.equal((await q(`select 1 from public.conteudos`)).length, 0);
    await nega(abrir(ORG_B));
  });
  assert.equal((await q(`select 1 from public.chamados where organization_id=$1`, [ORG_B])).length, 1);
  await q(`update public.organizations set status='ativa' where id=$1`, [ORG_B]);
});
await t('membro suspenso perde acesso', async () => {
  const [m] = await q(`select id from public.org_members where user_id=$1`, [U.membro2A]);
  await como(U.adminA, () => q(`select public.alterar_membro($1,'suspenso')`, [m.id]));
  assert.equal((await como(U.membro2A, () => q(`select 1 from public.chamados`))).length, 0);
  await como(U.adminA, () => q(`select public.alterar_membro($1,'ativo')`, [m.id]));
});
await t('não fica sem admin; admin de outra organização não altera', async () => {
  const [a] = await q(`select id from public.org_members where user_id=$1`, [U.adminA]);
  await como(U.adminA, () => nega(q(`select public.alterar_membro($1,'suspenso')`, [a.id]), /administrador/));
  await como(U.adminB, () => nega(q(`select public.alterar_membro($1,'suspenso')`, [a.id])));
  await como(U.membroA, () => nega(q(`select public.alterar_membro($1,'suspenso')`, [a.id])));
});
await t('auditoria registra mudança de chamado e de usuário', async () => {
  assert.ok((await q(`select 1 from public.audit_log where entidade='chamados' and entidade_id=$1`, [chamadoA.id])).length >= 1);
  const r = await q(`select ator_id from public.audit_log where entidade='org_members' and ator_id=$1`, [U.adminA]);
  assert.ok(r.length >= 2);
});
await t('fila: reserva, ordem, falha com espera e confirmação', async () => {
  await db.exec(`update public.sync_outbox set processado_em = now()`);
  const [c] = await como(U.adminA, () => abrir(ORG_A, PROJ_A));
  await como(U.adminA, () => q(`select * from public.responder_chamado($1,'Complemento')`, [c.id]));
  const pegar = () => como('service', async () => (await q(`select public.fila_notion_pendentes(10) r`))[0].r);
  const l1 = await pegar();
  assert.equal(l1.length, 1, 'mensagem espera a página do chamado existir');
  assert.equal(l1[0].chamado.protocolo, c.protocolo);
  assert.equal(l1[0].chamado.solicitante_email, 'admin@a.test');
  assert.equal((await pegar()).length, 0, 'item reservado não sai duas vezes');
  await como('service', () => q(`select public.fila_notion_concluir($1,false,'Notion 429')`, [l1[0].fila_id]));
  const [f] = await q(`select tentativas, erro, processado_em from public.sync_outbox where id=$1`, [l1[0].fila_id]);
  assert.equal(f.tentativas, 1); assert.equal(f.erro, 'Notion 429'); assert.equal(f.processado_em, null);
  await db.exec(`update public.sync_outbox set proxima_tentativa_em = now() where processado_em is null`);
  await como('service', () => nega(q(`select public.fila_notion_concluir($1,true)`, [l1[0].fila_id]), /notion_page_id/));
  await como('service', () => q(`select public.fila_notion_concluir($1,true,null,'pg-1')`, [l1[0].fila_id]));
  const l2 = await pegar();
  assert.equal(l2.length, 1); assert.equal(l2[0].entidade, 'mensagem'); assert.equal(l2[0].notion_page_id, 'pg-1');
  await como('service', () => q(`select public.fila_notion_concluir($1,true)`, [l2[0].fila_id]));
  assert.equal((await pegar()).length, 0);
});
await t('e-mail: pendentes, falha e envio', async () => {
  const [p] = (await como('service', () => q(`select * from public.emails_pendentes(1)`)));
  await como('service', () => q(`select public.email_concluir($1,false,'x')`, [p.id]));
  assert.equal((await q(`select tentativas from public.email_outbox where id=$1`, [p.id]))[0].tentativas, 1);
  await como('service', () => q(`select public.email_concluir($1,true)`, [p.id]));
  assert.ok((await q(`select enviado_em from public.email_outbox where id=$1`, [p.id]))[0].enviado_em);
});
await t('cliente não acessa funções de integração', () => como(U.adminA, async () => {
  await nega(q(`select public.fila_notion_pendentes(1)`), /permission denied/);
  await nega(q(`select public.buscar_usuario_por_email('admin@b.test')`), /permission denied/);
  await nega(q(`select * from public.emails_pendentes(1)`), /permission denied/);
}));
const COM = id(7), ORG_C = id(103);
await db.exec(`
  insert into auth.users values ('${COM}','comercial@p.test');
  insert into public.staff (user_id, nome, papel) values ('${COM}','Comercial','comercial');
`);
const PRESTAI = '11111111-2222-4333-8444-555555555555';
await t('vínculo PrestAí: organização sem CNPJ e identificador único', () => como(COM, async () => {
  await q(`insert into public.organizations (id, razao_social) values ($1,'Org sem CNPJ')`, [ORG_C]);
  await q(`update public.organizations set prestai_org_id=$1 where id=$2`, [PRESTAI, ORG_C]);
  await nega(q(`update public.organizations set prestai_org_id=$1 where id=$2`, [PRESTAI, ORG_A]), /duplicate key|unique/);
  await nega(q(`insert into public.organizations (razao_social, cnpj) values ('CNPJ ruim','123')`));
  await q(`update public.projects set prestai_project_id=$1 where id=$2`, [PRESTAI, PROJ_A]);
  await nega(q(`update public.projects set prestai_project_id=$1 where id=$2`, [PRESTAI, PROJ_B]), /duplicate key|unique/);
}, 'aal2'));
await t('vínculo PrestAí: só o comercial com MFA grava o usuário', async () => {
  const [m] = await q(`select id from public.org_members where user_id=$1`, [U.membroA]);
  const vincular = () => q(`select public.vincular_usuario_prestai($1,$2)`, [m.id, PRESTAI]);
  await como(U.adminA, () => nega(vincular(), /Sem acesso/), 'aal2');
  await como(U.equipe, () => nega(vincular(), /Sem acesso/), 'aal2');
  await como(COM, () => nega(vincular(), /Sem acesso/));
  await como(U.adminA, () => nega(q(`update public.org_members set prestai_user_id=$1`, [PRESTAI])));
  assert.equal((await q(`select prestai_user_id from public.org_members where id=$1`, [m.id]))[0].prestai_user_id, null);
  await como(COM, () => vincular(), 'aal2');
  assert.equal((await q(`select prestai_user_id from public.org_members where id=$1`, [m.id]))[0].prestai_user_id, PRESTAI);
  await como(COM, () => nega(q(`select public.vincular_usuario_prestai($1,$2)`, [id(999), PRESTAI]), /não encontrado/), 'aal2');
});
await t('vínculo PrestAí: cliente não altera o identificador da organização', async () => {
  await como(U.adminA, () => q(`update public.organizations set prestai_org_id=$1 where id=$2`, [id(555), ORG_A]), 'aal2');
  assert.equal((await q(`select prestai_org_id from public.organizations where id=$1`, [ORG_A]))[0].prestai_org_id, null);
});
await t('equipe sem MFA lê só a própria linha em staff, nunca as outras nem escreve', () => como(U.semMfa, async () => {
  const r = await q(`select user_id from public.staff`);
  assert.equal(r.length, 1);
  assert.equal(r[0].user_id, U.semMfa);
  const alt = await q(`update public.staff set papel='admin' where user_id=$1 returning 1`, [U.semMfa]);
  assert.equal(alt.length, 0);
  await nega(q(`insert into public.staff (user_id, nome, papel) values ($1,'x','admin')`, [U.adminA]));
}));
await t('cliente não enxerga nenhuma linha de staff', () => como(U.adminA, async () => {
  assert.equal((await q(`select 1 from public.staff`)).length, 0);
}));
await t('equipe com MFA continua lendo todas as linhas de staff', () => como(U.equipe, async () => {
  assert.ok((await q(`select 1 from public.staff`)).length >= 3);
}, 'aal2'));
await t('slug do PrestAí: formato válido e único por organização', () => como(COM, async () => {
  await q(`update public.organizations set prestai_org_slug='instituto-exemplo' where id=$1`, [ORG_C]);
  await nega(q(`update public.organizations set prestai_org_slug='instituto-exemplo' where id=$1`, [ORG_A]), /duplicate key|unique/);
  for (const ruim of ['Instituto', 'associa-o-', '-abc', 'a--b', 'a b', 'ação']) {
    await nega(q(`update public.organizations set prestai_org_slug=$1 where id=$2`, [ruim, ORG_A]), /check|violates/);
  }
}, 'aal2'));
await t('cliente não altera o slug da organização', () => como(U.adminA, async () => {
  await q(`update public.organizations set prestai_org_slug='invasor' where id=$1`, [ORG_A]);
  assert.equal((await q(`select prestai_org_slug from public.organizations where id=$1`, [ORG_A]))[0].prestai_org_slug, null);
}, 'aal2'));
await t('RLS ligada em todas as tabelas e funções sem execução pública', async () => {
  const semRls = await q(`select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`);
  assert.deepEqual(semRls, []);
  const anonExec = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','app') and has_function_privilege('anon', p.oid, 'execute')`);
  assert.deepEqual(anonExec, []);
});

console.log(`\n${ok} passaram, ${falhas} falharam`);
process.exit(falhas ? 1 : 0);
