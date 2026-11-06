import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import session from 'express-session';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/password.js';
import { TokenVault } from '../src/token-vault.js';
import { ThreadsAccounts } from '../src/threads-accounts.js';
import { Invitations } from '../src/invitations.js';
import { ContentStore } from '../src/content-store.js';
import { PublicationRequests } from '../src/publication-requests.js';
import { ThreadsOAuthClient } from '../src/threads-oauth-client.js';

async function fixture(withThreads=false) {
  const db=new PGlite();
  for (const file of (await readdir('db/migrations')).filter(file=>file.endsWith('.sql')).sort()) await db.exec(await readFile(`db/migrations/${file}`,'utf8'));
  const query=async(sql:string,params?:unknown[])=>{const r=await db.query(sql,params);return {...r,rowCount:r.rows.length || r.affectedRows || 0};};
  const pool={query,connect:async()=>({query,release:()=>{}})} as unknown as Pool;
  const password='kata sandi pengujian workspace',hash=await hashPassword(password);
  const admin=randomUUID(),editor=randomUUID(),reviewer=randomUUID();
  for (const [id,role] of [[admin,'admin'],[editor,'editor'],[reviewer,'reviewer']]) await query('INSERT INTO local_users(id,email,password_hash,role,email_verified_at) VALUES ($1,$2,$3,$4,now())',[id,`${role}@example.test`,hash,role]);
  const vault=new TokenVault(Buffer.alloc(32,8)),origin='http://localhost:3000';
  const checkedTokens:string[]=[];
  const client=new ThreadsOAuthClient({appId:'1234',appSecret:'private-app-secret',redirectUri:'https://example.test/api/threads/oauth/callback'},(async(input:string|URL|Request)=>{
    const url=new URL(String(input));
    if (url.pathname==='/oauth/access_token') return Response.json({access_token:'private-app-token'});
    assert.equal(url.pathname,'/debug_token');checkedTokens.push(url.searchParams.get('input_token')!);
    return Response.json({data:{is_valid:true,app_id:'1234',scopes:['threads_basic','threads_content_publish','threads_manage_replies','unknown-scope'],message:'private-token'}});
  }) as typeof fetch);
  const app=await createApp({pool,store:new session.MemoryStore(),secret:'a'.repeat(48),origin,secure:false,trustProxy:false,publishingEnabled:true,...(withThreads ? {threads:{client,vault}} : {})});
  const login=async(role:string)=>{
    const agent=request.agent(app),csrf=(await agent.get('/api/auth/csrf')).body.csrfToken;
    const result=await agent.post('/api/auth/login').set('Origin',origin).set('X-CSRF-Token',csrf).send({email:`${role}@example.test`,password});
    assert.equal(result.status,200);return {agent,csrf:result.body.csrfToken};
  };
  const post=async(body:string,owner=admin)=>{
    const store=new ContentStore(pool);return store.create({id:owner,role:owner===admin ? 'admin' : 'editor'},{body,destinationAccountId:null});
  };
  return {db,query,pool,app,admin,editor,reviewer,vault,origin,login,post,checkedTokens};
}

