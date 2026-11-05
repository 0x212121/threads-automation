import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { ContentStore } from '../src/content-store.js';
import { PublicationQueue } from '../src/publication-queue.js';
import { processPublication } from '../src/publication-worker.js';
import { ThreadsPublisher } from '../src/threads-publisher.js';
import { TokenVault } from '../src/token-vault.js';
import type { MediaStore } from '../src/media-store.js';

test('carousel mengunci urutan gambar pada versi yang disetujui dan hanya menerbitkan induk satu kali', async () => {
  const db = new PGlite();
  for (const name of ['001_content.sql','002_local_identity.sql','007_threads_accounts.sql','009_publication_jobs.sql','011_publication_diagnostics.sql','012_media.sql','014_carousel.sql','015_thread_replies.sql','016_publication_reference_repairs.sql','017_publication_failure_details.sql','018_workspace_management.sql']) await db.exec(await readFile(`db/migrations/${name}`,'utf8'));
  const query = async (sql:string, params?:unknown[]) => { const result=await db.query(sql,params); return {...result,rowCount:result.affectedRows ?? result.rows.length}; };
  const pool={query,connect:async()=>({query,release:()=>{}})} as unknown as Pool;
  const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222', account='33333333-3333-4333-8333-333333333333';
  const first='44444444-4444-4444-8444-444444444444', second='55555555-5555-4555-8555-555555555555', foreign='66666666-6666-4666-8666-666666666666', job='77777777-7777-4777-8777-777777777777';
  const vault=new TokenVault(Buffer.alloc(32,5)), sealed=vault.seal('token-test',`${account}:123`);
  await query("INSERT INTO local_users(id,email,password_hash,role,email_verified_at) VALUES ($1,'a@example.test','hash','admin',now()),($2,'b@example.test','hash','editor',now())",[owner,other]);
  await query("INSERT INTO threads_accounts(id,threads_user_id,username,connected_by,encrypted_token,token_iv,token_tag,token_expires_at,status) VALUES ($1,'123','test',$2,$3,$4,$5,now()+interval '1 day','active')",[account,owner,sealed.ciphertext,sealed.iv,sealed.tag]);
  await query("INSERT INTO media_assets(id,uploaded_by,kind,byte_size,width,height) VALUES ($1,$4,'IMAGE',1,24,24),($2,$4,'IMAGE',1,24,24),($3,$5,'IMAGE',1,24,24)",[first,second,foreign,owner,other]);
  const store=new ContentStore(pool), actor={id:owner,role:'admin'} as const;
  await assert.rejects(store.create(actor,{body:'x',destinationAccountId:account,mediaIds:[first,foreign]}),/bukan milik/);
  await assert.rejects(store.create(actor,{body:'x',destinationAccountId:account,mediaIds:[first,first]}),/tidak valid/);
  const post=await store.create(actor,{body:'carousel',destinationAccountId:account,mediaIds:[second,first]});
  assert.deepEqual((await db.query<{media_id:string}>('SELECT media_id FROM content_version_media WHERE post_id=$1 ORDER BY position',[post.id])).rows.map(row=>row.media_id),[second,first]);
  await store.transition(actor,post.id,1,'submit'); await store.transition(actor,post.id,2,'approve');
  await query("INSERT INTO publication_jobs(id,post_id,content_version,account_id,requested_by,scheduled_at,time_zone,next_attempt_at,status) VALUES ($1,$2,1,$3,$4,now()-interval '1 minute','UTC',now(),'scheduled')",[job,post.id,account,owner]);
  const paths:string[]=[]; let statusChecks=0, publishes=0;
  const publisher=new ThreadsPublisher((async (input:string|URL|Request) => {
    const url=new URL(String(input)); paths.push(url.pathname);
    if (url.pathname==='/me/threads' && url.searchParams.get('is_carousel_item')==='true') return Response.json({id: url.searchParams.get('image_url')!.endsWith(second) ? '101' : '102'});
    if (url.pathname==='/101' || url.pathname==='/102') return Response.json({status:++statusChecks===1?'IN_PROGRESS':'FINISHED'});
    if (url.pathname==='/me/threads') { assert.equal(url.searchParams.get('media_type'),'CAROUSEL'); assert.equal(url.searchParams.get('children'),'101,102'); assert.equal(url.searchParams.get('text'),'carousel'); return Response.json({id:'103'}); }
    if (url.pathname==='/103') return Response.json({status:'FINISHED'});
    if (url.pathname==='/me/threads_publish') { publishes++; return Response.json({id:'104'}); }
    throw new Error('Unexpected request');
  }) as typeof fetch);
  const media={downloadUrl:(_origin:string,_job:string,id:string)=>`https://example.test/${id}`} as MediaStore, queue=new PublicationQueue(pool);
  assert.equal(await processPublication(queue,vault,publisher,{store:media,origin:'https://example.test'}),true);
  assert.equal(publishes,0); assert.equal((await db.query('SELECT * FROM publication_carousel_items')).rows.length,1);
  await query('UPDATE publication_jobs SET next_attempt_at=now() WHERE id=$1',[job]);
  assert.equal(await processPublication(queue,vault,publisher,{store:media,origin:'https://example.test'}),true);
  assert.equal(publishes,1); assert.equal(paths.filter(path=>path==='/me/threads').length,3);
  assert.equal((await db.query<{status:string}>('SELECT status FROM publication_jobs WHERE id=$1',[job])).rows[0]?.status,'published');
  assert.equal(await processPublication(queue,vault,publisher,{store:media,origin:'https://example.test'}),false);
  await db.close();
});
