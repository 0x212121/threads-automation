import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { TokenVault } from '../src/token-vault.js';
import { findFirstPostCandidates } from '../src/threads-first-post-search.js';

test('pencarian pertama memakai waktu pekerjaan dan menampilkan kandidat tanpa isi, token atau perubahan data',async()=>{
  const vault=new TokenVault(Buffer.alloc(32,7)),account='11111111-1111-4111-8111-111111111111',job='22222222-2222-4222-8222-222222222222',sealed=vault.seal('token-rahasia',`${account}:123`);
  const row={account_id:account,threads_user_id:'123',encrypted_token:sealed.ciphertext,token_iv:sealed.iv,token_tag:sealed.tag,body:'isi rahasia',media_count:0,media_kind:null,time_zone:'Asia/Makassar',first_started_at:new Date('2026-11-05T14:27:33.972Z'),first_published_at:new Date('2026-11-05T14:27:41.679Z'),published_id:'456'};
  const pool={query:async(sql:string)=>{assert.match(sql,/^SELECT/);return {rows:[row]};}} as unknown as Pool;
  let listings=0;
  const fetcher=(async(input:string|URL|Request,init?:RequestInit)=>{
    const url=new URL(String(input));assert.equal(url.origin,'https://graph.threads.net');assert.equal(init?.method,undefined);assert.equal(new Headers(init?.headers).get('authorization'),'Bearer token-rahasia');assert.equal(url.toString().includes('token-rahasia'),false);
    if (url.pathname==='/me') return Response.json({id:'123'});
    assert.equal(url.pathname,'/me/threads');assert.equal(url.searchParams.get('since'),String(Math.floor(Date.parse('2026-11-05T14:22:33.972Z')/1000)));assert.equal(url.searchParams.get('until'),String(Math.ceil(Date.parse('2026-11-05T14:32:41.679Z')/1000)));
    listings++;
    if (listings===1) return Response.json({data:[
      {id:'999',permalink:'https://www.threads.com/@test/post/Later',timestamp:'2026-11-05T14:54:21Z',text:'isi rahasia',media_type:'TEXT_POST'},
      {id:'456',permalink:'https://www.threads.com/@test/post/Other?tracking=1',timestamp:'2026-11-05T14:26:00Z',text:'other',media_type:'IMAGE'},
      {id:'555',permalink:'https://attacker.invalid/post/Fake',timestamp:'2026-11-05T14:27:40Z',text:'isi rahasia',media_type:'TEXT_POST'}
    ],paging:{next:'https://attacker.invalid/?token=token-rahasia',cursors:{after:'safe-cursor'}}});
    assert.equal(url.searchParams.get('after'),'safe-cursor');
    return Response.json({data:[
      {id:'789',permalink:'https://www.threads.com/@test/post/Original',timestamp:'2026-11-05T14:27:40Z',text:'isi rahasia',media_type:'TEXT_POST'},
      {id:'789',permalink:'https://www.threads.com/@test/post/Original',timestamp:'2026-11-05T14:27:40Z',text:'isi rahasia',media_type:'TEXT_POST'}
    ]});
  }) as typeof fetch;
  const result=await findFirstPostCandidates(pool,vault,job,fetcher);
  assert.equal(result.status,'ok');assert.equal(result.complete,true);assert.equal(result.scanned,5);assert.equal(result.timeZone,'Asia/Makassar');
  assert.deepEqual(result.candidates,[
    {permalink:'https://www.threads.com/@test/post/Original',timestamp:'2026-11-05T14:27:40.000Z',localTime:'2026-11-05 22:27:40',matchesText:true,matchesMedia:true,matchesRecordedId:false},
    {permalink:'https://www.threads.com/@test/post/Other',timestamp:'2026-11-05T14:26:00.000Z',localTime:'2026-11-05 22:26:00',matchesText:false,matchesMedia:false,matchesRecordedId:true}
  ]);
  assert.doesNotMatch(JSON.stringify(result),/rahasia|attacker|Later|789|tracking/);
  assert.equal((await findFirstPostCandidates(pool,vault,job,(async()=>Response.json({id:'different'})) as typeof fetch)).status,'identity_not_verified');
  const failed=await findFirstPostCandidates(pool,vault,job,(async(input:string|URL|Request)=>new URL(String(input)).pathname==='/me'?Response.json({id:'123'}):Response.json({error:{code:1,message:'token-rahasia'}},{status:503})) as typeof fetch);
  assert.equal(failed.status,'listing_failed');assert.equal(failed.metaCode,1);assert.equal(failed.complete,false);assert.doesNotMatch(JSON.stringify(failed),/rahasia/);
});
