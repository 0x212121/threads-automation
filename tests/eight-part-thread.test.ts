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

test('delapan bagian memakai ID publikasi sebelumnya dan pulih setelah target tertunda serta restart worker',async()=>{
  const db=new PGlite();
  try {
    for (const file of ['001_content.sql','002_local_identity.sql','007_threads_accounts.sql','009_publication_jobs.sql','010_publication_resolutions.sql','011_publication_diagnostics.sql','012_media.sql','014_carousel.sql','015_thread_replies.sql','016_publication_reference_repairs.sql']) await db.exec(await readFile(`db/migrations/${file}`,'utf8'));
    const query=async(sql:string,params?:unknown[])=>{const r=await db.query(sql,params);return {...r,rowCount:r.rows.length || r.affectedRows || 0};};
    const pool={query,connect:async()=>({query,release:()=>{}})} as unknown as Pool;
    const user='11111111-1111-4111-8111-111111111111',account='22222222-2222-4222-8222-222222222222',vault=new TokenVault(Buffer.alloc(32,7)),sealed=vault.seal('token-test',`${account}:123`);
    await query("INSERT INTO local_users(id,email,password_hash,role,email_verified_at) VALUES ($1,'admin@example.test','hash','admin',now())",[user]);
    await query("INSERT INTO threads_accounts(id,threads_user_id,username,connected_by,encrypted_token,token_iv,token_tag,token_expires_at,status) VALUES ($1,'123','test',$2,$3,$4,$5,now()+interval '1 day','active')",[account,user,sealed.ciphertext,sealed.iv,sealed.tag]);
    const parts=Array.from({length:8},(_,i)=>`Bagian ${i+1}`),store=new ContentStore(pool),actor={id:user,role:'admin'} as const;
    const post=await store.create(actor,{body:parts[0]!,replies:parts.slice(1),destinationAccountId:account});
    await store.transition(actor,post.id,1,'submit');await store.transition(actor,post.id,2,'approve');
    const job=await new PublicationRequests(pool).publishNow(user,post.id,3,'Asia/Makassar');
    const published:string[]=[],containers:string[]=[],targets:string[]=[],readCounts=new Map<string,number>();
    const publisher=new ThreadsPublisher((async(input:string|URL|Request)=>{
      const url=new URL(String(input));
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
      const id=`1900000000000000${published.length+1}`;published.push(id);return Response.json({id});
    }) as typeof fetch);
    const warn=console.warn;
    try {
      console.warn=()=>{};
      for (let step=0;step<30;step++) {
        const state=(await db.query<{status:string}>('SELECT status FROM publication_jobs WHERE id=$1',[job.id])).rows[0]!.status;
        if (state==='published') break;
        assert.ok(['scheduled','preparing','prepared'].includes(state),state);
        await query('UPDATE publication_jobs SET next_attempt_at=now() WHERE id=$1',[job.id]);
        assert.equal(await processPublication(new PublicationQueue(pool),vault,publisher),true);
      }
    } finally {console.warn=warn;}
    assert.equal(published.length,8);assert.equal(containers.length,8);assert.deepEqual(targets,published.slice(0,7));
    const rows=(await db.query<{position:number;status:string;published_id:string;provider_response_id:string;container_id:string}>('SELECT position,status,published_id,provider_response_id,container_id FROM publication_parts WHERE job_id=$1 ORDER BY position',[job.id])).rows;
    assert.equal(rows.length,8);rows.forEach((row,index)=>{assert.equal(row.position,index);assert.equal(row.status,'published');assert.equal(row.published_id,published[index]);assert.equal(row.provider_response_id,published[index]);assert.equal(row.container_id,containers[index]);});
    assert.equal((await db.query<{status:string}>('SELECT status FROM publication_jobs WHERE id=$1',[job.id])).rows[0]?.status,'published');
    assert.equal(await processPublication(new PublicationQueue(pool),vault,publisher),false);assert.equal(published.length,8);
  } finally {await db.close();}
});
