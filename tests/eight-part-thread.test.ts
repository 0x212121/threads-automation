import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { ContentStore } from '../src/content-store.js';
import { PublicationRequests } from '../src/publication-requests.js';
import { PublicationQueue } from '../src/publication-queue.js';
import { ThreadsPublisher } from '../src/threads-publisher.js';
import { TokenVault } from '../src/token-vault.js';
import { processPublication } from '../src/publication-worker.js';
import { diagnoseReplyTarget } from '../src/threads-token-diagnostic.js';

for (const stopAtThird of [false,true]) test(stopAtThird ? 'penolakan publikasi bagian ketiga dicatat dan menghentikan rangkaian tanpa mengulang bagian sebelumnya' : 'delapan bagian menunggu kontainer siap, memakai ID publikasi sebelumnya dan pulih setelah restart worker',async()=>{
  const db=new PGlite();
  try {
    for (const file of ['001_content.sql','002_local_identity.sql','007_threads_accounts.sql','009_publication_jobs.sql','010_publication_resolutions.sql','011_publication_diagnostics.sql','012_media.sql','014_carousel.sql','015_thread_replies.sql','016_publication_reference_repairs.sql','017_publication_failure_details.sql','018_workspace_management.sql']) await db.exec(await readFile(`db/migrations/${file}`,'utf8'));
    const query=async(sql:string,params?:unknown[])=>{const r=await db.query(sql,params);return {...r,rowCount:r.rows.length || r.affectedRows || 0};};
    const pool={query,connect:async()=>({query,release:()=>{}})} as unknown as Pool;
    const user='11111111-1111-4111-8111-111111111111',account='22222222-2222-4222-8222-222222222222',vault=new TokenVault(Buffer.alloc(32,7)),sealed=vault.seal('token-test',`${account}:123`);
    await query("INSERT INTO local_users(id,email,password_hash,role,email_verified_at) VALUES ($1,'admin@example.test','hash','admin',now())",[user]);
    await query("INSERT INTO threads_accounts(id,threads_user_id,username,connected_by,encrypted_token,token_iv,token_tag,token_expires_at,status) VALUES ($1,'123','test',$2,$3,$4,$5,now()+interval '1 day','active')",[account,user,sealed.ciphertext,sealed.iv,sealed.tag]);
    const parts=Array.from({length:8},(_,i)=>`Bagian ${i+1}`),store=new ContentStore(pool),actor={id:user,role:'admin'} as const;
    const post=await store.create(actor,{body:parts[0]!,replies:parts.slice(1),destinationAccountId:account});
    await store.transition(actor,post.id,1,'submit');await store.transition(actor,post.id,2,'approve');
    const job=await new PublicationRequests(pool).publishNow(user,post.id,3,'Asia/Makassar');
    const published:string[]=[],containers:string[]=[],targets:string[]=[],readCounts=new Map<string,number>(),statusChecks=new Map<string,number>();
    let publishCalls=0;
    const publisher=new ThreadsPublisher((async(input:string|URL|Request)=>{
      const url=new URL(String(input));
      if (url.searchParams.get('fields')==='status') {
        const container=url.pathname.slice(1);assert.ok(containers.includes(container));
        const count=(statusChecks.get(container) ?? 0)+1;statusChecks.set(container,count);
        return Response.json({status:count===1 ? 'IN_PROGRESS' : 'FINISHED'});
      }
      if (/^\/[0-9]+$/.test(url.pathname)) {
        const target=url.pathname.slice(1);assert.equal(target,published.at(-1));assert.equal(containers.includes(target),false);
        const count=(readCounts.get(target) ?? 0)+1;readCounts.set(target,count);
        return count===1 ? Response.json({error:{code:24,error_subcode:4279009}},{status:400}) : Response.json({id:target});
      }
      if (url.pathname==='/me/threads') {
        const index=containers.length;assert.equal(url.searchParams.get('text'),parts[index]);
        if (index===0) assert.equal(url.searchParams.has('reply_to_id'),false);
        else {const target=url.searchParams.get('reply_to_id')!;assert.equal(target,published[index-1]);targets.push(target);}
        const container=`1800000000000000${index+1}`;containers.push(container);return Response.json({id:container});
      }
      assert.equal(url.pathname,'/me/threads_publish');assert.equal(url.searchParams.get('creation_id'),containers[published.length]);
      assert.equal(statusChecks.get(containers[published.length]!),2);
      publishCalls++;
      if (stopAtThird && publishCalls===3) return Response.json({error:{code:24,error_subcode:4279009,message:'token-test isi privat'}},{status:400});
      const id=`1900000000000000${published.length+1}`;published.push(id);return Response.json({id});
    }) as typeof fetch);
    const warn=console.warn,warnings:string[]=[];
    try {
      console.warn=(value?:unknown)=>{warnings.push(String(value));};
      for (let step=0;step<64;step++) {
        const state=(await db.query<{status:string}>('SELECT status FROM publication_jobs WHERE id=$1',[job.id])).rows[0]!.status;
        if (state==='published') break;
        if (stopAtThird && state==='uncertain') break;
        assert.ok(['scheduled','preparing','prepared'].includes(state),state);
        await query('UPDATE publication_jobs SET next_attempt_at=now() WHERE id=$1',[job.id]);
        assert.equal(await processPublication(new PublicationQueue(pool),vault,publisher),true);
      }
    } finally {console.warn=warn;}
    if (stopAtThird) {
      assert.equal(published.length,2);assert.equal(containers.length,3);assert.equal(publishCalls,3);
      const parts=(await db.query<{position:number;status:string}>('SELECT position,status FROM publication_parts WHERE job_id=$1 ORDER BY position',[job.id])).rows;
      assert.deepEqual(parts,[{position:0,status:'published'},{position:1,status:'published'},{position:2,status:'uncertain'}]);
      assert.equal(await processPublication(new PublicationQueue(pool),vault,publisher),false);assert.equal(publishCalls,3);
      const event=warnings.map(value=>JSON.parse(value)).find(value=>value.event==='threads_publish_uncertain');
      assert.deepEqual(event,{event:'threads_publish_uncertain',jobId:job.id,part:3,reason:'provider_rejected',httpStatus:400,metaCode:24,metaSubcode:4279009});
      assert.doesNotMatch(warnings.join(''),/token-test|isi privat/);
      const diagnostic=await diagnoseReplyTarget(pool,vault,job.id,(async(input:string|URL|Request,init?:RequestInit)=>{
        assert.equal(init?.method,undefined);const url=new URL(String(input));
        return url.pathname==='/me' ? Response.json({id:'123'}) : url.searchParams.get('fields')==='status' ? Response.json({status:'FINISHED'}) : Response.json({id:published[1]});
      }) as typeof fetch);
      assert.equal(diagnostic.status,'ok');assert.equal(diagnostic.part,3);assert.equal(diagnostic.jobStatus,'uncertain');
      assert.deepEqual(diagnostic.lastPublication,{outcome:'uncertain',reason:'provider_rejected',httpStatus:400,metaCode:24,metaSubcode:4279009});
      assert.deepEqual(diagnostic.container,{status:'FINISHED',httpStatus:200,metaCode:null,metaSubcode:null});
      assert.equal(diagnostic.parentReadable,true);assert.equal(publishCalls,3);
      return;
    }
    assert.equal(published.length,8);assert.equal(containers.length,8);assert.deepEqual(targets,published.slice(0,7));
    const rows=(await db.query<{position:number;status:string;published_id:string;provider_response_id:string;container_id:string}>('SELECT position,status,published_id,provider_response_id,container_id FROM publication_parts WHERE job_id=$1 ORDER BY position',[job.id])).rows;
    assert.equal(rows.length,8);rows.forEach((row,index)=>{assert.equal(row.position,index);assert.equal(row.status,'published');assert.equal(row.published_id,published[index]);assert.equal(row.provider_response_id,published[index]);assert.equal(row.container_id,containers[index]);});
    assert.equal((await db.query<{status:string}>('SELECT status FROM publication_jobs WHERE id=$1',[job.id])).rows[0]?.status,'published');
    assert.equal(await processPublication(new PublicationQueue(pool),vault,publisher),false);assert.equal(published.length,8);
  } finally {await db.close();}
});