test('administrasi anggota memeriksa akses, sesi, admin terakhir dan pencabutan undangan',async()=>{
  const f=await fixture();
  try {
    const {agent,csrf}=await f.login('admin'),ed=await f.login('editor'),review=await f.login('reviewer');
    for (const path of ['/api/team/members','/api/invitations','/api/threads/accounts/manage','/api/audit']) {
      assert.equal((await request(f.app).get(path)).status,401);
      assert.equal((await ed.agent.get(path)).status,403);assert.equal((await review.agent.get(path)).status,403);
    }
    const members=await agent.get('/api/team/members');assert.equal(members.body.members.length,3);assert.doesNotMatch(JSON.stringify(members.body),/password_hash|session_version/);
    const change=(id:string,data:unknown,token=csrf)=>agent.patch(`/api/team/members/${id}`).set('Origin',f.origin).set('X-CSRF-Token',token).send(data);
    assert.equal((await change(f.editor,{role:'admin',expectedRole:'editor',expectedDisabled:false},'wrong')).status,403);
    assert.equal((await change(f.admin,{role:'editor',expectedRole:'admin',expectedDisabled:false})).status,409);
    assert.equal((await change(f.admin,{disabled:true,expectedRole:'admin',expectedDisabled:false})).status,409);
    assert.equal((await change(f.editor,{role:'reviewer',expectedRole:'editor',expectedDisabled:false,password_hash:'bad'})).status,400);
    assert.equal((await change(f.editor,{role:'reviewer',expectedRole:'editor',expectedDisabled:false})).status,204);
    assert.equal((await ed.agent.get('/api/posts')).status,401);
    assert.equal((await change(f.editor,{role:'admin',expectedRole:'editor',expectedDisabled:false})).status,409);
    assert.equal((await change(f.reviewer,{disabled:true,expectedRole:'reviewer',expectedDisabled:false})).status,204);
    assert.equal((await review.agent.get('/api/auth/me')).status,401);
    assert.equal((await change(f.reviewer,{disabled:false,expectedRole:'reviewer',expectedDisabled:true})).status,204);
    await f.login('reviewer');
    const invite=await new Invitations(f.pool).issue(f.admin,'invite@example.test','editor');
    const invitations=await agent.get('/api/invitations');assert.equal(invitations.body.invitations.length,1);assert.doesNotMatch(JSON.stringify(invitations.body),/token_hash|token/);
    const id=invitations.body.invitations[0].id;
    assert.equal((await agent.delete(`/api/invitations/${id}`).set('Origin',f.origin).set('X-CSRF-Token',csrf)).status,204);
    assert.equal(await new Invitations(f.pool).accept(invite.token,'kata sandi anggota undangan'),false);
    assert.equal((await agent.delete(`/api/invitations/${id}`).set('Origin',f.origin).set('X-CSRF-Token',csrf)).status,409);
    const events=(await agent.get('/api/audit')).body.events;
    assert.ok(events.some((e:{action:string})=>e.action==='member.updated'));assert.ok(events.some((e:{action:string})=>e.action==='invitation.revoked'));
    assert.doesNotMatch(JSON.stringify(events),/kata sandi|token_hash|password_hash/);
  } finally {await f.db.close();}
});

test('zona waktu tim hanya diubah admin terverifikasi tanpa menggeser jadwal',async()=>{
  const f=await fixture();
  try {
    const admin=await f.login('admin'),editor=await f.login('editor'),reviewer=await f.login('reviewer');
    assert.equal((await request(f.app).get('/api/team/settings')).status,401);
    assert.deepEqual((await editor.agent.get('/api/team/settings')).body,{timeZone:'Asia/Makassar',revision:1});
    const update=(session:{agent:any;csrf:string},data:unknown,csrf=session.csrf)=>session.agent.put('/api/team/settings').set('Origin',f.origin).set('X-CSRF-Token',csrf).send(data);
    assert.equal((await update(editor,{timeZone:'UTC',revision:1})).status,403);
    assert.equal((await update(reviewer,{timeZone:'UTC',revision:1})).status,403);
    assert.equal((await update(admin,{timeZone:'UTC',revision:1},'invalid')).status,403);
    assert.equal((await update(admin,{timeZone:'Invalid/Zone',revision:1})).status,400);
    const account=await new ThreadsAccounts(f.pool,f.vault).register(f.admin,{threadsUserId:'123',username:'account',token:'private-token',expiresAt:new Date(Date.now()+86400000)});
    const post=await f.post('Jadwal tetap'),job=randomUUID();
    await f.query("INSERT INTO publication_jobs(id,post_id,content_version,account_id,requested_by,scheduled_at,time_zone,next_attempt_at,status) VALUES ($1,$2,1,$3,$4,'2026-11-07T01:00:00Z','Asia/Makassar','2026-11-07T01:00:00Z','scheduled')",[job,post.id,account,f.admin]);
    assert.deepEqual((await update(admin,{timeZone:'Asia/Jakarta',revision:1})).body,{timeZone:'Asia/Jakarta',revision:2});
    assert.equal((await update(admin,{timeZone:'UTC',revision:1})).status,409);
    const saved=(await f.query('SELECT scheduled_at,time_zone FROM publication_jobs WHERE id=$1',[job])).rows[0] as {scheduled_at:Date;time_zone:string};
    assert.equal(new Date(saved.scheduled_at).toISOString(),'2026-11-07T01:00:00.000Z');assert.equal(saved.time_zone,'Asia/Makassar');
    assert.equal((await editor.agent.get('/api/team/settings')).body.timeZone,'Asia/Jakarta');
    assert.ok((await admin.agent.get('/api/audit')).body.events.some((e:{action:string})=>e.action==='team_settings.updated'));
    await f.query('UPDATE local_users SET email_verified_at=NULL WHERE id=$1',[f.admin]);
    assert.equal((await update(admin,{timeZone:'UTC',revision:2})).status,403);
  } finally {await f.db.close();}
});

