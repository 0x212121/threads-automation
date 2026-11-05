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
function subcode(body:unknown): number|null {
  if (!body || typeof body!=='object' || !('error' in body) || !body.error || typeof body.error!=='object' || !('error_subcode' in body.error)) return null;
  return typeof body.error.error_subcode==='number' && Number.isSafeInteger(body.error.error_subcode) ? body.error.error_subcode : null;
}
type LinkLookup = { status:string; scanned?:number; recordedIdMatches?:boolean; matchedPostReadable?:boolean; httpStatus?:number; metaCode?:number|null; metaSubcode?:number|null };
function postKey(value:string):string|null {
  try {
    const url=new URL(value);
    if (url.protocol!=='https:' || url.username || url.password || url.port || !['threads.com','www.threads.com','threads.net','www.threads.net'].includes(url.hostname)) return null;
    return /^\/(?:@[^/]+\/post|t)\/([A-Za-z0-9_-]+)\/?$/.exec(decodeURIComponent(url.pathname))?.[1] ?? null;
  } catch {return null;}
}
async function compareParentLink(request:typeof fetch, init:RequestInit, recordedId:string, link:string):Promise<LinkLookup> {
  const key=postKey(link); if (!key) return {status:'invalid_post_url'};
  let after:string|undefined,scanned=0;
  const cursors=new Set<string>();
  for (let page=0;page<5;page++) {
    const url=new URL('https://graph.threads.net/me/threads');
    url.search=new URLSearchParams({fields:'id,permalink',limit:'50',...(after ? {after} : {})}).toString();
    const response=await requestJson(request,url,init);
    if (response.status<200 || response.status>=300) return {status:'listing_failed',scanned,httpStatus:response.status,metaCode:code(response.body),metaSubcode:subcode(response.body)};
    if (!response.body || typeof response.body!=='object' || !('data' in response.body) || !Array.isArray(response.body.data)) return {status:'listing_unexpected',scanned};
    const items=response.body.data; scanned+=items.length;
    const matches=items.filter((item:unknown):item is {id:string;permalink:string}=>!!item && typeof item==='object' && 'id' in item && typeof item.id==='string' && /^[0-9]{1,30}$/.test(item.id) && 'permalink' in item && typeof item.permalink==='string' && postKey(item.permalink)===key);
    if (matches.length>1) return {status:'ambiguous',scanned};
    if (matches[0]) {
      const target=new URL(`https://graph.threads.net/${matches[0].id}`); target.searchParams.set('fields','id');
      const read=await requestJson(request,target,init);
      const matchedPostReadable=read.status>=200 && read.status<300 && !!read.body && typeof read.body==='object' && 'id' in read.body && read.body.id===matches[0].id;
      return {status:'matched',scanned,recordedIdMatches:recordedId===matches[0].id,matchedPostReadable,httpStatus:read.status,metaCode:code(read.body),metaSubcode:subcode(read.body)};
    }
    const paging='paging' in response.body ? response.body.paging : null;
    const cursor=paging && typeof paging==='object' && 'cursors' in paging ? paging.cursors : null;
    const next=cursor && typeof cursor==='object' && 'after' in cursor ? cursor.after : null;
    if (!items.length || typeof next!=='string' || !next || next.length>2048 || cursors.has(next)) return {status:'not_found_in_scanned_posts',scanned};
    cursors.add(next); after=next;
  }
  return {status:'not_found_in_scanned_posts',scanned};
}

export async function diagnoseReplyTarget(pool: Pool, vault: TokenVault, jobId:string, request:typeof fetch=fetch, parentUrl?:string): Promise<{status:string;part?:number;jobStatus?:string;parentMatchesHistory?:boolean;identityMatches?:boolean;parentReadable?:boolean;httpStatus?:number;metaCode?:number|null;metaSubcode?:number|null;permalinkLookup?:LinkLookup}> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) return {status:'invalid_job'};
  if (parentUrl!==undefined && !postKey(parentUrl)) return {status:'invalid_post_url'};
  try {
    const result=await pool.query<Omit<Account,'id'> & {account_id:string;part_index:number;job_status:string;reply_to_id:string|null;previous_published_id:string|null}>(`SELECT a.id AS account_id,a.username,a.threads_user_id,a.encrypted_token,a.token_iv,a.token_tag,
      j.part_index,j.status AS job_status,j.reply_to_id,pp.published_id AS previous_published_id
      FROM publication_jobs j JOIN threads_accounts a ON a.id=j.account_id
      LEFT JOIN publication_parts pp ON pp.job_id=j.id AND pp.position=j.part_index-1 AND pp.status='published'
      WHERE j.id=$1 AND a.status='active'`,[jobId]);
    const row=result.rows[0]; if (!row) return {status:'job_or_account_unavailable'};
    const summary={part:row.part_index+1,jobStatus:row.job_status,parentMatchesHistory:!!row.reply_to_id && row.reply_to_id===row.previous_published_id};
    if (!row.reply_to_id || !/^[0-9]+$/.test(row.reply_to_id)) return {status:'no_reply_target',...summary};
    const token=vault.open({ciphertext:row.encrypted_token,iv:row.token_iv,tag:row.token_tag},`${row.account_id}:${row.threads_user_id}`);
    const init={headers:{Authorization:`Bearer ${token}`}};
    const me=await requestJson(request,new URL('https://graph.threads.net/me?fields=id'),init);
    if (me.status<200 || me.status>=300) return {status:'identity_check_failed',...summary,httpStatus:me.status,metaCode:code(me.body),metaSubcode:subcode(me.body)};
    if (!me.body || typeof me.body!=='object' || !('id' in me.body) || typeof me.body.id!=='string') return {status:'identity_response_unexpected',...summary};
    const identityMatches=me.body.id===row.threads_user_id;
    if (!identityMatches) return {status:'identity_mismatch',...summary,identityMatches:false};
    const url=new URL(`https://graph.threads.net/${row.reply_to_id}`); url.searchParams.set('fields','id');
    const target=await requestJson(request,url,init);
    const parentReadable=target.status>=200 && target.status<300 && !!target.body && typeof target.body==='object' && 'id' in target.body && target.body.id===row.reply_to_id;
    const permalinkLookup=parentUrl ? await compareParentLink(request,init,row.reply_to_id,parentUrl) : undefined;
    return {status:'ok',...summary,identityMatches,parentReadable,httpStatus:target.status,metaCode:code(target.body),metaSubcode:subcode(target.body),...(permalinkLookup ? {permalinkLookup} : {})};
  } catch {return {status:'diagnostic_unavailable'};}
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
