import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { TokenVault } from '../src/token-vault.js';
import { diagnoseThreadsTokens } from '../src/threads-token-diagnostic.js';

test('diagnosis izin hanya mengembalikan scope yang dikenal tanpa membocorkan token atau respons Meta', async () => {
  const vault=new TokenVault(Buffer.alloc(32,4)), id='11111111-1111-4111-8111-111111111111';
  const sealed=vault.seal('user-token-rahasia',`${id}:123`);
  const pool={query:async()=>({rows:[{id,username:'akun',threads_user_id:'123',encrypted_token:sealed.ciphertext,token_iv:sealed.iv,token_tag:sealed.tag}]})} as unknown as Pool;
  const fetcher=(async (input:string|URL|Request,init?:RequestInit)=>{
    const url=new URL(String(input));
    if (url.pathname==='/oauth/access_token') { assert.equal(url.searchParams.get('grant_type'),'client_credentials'); return Response.json({access_token:'app-token-rahasia'}); }
    assert.equal(url.pathname,'/debug_token'); assert.equal(url.searchParams.get('input_token'),'user-token-rahasia');
    assert.equal(new Headers(init?.headers).get('authorization'),'Bearer app-token-rahasia');
    return Response.json({data:{is_valid:true,app_id:'1234',scopes:['threads_basic','threads_content_publish','threads_manage_replies','scope-asing'],message:'user-token-rahasia'}});
  }) as typeof fetch;
  const result=await diagnoseThreadsTokens(pool,vault,'1234','secret-rahasia',fetcher);
  assert.deepEqual(result,{status:'ok',accounts:[{username:'akun',status:'ok',valid:true,appMatches:true,granted:['threads_basic','threads_content_publish','threads_manage_replies'],missing:['threads_read_replies']}]});
  assert.doesNotMatch(JSON.stringify(result),/rahasia|scope-asing/);
  const rejected=await diagnoseThreadsTokens(pool,vault,'1234','secret-rahasia',(async ()=>Response.json({error:{code:10,message:'secret-rahasia'}},{status:403})) as typeof fetch);
  assert.deepEqual(rejected,{status:'app_token_failed',httpStatus:403,metaCode:10});
  assert.doesNotMatch(JSON.stringify(rejected),/rahasia/);
});