test('pemeriksaan izin dari UI hanya memeriksa akun yang dipilih dan tidak mengekspos kredensial',async()=>{
  const f=await fixture(true);
  try {
    const {agent,csrf}=await f.login('admin');
    const account=await new ThreadsAccounts(f.pool,f.vault).register(f.admin,{threadsUserId:'123',username:'first',token:'private-first-token',expiresAt:new Date(Date.now()+86400000)});
    await new ThreadsAccounts(f.pool,f.vault).register(f.admin,{threadsUserId:'456',username:'second',token:'private-second-token',expiresAt:new Date(Date.now()+86400000)});
    const result=await agent.post(`/api/threads/accounts/${account}/permissions`).set('Origin',f.origin).set('X-CSRF-Token',csrf);
    assert.equal(result.status,200);assert.equal(result.body.accounts.length,1);assert.equal(result.body.accounts[0].appMatches,true);
    assert.deepEqual(result.body.accounts[0].missing,['threads_read_replies']);assert.deepEqual(f.checkedTokens,['private-first-token']);
    assert.doesNotMatch(JSON.stringify(result.body),/private-|unknown-scope/);
    assert.doesNotMatch(JSON.stringify((await agent.get('/api/audit')).body),/private-|encrypted_token/);
  } finally {await f.db.close();}
});

