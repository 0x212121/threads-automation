import type { Pool } from 'pg';
import { TokenVault } from './token-vault.js';
import { threadsPostKey } from './threads-post-url.js';

type Candidate={permalink:string;timestamp:string;localTime:string;matchesText:boolean;matchesMedia:boolean;matchesRecordedId:boolean};
type Result={status:string;timeZone?:string;from?:string;until?:string;recordedPublishedAt?:string;scanned?:number;complete?:boolean;candidates?:Candidate[];httpStatus?:number;metaCode?:number|null};
type Snapshot={account_id:string;threads_user_id:string;encrypted_token:Buffer;token_iv:Buffer;token_tag:Buffer;body:string;media_count:number;media_kind:string|null;time_zone:string;first_started_at:Date|null;first_published_at:Date|null;published_id:string|null};
const normalize=(value:string)=>value.replace(/\r\n/g,'\n').trim();

// Read-only operator search. Matching posts are candidates, never an automatic publication decision.
export async function findFirstPostCandidates(pool:Pool,vault:TokenVault,jobId:string,request:typeof fetch=fetch):Promise<Result> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) return {status:'invalid_job'};
  try {
    const result=await pool.query<Snapshot>(`SELECT a.id AS account_id,a.threads_user_id,a.encrypted_token,a.token_iv,a.token_tag,j.time_zone,v.body,m.kind AS media_kind,pp.published_id,
      (SELECT count(*)::int FROM content_version_media cm WHERE cm.post_id=v.post_id AND cm.version=v.version) AS media_count,
      (SELECT min(created_at) FROM publication_attempts WHERE job_id=j.id AND stage='prepare' AND outcome='started') AS first_started_at,
      (SELECT min(created_at) FROM publication_attempts WHERE job_id=j.id AND stage='publish' AND outcome='succeeded') AS first_published_at
      FROM publication_jobs j JOIN content_versions v ON v.post_id=j.post_id AND v.version=j.content_version
      JOIN threads_accounts a ON a.id=j.account_id LEFT JOIN media_assets m ON m.id=v.media_id
      LEFT JOIN publication_parts pp ON pp.job_id=j.id AND pp.position=0
      WHERE j.id=$1 AND a.status='active'`,[jobId]);
    const row=result.rows[0];if (!row) return {status:'job_or_account_unavailable'};
    if (!row.first_started_at || !row.first_published_at) return {status:'recorded_time_unavailable'};
    const started=new Date(row.first_started_at).getTime(),published=new Date(row.first_published_at).getTime();
    if (!Number.isFinite(started) || !Number.isFinite(published) || started>published || published-started>65*60*1000) return {status:'recorded_time_unavailable'};
    const from=started-5*60*1000,until=published+5*60*1000;
    const format=new Intl.DateTimeFormat('sv-SE',{timeZone:row.time_zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
    const summary={timeZone:row.time_zone,from:new Date(from).toISOString(),until:new Date(until).toISOString(),recordedPublishedAt:new Date(published).toISOString()};
    const token=vault.open({ciphertext:row.encrypted_token,iv:row.token_iv,tag:row.token_tag},`${row.account_id}:${row.threads_user_id}`);
    const get=async(url:URL)=>{
      const response=await request(url.toString(),{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(10000)});
      let body:unknown=null;try {body=await response.json();} catch {}
      return {status:response.status,body};
    };
    const me=await get(new URL('https://graph.threads.net/me?fields=id'));
    if (me.status!==200 || !me.body || typeof me.body!=='object' || !('id' in me.body) || me.body.id!==row.threads_user_id) return {status:'identity_not_verified',...summary};
    const candidates:Candidate[]=[],seenIds=new Set<string>(),cursors=new Set<string>();
    const expectedMedia=row.media_count>1?'CAROUSEL_ALBUM':row.media_kind ?? 'TEXT_POST';
    let after:string|undefined,scanned=0,complete=false;
    for (let page=0;page<5;page++) {
      const url=new URL('https://graph.threads.net/me/threads');
      url.search=new URLSearchParams({fields:'id,permalink,text,timestamp,media_type',limit:'50',since:String(Math.floor(from/1000)),until:String(Math.ceil(until/1000)),...(after?{after}:{})}).toString();
      const response=await get(url);
      if (response.status!==200) {
        const error=response.body && typeof response.body==='object' && 'error' in response.body ? response.body.error : null;
        const metaCode=error && typeof error==='object' && 'code' in error && typeof error.code==='number' && Number.isSafeInteger(error.code) ? error.code : null;
        return {status:'listing_failed',...summary,scanned,complete:false,candidates,httpStatus:response.status,metaCode};
      }
      if (!response.body || typeof response.body!=='object' || !('data' in response.body) || !Array.isArray(response.body.data)) return {status:'listing_unexpected',...summary,scanned,complete:false,candidates};
      const items=response.body.data;scanned+=items.length;
      for (const item of items) {
        if (!item || typeof item!=='object' || typeof item.id!=='string' || !/^[0-9]{1,30}$/.test(item.id) || typeof item.permalink!=='string' || !threadsPostKey(item.permalink) || typeof item.timestamp!=='string' || seenIds.has(item.id)) continue;
        const time=Date.parse(item.timestamp);if (!Number.isFinite(time) || time<from || time>until) continue;
        seenIds.add(item.id);
        const permalink=new URL(item.permalink);permalink.search='';permalink.hash='';
        candidates.push({permalink:permalink.toString(),timestamp:new Date(time).toISOString(),localTime:format.format(new Date(time)),matchesText:normalize(typeof item.text==='string'?item.text:'')===normalize(row.body),matchesMedia:item.media_type===expectedMedia,matchesRecordedId:item.id===row.published_id});
        if (candidates.length>=20) break;
      }
      if (candidates.length>=20) break;
      const paging='paging' in response.body?response.body.paging:null;
      const cursor=paging && typeof paging==='object' && 'cursors' in paging?paging.cursors:null;
      const next=cursor && typeof cursor==='object' && 'after' in cursor?cursor.after:null;
      if (!items.length || next===null || next===undefined || next==='') {complete=true;break;}
      if (typeof next!=='string' || next.length>2048 || cursors.has(next)) break;
      cursors.add(next);after=next;
    }
    candidates.sort((a,b)=>Math.abs(Date.parse(a.timestamp)-published)-Math.abs(Date.parse(b.timestamp)-published));
    return {status:'ok',...summary,scanned,complete,candidates};
  } catch {return {status:'search_unavailable'};}
}
