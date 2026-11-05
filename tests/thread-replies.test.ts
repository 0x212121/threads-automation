import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { ContentStore } from '../src/content-store.js';
import { PublicationQueue } from '../src/publication-queue.js';
import { PublicationRequests } from '../src/publication-requests.js';
import { processPublication } from '../src/publication-worker.js';
import { ThreadsPublisher } from '../src/threads-publisher.js';
import { TokenVault } from '../src/token-vault.js';
import { verifyPublishedPart } from '../src/verify-published-part.js';

test('rangkaian berhenti saat hasil balasan tidak pasti dan melanjutkan tanpa mengulang bagian sebelumnya', async () => {
  const db=new PGlite();
  for (const name of ['001_content.sql','002_local_identity.sql','007_threads_accounts.sql','009_publication_jobs.sql','010_publication_resolutions.sql','011_publication_diagnostics.sql','012_media.sql','014_carousel.sql','015_thread_replies.sql','016_publication_reference_repairs.sql','017_publication_failure_details.sql']) await db.exec(await readFile(`db/migrations/${name}`,'utf8'));
  const query=async (sql:string,params?:unknown[]) => { const result=await db.query(sql,params); return {...result,rowCount:result.rows.length || result.affectedRows || 0}; };
  const pool={query,connect:async()=>({query,release:()=>{}})} as unknown as Pool;
  const owner='11111111-1111-4111-8111-111111111111',account='22222222-2222-4222-8222-222222222222';
  const vault=new TokenVault(Buffer.alloc(32,3)), sealed=vault.seal('test-token',`${account}:123`);
  await query("INSERT INTO local_users(id,email,password_hash,role,email_verified_at) VALUES ($1,'admin@example.test','hash','admin',now())",[owner]);
  await query("INSERT INTO threads_accounts(id,threads_user_id,username,connected_by,encrypted_token,token_iv,token_tag,token_expires_at,status) VALUES ($1,'123','test',$2,$3,$4,$5,now()+interval '1 day','active')",[account,owner,sealed.ciphertext,sealed.iv,sealed.tag]);
  const content=new ContentStore(pool),actor={id:owner,role:'admin'} as const;
  const post=await content.create(actor,{body:'Awal',replies:['Kedua','Ketiga'],destinationAccountId:account});
  await content.transition(actor,post.id,1,'submit'); await content.transition(actor,post.id,2,'approve');
  const requests=new PublicationRequests(pool), job=await requests.publishNow(owner,post.id,3,'UTC'), queue=new PublicationQueue(pool);
  const advance=async (jobId:string) => { await query('UPDATE publication_jobs SET next_attempt_at=now() WHERE id=$1',[jobId]); };
  async function runPart(publisher:ThreadsPublisher):Promise<boolean> {
    const processed=await processPublication(queue,vault,publisher);
    const prepared=(await db.query<{id:string}>("SELECT id FROM publication_jobs WHERE status='prepared' AND lease_token IS NULL")).rows[0];
    if (prepared) { await advance(prepared.id); await processPublication(queue,vault,publisher); }
    return processed;
  }
  const created: {text:string|null;reply:string|null}[]=[]; let publishes=0;
  const publisher=new ThreadsPublisher((async (input:string|URL|Request) => {
    const url=new URL(String(input));
    if (url.searchParams.get('fields')==='status') return Response.json({status:'FINISHED'});
    if (/^\/[0-9]+$/.test(url.pathname)) return Response.json({id:url.pathname.slice(1)});
    if (url.pathname==='/me/threads') { created.push({text:url.searchParams.get('text'),reply:url.searchParams.get('reply_to_id')}); return Response.json({id:String(100+created.length)}); }
    if (url.pathname==='/me/threads_publish') { publishes++; if (publishes===2) throw new Error('timeout'); return Response.json({id:String(200+publishes)}); }
    throw new Error('Unexpected request');
  }) as typeof fetch);
  assert.equal(await runPart(publisher),true);
  assert.equal(await queue.claim(),null);
  assert.equal((await db.query<{delay:number}>('SELECT extract(epoch from (next_attempt_at-updated_at))::int AS delay FROM publication_jobs WHERE id=$1',[job.id])).rows[0]?.delay,30);
  await advance(job.id);
  assert.equal(await runPart(publisher),true);
  assert.equal((await db.query<{status:string}>('SELECT status FROM publication_jobs WHERE id=$1',[job.id])).rows[0]?.status,'uncertain');
  assert.deepEqual(created,[{text:'Awal',reply:null},{text:'Kedua',reply:'201'}]);
  assert.equal(await runPart(publisher),false);
  await assert.rejects(requests.publishNow(owner,post.id,3,'UTC'),/Sebagian rangkaian sudah terbit/);
  await assert.rejects(content.edit(actor,post.id,3,{body:'edit'}),/publikasi aktif/);
  await assert.rejects(requests.resolveUncertain(owner,post.id,3,job.id,'published'),/ID posting/);
  const verify = (async (input:string|URL|Request,init?:RequestInit) => { assert.equal(new URL(String(input)).pathname,'/me/replies'); assert.equal(new Headers(init?.headers).get('authorization'),'Bearer test-token'); return Response.json({data:[{id:'202',username:'test',text:'Kedua',replied_to:{id:'201'}}]}); }) as typeof fetch;
  assert.equal(await verifyPublishedPart(pool,vault,owner,post.id,job.id,'202',verify),true);
  assert.equal(await verifyPublishedPart(pool,vault,owner,post.id,job.id,'999',verify),false);
  await query("INSERT INTO local_users(id,email,password_hash,role,email_verified_at) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','editor@example.test','hash','editor',now())");
  assert.equal(await verifyPublishedPart(pool,vault,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',post.id,job.id,'202',verify),false);
  const wrongParent=(async () => Response.json({data:[{id:'202',username:'test',text:'Kedua',replied_to:{id:'999'}}]})) as typeof fetch;
  assert.equal(await verifyPublishedPart(pool,vault,owner,post.id,job.id,'202',wrongParent),false);
  await requests.resolveUncertain(owner,post.id,3,job.id,'published','202');
  await requests.resume(owner,post.id,3,job.id);
  assert.equal(await runPart(publisher),true);
  assert.deepEqual(created[2],{text:'Ketiga',reply:'202'});
  assert.equal(created.length,3); assert.equal(publishes,3);
  assert.equal((await db.query<{status:string}>('SELECT status FROM publication_jobs WHERE id=$1',[job.id])).rows[0]?.status,'published');
  assert.deepEqual((await db.query<{published_id:string}>('SELECT published_id FROM publication_parts WHERE job_id=$1 ORDER BY position',[job.id])).rows.map(row=>row.published_id),['201','202','203']);
  const post2=await content.create(actor,{body:'Awal lagi',replies:['Balasan lagi'],destinationAccountId:account});
  await content.transition(actor,post2.id,1,'submit'); await content.transition(actor,post2.id,2,'approve');
  const job2=await requests.publishNow(owner,post2.id,3,'UTC');
  let tries=0, roots=0;
  const retryPublisher=new ThreadsPublisher((async (input:string|URL|Request) => {
    const url=new URL(String(input));
    if (url.searchParams.get('fields')==='status') return Response.json({status:'FINISHED'});
    if (/^\/[0-9]+$/.test(url.pathname)) return Response.json({id:url.pathname.slice(1)});
    if (url.pathname==='/me/threads') { if (!url.searchParams.has('reply_to_id')) roots++; return Response.json({id:String(300+ ++tries)}); }
    if (url.pathname==='/me/threads_publish') { if (tries===2) throw new Error('timeout'); return Response.json({id:String(400+tries)}); }
    throw new Error('Unexpected request');
  }) as typeof fetch);
  await runPart(retryPublisher); await advance(job2.id); await runPart(retryPublisher);
  await requests.resolveUncertain(owner,post2.id,3,job2.id,'not_published');
  await requests.resume(owner,post2.id,3,job2.id);
  await runPart(retryPublisher);
  assert.equal(roots,1); assert.equal(tries,3);
  assert.equal((await db.query<{status:string}>('SELECT status FROM publication_jobs WHERE id=$1',[job2.id])).rows[0]?.status,'published');
  const post3=await content.create(actor,{body:'Satu',replies:['Dua'],destinationAccountId:account});
  await content.transition(actor,post3.id,1,'submit'); await content.transition(actor,post3.id,2,'approve');
  const job3=await requests.publishNow(owner,post3.id,3,'UTC');
  let creates=0, deny=true;
  const permissionPublisher=new ThreadsPublisher((async (input:string|URL|Request) => {
    const url=new URL(String(input));
    if (url.searchParams.get('fields')==='status') return Response.json({status:'FINISHED'});
    if (/^\/[0-9]+$/.test(url.pathname)) return Response.json({id:url.pathname.slice(1)});
    if (url.pathname==='/me/threads') { creates++; if (creates===2 && deny) return Response.json({error:{code:10,error_subcode:42,message:'test-token teks rahasia'}},{status:403}); return Response.json({id:String(500+creates)}); }
    return Response.json({id:String(600+creates)});
  }) as typeof fetch);
  const warnings:string[]=[]; const originalWarn=console.warn;
  try {
    console.warn=(message?:unknown) => { warnings.push(String(message)); };
    await runPart(permissionPublisher); await advance(job3.id); await runPart(permissionPublisher);
  } finally { console.warn=originalWarn; }
  const rejected=(await db.query<{status:string;failure_code:string}>('SELECT status,failure_code FROM publication_jobs WHERE id=$1',[job3.id])).rows[0];
  assert.equal(rejected?.status,'needs_action'); assert.equal(rejected?.failure_code,'meta_auth');
  assert.equal(warnings.length,1); assert.equal(warnings[0]?.includes('test-token'),false); assert.equal(warnings[0]?.includes('teks rahasia'),false);
  assert.deepEqual(JSON.parse(warnings[0]!),{event:'threads_container_rejected',jobId:job3.id,part:2,operation:'create_container',retryable:false,httpStatus:403,metaCode:10,metaSubcode:42});
  deny=false; await requests.resume(owner,post3.id,3,job3.id); await runPart(permissionPublisher);
  assert.equal(creates,3); assert.equal((await db.query<{status:string}>('SELECT status FROM publication_jobs WHERE id=$1',[job3.id])).rows[0]?.status,'published');
  const post4=await content.create(actor,{body:'Induk',replies:['Balasan tertunda'],destinationAccountId:account});
  await content.transition(actor,post4.id,1,'submit'); await content.transition(actor,post4.id,2,'approve');
  const job4=await requests.publishNow(owner,post4.id,3,'UTC');
  let rootCreates=0, targetReads=0, replyCreates=0, completed=0;
  const propagationPublisher=new ThreadsPublisher((async (input:string|URL|Request) => {
    const url=new URL(String(input));
    if (url.searchParams.get('fields')==='status') return Response.json({status:'FINISHED'});
    if (/^\/[0-9]+$/.test(url.pathname)) {
      targetReads++;
      return targetReads===1 ? Response.json({error:{code:24,error_subcode:4279009}},{status:400}) : Response.json({id:url.pathname.slice(1)});
    }
    if (url.pathname==='/me/threads') {
      if (!url.searchParams.has('reply_to_id')) { rootCreates++; return Response.json({id:'701'}); }
      replyCreates++;
      assert.equal(url.searchParams.get('reply_to_id'),'801');
      return replyCreates===1 ? Response.json({error:{code:24,error_subcode:4279009}},{status:400}) : Response.json({id:'702'});
    }
    completed++; return Response.json({id:completed===1?'801':'802'});
  }) as typeof fetch);
  await runPart(propagationPublisher);
  await advance(job4.id);
  try {
    console.warn=(message?:unknown)=>{warnings.push(String(message));};
    for (let attempt=0; attempt<2; attempt++) {
      await runPart(propagationPublisher);
      const state=(await db.query<{status:string;part_index:number;reply_to_id:string;delay:number}>('SELECT status,part_index,reply_to_id,extract(epoch from (next_attempt_at-updated_at))::int AS delay FROM publication_jobs WHERE id=$1',[job4.id])).rows[0];
      assert.equal(state?.status,'scheduled'); assert.equal(state?.part_index,1); assert.equal(state?.reply_to_id,'801'); assert.ok(state!.delay>=30);
      assert.equal(completed,1); assert.equal(await queue.claim(),null);
      await advance(job4.id);
    }
  } finally {console.warn=originalWarn;}
  await runPart(propagationPublisher);
  assert.equal(rootCreates,1); assert.equal(replyCreates,2); assert.equal(completed,2);
  assert.equal((await db.query<{status:string}>('SELECT status FROM publication_jobs WHERE id=$1',[job4.id])).rows[0]?.status,'published');
  const post5=await content.create(actor,{body:'Induk terakhir',replies:['Target tetap tidak tersedia'],destinationAccountId:account});
  await content.transition(actor,post5.id,1,'submit'); await content.transition(actor,post5.id,2,'approve');
  const job5=await requests.publishNow(owner,post5.id,3,'UTC');
  let deadlinePublishes=0;
  const deadlinePublisher=new ThreadsPublisher((async (input:string|URL|Request) => {
    const url=new URL(String(input));
    if (url.searchParams.get('fields')==='status') return Response.json({status:'FINISHED'});
    if (/^\/[0-9]+$/.test(url.pathname)) return Response.json({error:{code:24,error_subcode:4279009}},{status:400});
    if (url.pathname==='/me/threads') return Response.json({id:'901'});
    deadlinePublishes++; return Response.json({id:'902'});
  }) as typeof fetch);
  await runPart(deadlinePublisher);
  await query("UPDATE publication_jobs SET scheduled_at=now()-interval '59 minutes 50 seconds',next_attempt_at=now() WHERE id=$1",[job5.id]);
  try {console.warn=()=>{}; await runPart(deadlinePublisher);} finally {console.warn=originalWarn;}
  assert.equal((await db.query<{status:string}>('SELECT status FROM publication_jobs WHERE id=$1',[job5.id])).rows[0]?.status,'needs_action');
  assert.equal(await queue.claim(),null); assert.equal(deadlinePublishes,1);
  await db.close();
});