test('filter server, hapus draft dan riwayat mempertahankan publikasi dan konten yang disetujui',async()=>{
  const f=await fixture();
  try {
    const {agent,csrf}=await f.login('admin'),ed=await f.login('editor');
    const account=await new ThreadsAccounts(f.pool,f.vault).register(f.admin,{threadsUserId:'123',username:'account',token:'private-token',expiresAt:new Date(Date.now()+86400000)});
    const first=await f.post('Versi pertama');const store=new ContentStore(f.pool);
    await store.edit({id:f.admin,role:'admin'},first.id,1,{body:'Versi kedua',destinationAccountId:account,replies:['Balasan unik']});
    const another=await f.post('Draft lain',f.editor);
    const path=`/api/posts/${first.id}`;
    assert.equal((await ed.agent.get(`${path}/history`)).body.versions.items.length,2);
    assert.equal((await ed.agent.delete(path).set('Origin',f.origin).set('X-CSRF-Token',ed.csrf).send({revision:2})).status,403);
    const remove=(id:string,revision:number)=>agent.delete(`/api/posts/${id}`).set('Origin',f.origin).set('X-CSRF-Token',csrf).send({revision});
    assert.equal((await remove(first.id,1)).status,409);
    assert.equal((await agent.get(`/api/posts?accountId=${account}`)).body.posts.length,1);
    const searched=await agent.get('/api/posts?search=VERSI&status=submitted');
    assert.equal(searched.body.posts.length,0);assert.equal(searched.body.summary.total,1);
    assert.equal((await agent.get('/api/posts?search=pertama')).body.posts.length,0);
    assert.equal((await agent.get('/api/posts?search=KEDUA')).body.posts[0].id,first.id);
    assert.equal((await agent.get('/api/posts?search=balasan%20unik')).body.posts[0].id,first.id);
    assert.equal((await agent.get('/api/posts?search=%25')).body.posts.length,0);
    assert.equal((await agent.get(`/api/posts?search=${'x'.repeat(201)}`)).status,400);
    for (const query of ['status=wrong','accountId=bad','dateFrom=2026-02-31','dateFrom=2026-11-10&dateTo=2026-11-01','timeZone=Invalid/Zone','offset=-1','status=draft&status=approved']) assert.equal((await agent.get(`/api/posts?${query}`)).status,400,query);
    await store.transition({id:f.admin,role:'admin'},first.id,2,'submit');assert.equal((await remove(first.id,3)).status,409);
    await store.transition({id:f.admin,role:'admin'},first.id,3,'approve');
    const job=await new PublicationRequests(f.pool).publishNow(f.admin,first.id,4,'Asia/Makassar');
    await f.query("UPDATE publication_jobs SET scheduled_at='2026-11-06T16:00:00Z' WHERE id=$1",[job.id]);
    assert.equal((await agent.get('/api/posts?dateField=scheduled&dateFrom=2026-11-07&dateTo=2026-11-07&timeZone=Asia/Makassar')).body.posts.length,1);
    assert.equal((await agent.get('/api/posts?dateField=scheduled&dateFrom=2026-11-06&dateTo=2026-11-06&timeZone=Asia/Makassar')).body.posts.length,0);
    assert.equal((await agent.get('/api/posts?status=scheduled')).body.posts[0].id,first.id);
    assert.equal((await remove(first.id,4)).status,409);
    const history=(await agent.get(`${path}/history`)).body;assert.equal(history.versions.items[0].body,'Versi kedua');assert.equal(history.reviews.items[0].decision,'approved');assert.equal(history.jobs.items[0].id,job.id);
    assert.doesNotMatch(JSON.stringify(history),/private-token|encrypted_token|token_iv|password_hash/);
    const mine=await f.post('Draft dihapus');assert.equal((await remove(mine.id,1)).status,204);
    assert.equal((await agent.get('/api/posts')).body.posts.some((p:{id:string})=>p.id===mine.id),false);
    assert.equal((await agent.get(`/api/posts/${mine.id}/history`)).status,404);
    await assert.rejects(store.edit({id:f.admin,role:'admin'},mine.id,2,{body:'Hidup lagi'}),/tidak ditemukan/);
    assert.equal((await f.query('SELECT body FROM content_versions WHERE post_id=$1',[mine.id])).rows[0].body,'Draft dihapus');
    assert.ok((await agent.get('/api/audit')).body.events.some((e:{action:string;subject_id:string})=>e.action==='post.deleted' && e.subject_id===mine.id));
    assert.equal((await agent.get('/api/posts?status=draft')).body.posts.some((p:{id:string})=>p.id===another.id),true);
  } finally {await f.db.close();}
});

