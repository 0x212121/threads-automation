import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { PublicationQueue } from '../src/publication-queue.js';
import { processPublication } from '../src/publication-worker.js';
import { ThreadsPublisher } from '../src/threads-publisher.js';
import { TokenVault } from '../src/token-vault.js';

test('worker menerbitkan satu kali dan tidak mengulang hasil yang tidak pasti', async () => {
  const db = new PGlite();
  for (const name of ['001_content.sql','002_local_identity.sql','007_threads_accounts.sql','013_token_refresh.sql','009_publication_jobs.sql','011_publication_diagnostics.sql','012_media.sql','014_carousel.sql','015_thread_replies.sql','016_publication_reference_repairs.sql','017_publication_failure_details.sql']) await db.exec(await readFile(`db/migrations/${name}`, 'utf8'));
  const query = async (text: string, params?: unknown[]) => { const result = await db.query(text, params); return { ...result, rowCount: result.rows.length }; };
  const pool = { query, connect: async () => ({ query, release: () => {} }) } as unknown as Pool;
  const user='11111111-1111-4111-8111-111111111111', account='22222222-2222-4222-8222-222222222222';
  const vault = new TokenVault(Buffer.alloc(32,7));
  const sealed = vault.seal('token-test', `${account}:123`);
  await db.query("INSERT INTO local_users (id,email,password_hash,role,email_verified_at) VALUES ($1,'admin@example.test','hash','admin',now())", [user]);
  await db.query("INSERT INTO threads_accounts (id,threads_user_id,username,connected_by,encrypted_token,token_iv,token_tag,token_expires_at,status) VALUES ($1,'123','akun',$2,$3,$4,$5,now()+interval '1 day','active')", [account,user,sealed.ciphertext,sealed.iv,sealed.tag]);
  async function addPost(post: string, job: string, review: string) {
    await db.exec('BEGIN');
    await db.query("INSERT INTO content_posts(id,created_by,status,current_version) VALUES ($1,$2,'approved',1)", [post,user]);
    await db.query("INSERT INTO content_versions(post_id,version,body,destination_account_id,created_by) VALUES ($1,1,'teks',$2,$3)", [post,account,user]);
    await db.exec('COMMIT');
    await db.query("INSERT INTO content_reviews(id,post_id,content_version,reviewer_id,decision) VALUES ($1,$2,1,$3,'approved')", [review,post,user]);
    await db.query("INSERT INTO publication_jobs(id,post_id,content_version,account_id,requested_by,scheduled_at,time_zone,next_attempt_at,status) VALUES ($1,$2,1,$3,$4,now()-interval '1 minute','UTC',now(),'scheduled')", [job,post,account,user]);
  }
  await addPost('33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555');
  let calls=0;
  const ok = new ThreadsPublisher((async (input:string|URL|Request) => {
    calls++; const url=new URL(String(input));
    return url.searchParams.get('fields')==='status' ? Response.json({status:'FINISHED'}) : Response.json({id:url.pathname==='/me/threads' ? '12345' : '67890'});
  }) as typeof fetch);
  const queue = new PublicationQueue(pool);
  assert.equal(await processPublication(queue,vault,ok), true);
  const ready=(await db.query<{status:string;delay:number;lease_token:string|null}>("SELECT status,extract(epoch from (next_attempt_at-updated_at))::int AS delay,lease_token FROM publication_jobs")).rows[0];
  assert.deepEqual(ready,{status:'prepared',delay:30,lease_token:null});assert.equal(calls,1);
  assert.equal(await processPublication(queue,vault,ok),false);
  await db.query('UPDATE publication_jobs SET next_attempt_at=now()');
  assert.equal(await processPublication(new PublicationQueue(pool),vault,ok),true);
  assert.equal((await db.query<{ status: string }>('SELECT status FROM publication_jobs')).rows[0]?.status,'published');
  assert.equal(await processPublication(queue,vault,ok), false); assert.equal(calls,3);
  await addPost('66666666-6666-4666-8666-666666666666','77777777-7777-4777-8777-777777777777','88888888-8888-4888-8888-888888888888');
  let errorCalls=0;
  const uncertain = new ThreadsPublisher((async (input:string|URL|Request) => {
    errorCalls++; const url=new URL(String(input));
    if (url.searchParams.get('fields')==='status') return Response.json({status:'FINISHED'});
    if (url.pathname==='/me/threads') return Response.json({id:'12346'});
    throw new Error('timeout token-test');
  }) as typeof fetch);
  assert.equal(await processPublication(queue,vault,uncertain), true);
  await db.query("UPDATE publication_jobs SET next_attempt_at=now() WHERE id='77777777-7777-4777-8777-777777777777'");
  const warnings:string[]=[],warn=console.warn;
  try {console.warn=(value?:unknown)=>{warnings.push(String(value));};await processPublication(queue,vault,uncertain);} finally {console.warn=warn;}
  assert.equal((await db.query<{ status: string }>("SELECT status FROM publication_jobs WHERE id='77777777-7777-4777-8777-777777777777'")).rows[0]?.status,'uncertain');
  assert.equal(await processPublication(queue,vault,uncertain), false); assert.equal(errorCalls,3);
  assert.deepEqual(JSON.parse(warnings[0]!),{event:'threads_publish_uncertain',jobId:'77777777-7777-4777-8777-777777777777',part:1,reason:'transport',httpStatus:null,metaCode:null,metaSubcode:null});
  assert.doesNotMatch(warnings.join(''),/token-test/);
  assert.equal((await db.query<{failure_reason:string}>("SELECT failure_reason FROM publication_attempts WHERE job_id='77777777-7777-4777-8777-777777777777' AND outcome='uncertain'")).rows[0]?.failure_reason,'transport');
  await addPost('99999999-9999-4999-8999-999999999999','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  const transient = new ThreadsPublisher((async () => new Response('', { status: 503 })) as typeof fetch);
  assert.equal(await processPublication(queue,vault,transient), true);
  const retry = await db.query<{ status: string; delay: number }>("SELECT status, extract(epoch from (next_attempt_at-updated_at))::int AS delay FROM publication_jobs WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'");
  assert.equal(retry.rows[0]?.status, 'scheduled'); assert.equal(retry.rows[0]?.delay, 30);
  await db.query("UPDATE publication_jobs SET next_attempt_at=now() WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'");
  assert.equal(await processPublication(queue,vault,transient), true);
  const second = await db.query<{ delay: number }>("SELECT extract(epoch from (next_attempt_at-updated_at))::int AS delay FROM publication_jobs WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'");
  assert.equal(second.rows[0]?.delay, 60);
  await db.query("UPDATE publication_jobs SET next_attempt_at=now() WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'");
  const permanent = new ThreadsPublisher((async () => new Response('', { status: 400 })) as typeof fetch);
  assert.equal(await processPublication(queue,vault,permanent), true);
  const failed = (await db.query<{ status: string; failure_code: string }>("SELECT status,failure_code FROM publication_jobs WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'")).rows[0];
  assert.equal(failed?.status, 'needs_action'); assert.equal(failed?.failure_code, 'meta_rejected');
  await db.close();
});
