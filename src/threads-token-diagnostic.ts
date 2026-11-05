import type { Pool } from 'pg';
import { TokenVault } from './token-vault.js';

const permissions = ['threads_basic','threads_content_publish','threads_manage_replies','threads_read_replies'] as const;
type Account = { id:string; username:string; threads_user_id:string; encrypted_token:Buffer; token_iv:Buffer; token_tag:Buffer };
type Result = { username:string; status:string; valid?:boolean; appMatches?:boolean|null; granted?:string[]; missing?:string[]; httpStatus?:number; metaCode?:number|null };

async function requestJson(request: typeof fetch, url: URL, init: RequestInit = {}): Promise<{status:number; body:unknown}> {
  const response=await request(url.toString(),{...init,redirect:'error',signal:AbortSignal.timeout(10000)});
  let body:unknown=null;
  try { body=await response.json(); } catch { /* Provider bodies are never printed. */ }
  return {status:response.status,body};
}
function code(body:unknown): number|null {
  if (!body || typeof body!=='object' || !('error' in body) || !body.error || typeof body.error!=='object' || !('code' in body.error)) return null;
  return typeof body.error.code==='number' && Number.isSafeInteger(body.error.code) ? body.error.code : null;
}

// Only fixed scope names and sanitized status information leave this function.
export async function diagnoseThreadsTokens(pool: Pool, vault: TokenVault, appId:string, appSecret:string, request:typeof fetch = fetch): Promise<{status:string; httpStatus?:number; metaCode?:number|null; accounts?:Result[]}> {
  if (!/^[0-9]+$/.test(appId) || !appSecret) return {status:'invalid_configuration'};
  try {
    const appUrl=new URL('https://graph.threads.net/oauth/access_token');
    appUrl.search=new URLSearchParams({grant_type:'client_credentials',client_id:appId,client_secret:appSecret}).toString();
    const app=await requestJson(request,appUrl);
    if (app.status<200 || app.status>=300 || !app.body || typeof app.body!=='object' || !('access_token' in app.body) || typeof app.body.access_token!=='string' || !app.body.access_token) return {status:'app_token_failed',httpStatus:app.status,metaCode:code(app.body)};
    const result=await pool.query<Account>("SELECT id,username,threads_user_id,encrypted_token,token_iv,token_tag FROM threads_accounts WHERE status='active' ORDER BY username,id");
    const accounts:Result[]=[];
    for (const account of result.rows) {
      try {
        const token=vault.open({ciphertext:account.encrypted_token,iv:account.token_iv,tag:account.token_tag},`${account.id}:${account.threads_user_id}`);
        const url=new URL('https://graph.threads.net/debug_token'); url.searchParams.set('input_token',token);
        const debug=await requestJson(request,url,{headers:{Authorization:`Bearer ${app.body.access_token}`}});
        if (debug.status<200 || debug.status>=300) { accounts.push({username:account.username,status:'debug_failed',httpStatus:debug.status,metaCode:code(debug.body)}); continue; }
        const data=debug.body && typeof debug.body==='object' && 'data' in debug.body ? debug.body.data : null;
        if (!data || typeof data!=='object' || !('is_valid' in data) || typeof data.is_valid!=='boolean' || !('scopes' in data) || !Array.isArray(data.scopes) || data.scopes.some((item:unknown)=>typeof item!=='string')) { accounts.push({username:account.username,status:'unexpected_response'}); continue; }
        const scopes:string[]=data.scopes;
        const granted=permissions.filter(scope=>scopes.includes(scope));
        const missing=permissions.filter(scope=>!scopes.includes(scope));
        const providerAppId='app_id' in data && (typeof data.app_id==='string' || (typeof data.app_id==='number' && Number.isSafeInteger(data.app_id))) ? String(data.app_id) : null;
        accounts.push({username:account.username,status:'ok',valid:data.is_valid,appMatches:providerAppId===null ? null : providerAppId===appId,granted,missing});
      } catch { accounts.push({username:account.username,status:'unreadable_or_unavailable'}); }
    }
    return {status:'ok',accounts};
  } catch { return {status:'diagnostic_unavailable'}; }
}