test('duplikasi membuat versi draft baru dengan balasan dan tanpa akun yang tidak aktif',async()=>{
  const f=await fixture();
  try {
    const owner=await f.login('admin'),editor=await f.login('editor');
    const account=await new ThreadsAccounts(f.pool,f.vault).register(f.admin,{threadsUserId:'123',username:'account',token:'private-token',expiresAt:new Date(Date.now()+86400000)});
    const source=await new ContentStore(f.pool).create({id:f.admin,role:'admin'},{body:'Induk',replies:['Balasan satu','Balasan dua'],destinationAccountId:account});
    await f.query("UPDATE threads_accounts SET token_expires_at=now()-interval '1 day' WHERE id=$1",[account]);
    assert.equal((await request(f.app).post(`/api/posts/${source.id}/duplicate`).send({revision:1})).status,401);
    const response=await editor.agent.post(`/api/posts/${source.id}/duplicate`).set('Origin',f.origin).set('X-CSRF-Token',editor.csrf).send({revision:1});
    assert.equal(response.status,201);const copy=response.body.post.id;
    const versions=await f.query('SELECT body,destination_account_id,created_by FROM content_versions WHERE post_id=$1',[copy]);
    assert.deepEqual(versions.rows[0],{body:'Induk',destination_account_id:null,created_by:f.editor});
    assert.deepEqual((await f.query('SELECT body FROM content_version_replies WHERE post_id=$1 ORDER BY position',[copy])).rows.map((r:any)=>r.body),['Balasan satu','Balasan dua']);
    assert.equal((await owner.agent.get('/api/audit')).body.events.some((e:{action:string;subject_id:string})=>e.action==='post.duplicated' && e.subject_id===copy),true);
  } finally {await f.db.close();}
});

test('pemutusan akun menghapus token, menghentikan antrean aman dan mempertahankan hasil tidak pasti',async()=>{
  const f=await fixture();
  try {
    const {agent,csrf}=await f.login('admin'),ed=await f.login('editor');
    const account=await new ThreadsAccounts(f.pool,f.vault).register(f.admin,{threadsUserId:'123',username:'account',token:'private-token',expiresAt:new Date(Date.now()+86400000)});
    const states=['scheduled','preparing','publishing','uncertain'];const jobs:string[]=[];
    for (const state of states) {
      const post=await f.post(`Konten ${state}`),id=randomUUID();jobs.push(id);
      await f.query("INSERT INTO publication_jobs(id,post_id,content_version,account_id,requested_by,scheduled_at,time_zone,next_attempt_at,status) VALUES ($1,$2,1,$3,$4,now(),'UTC',now(),$5)",[id,post.id,account,f.admin,state]);
    }
    assert.equal((await ed.agent.delete(`/api/threads/accounts/${account}`).set('Origin',f.origin).set('X-CSRF-Token',ed.csrf)).status,403);
    assert.equal((await agent.post(`/api/threads/accounts/${account}/permissions`).set('Origin',f.origin).set('X-CSRF-Token',csrf)).status,503);
    const result=await agent.delete(`/api/threads/accounts/${account}`).set('Origin',f.origin).set('X-CSRF-Token',csrf);assert.equal(result.status,200);assert.equal(result.body.pausedJobs,2);assert.equal(result.body.scope,'local');
    const row=(await f.query('SELECT status,encrypted_token,token_iv,token_tag FROM threads_accounts WHERE id=$1',[account])).rows[0];assert.deepEqual(row,{status:'disconnected',encrypted_token:null,token_iv:null,token_tag:null});
    for (const [index,id] of jobs.entries()) assert.equal((await f.query('SELECT status FROM publication_jobs WHERE id=$1',[id])).rows[0].status,index<2 ? 'needs_action' : states[index]);
    assert.equal((await agent.get('/api/threads/accounts')).body.accounts.length,0);
    assert.equal((await agent.get('/api/threads/accounts/manage')).body.accounts[0].status,'disconnected');
    assert.equal((await agent.post(`/api/threads/accounts/${account}/permissions`).set('Origin',f.origin).set('X-CSRF-Token',csrf)).status,404);
    assert.equal(await new ThreadsAccounts(f.pool,f.vault).register(f.admin,{threadsUserId:'123',username:'account',token:'new-token',expiresAt:new Date(Date.now()+86400000)}),account);
    assert.equal((await f.query('SELECT status FROM publication_jobs WHERE id=$1',[jobs[0]])).rows[0].status,'needs_action');
  } finally {await f.db.close();}
});
