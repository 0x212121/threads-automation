import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { TokenVault } from './token-vault.js';
import { threadsPostKey } from './threads-post-url.js';

type Snapshot = { post_id:string; account_id:string; content_version:number; reply_to_id:string; revision:number; encrypted_token:Buffer; token_iv:Buffer; token_tag:Buffer; threads_user_id:string; body:string; media_count:number; media_kind:string|null; first_started_at:Date|null; first_published_at:Date|null };
type Result={status:string;part?:number;recordedStartedAt?:string;recordedPublishedAt?:string;threadsTimestamp?:string;differenceSeconds?:number;toleranceSeconds?:number};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id=/^[0-9]{1,30}$/;
const normalize=(text:string)=>text.replace(/\r\n/g,'\n').trim();

// Server-operator recovery only. Never publish or infer a replacement from text alone.
export async function repairFirstReplyTarget(pool:Pool,vault:TokenVault,jobId:string,parentUrl:string,apply=false,request:typeof fetch=fetch):Promise<Result> {
  const key=threadsPostKey(parentUrl);
  if (!uuid.test(jobId) || !key) return {status:'invalid_arguments'};
  try {
    const snapshot=await pool.query<Snapshot>(`SELECT j.post_id,j.account_id,j.content_version,j.reply_to_id,p.revision,a.encrypted_token,a.token_iv,a.token_tag,a.threads_user_id,v.body,
      (SELECT count(*)::int FROM content_version_media cm WHERE cm.post_id=v.post_id AND cm.version=v.version) AS media_count,m.kind AS media_kind,
      (SELECT min(created_at) FROM publication_attempts WHERE job_id=j.id AND stage='prepare' AND outcome='started') AS first_started_at,
      (SELECT min(created_at) FROM publication_attempts WHERE job_id=j.id AND stage='publish' AND outcome='succeeded') AS first_published_at
      FROM publication_jobs j JOIN content_posts p ON p.id=j.post_id
      JOIN content_versions v ON v.post_id=p.id AND v.version=p.current_version
      LEFT JOIN media_assets m ON m.id=v.media_id JOIN threads_accounts a ON a.id=j.account_id
      JOIN publication_parts pp ON pp.job_id=j.id AND pp.position=0 AND pp.status='published' AND pp.published_id=j.reply_to_id
      WHERE j.id=$1 AND j.status='needs_action' AND j.part_index=1 AND j.lease_token IS NULL
        AND p.status='approved' AND p.current_version=j.content_version AND v.destination_account_id=j.account_id
        AND a.status='active' AND a.token_expires_at>now()
        AND EXISTS (SELECT 1 FROM content_reviews WHERE post_id=p.id AND content_version=p.current_version AND decision='approved')
        AND NOT EXISTS (SELECT 1 FROM publication_parts WHERE job_id=j.id AND position>0 AND status<>'not_published')`,[jobId]);
    const original=snapshot.rows[0]; if (!original || !original.first_started_at || !original.first_published_at || !id.test(original.reply_to_id)) return {status:'not_repairable'};
    const token=vault.open({ciphertext:original.encrypted_token,iv:original.token_iv,tag:original.token_tag},`${original.account_id}:${original.threads_user_id}`);
    const get=async(url:URL)=>{
      const response=await request(url.toString(),{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(10000)});
      let body:unknown=null; try {body=await response.json();} catch {}
      return {status:response.status,body};
    };
    const me=await get(new URL('https://graph.threads.net/me?fields=id,username'));
    if (me.status!==200 || !me.body || typeof me.body!=='object' || !('id' in me.body) || me.body.id!==original.threads_user_id || !('username' in me.body) || typeof me.body.username!=='string') return {status:'identity_not_verified'};
    const username=me.body.username;
    let after:string|undefined,matched:Record<string,unknown>|null=null;
    const cursors=new Set<string>();
    for (let page=0;page<5;page++) {
      const url=new URL('https://graph.threads.net/me/threads');
      url.search=new URLSearchParams({fields:'id,permalink,text,timestamp,username,media_type',limit:'50',...(after ? {after} : {})}).toString();
      const response=await get(url);
      if (response.status!==200 || !response.body || typeof response.body!=='object' || !('data' in response.body) || !Array.isArray(response.body.data)) return {status:'post_listing_unavailable'};
      const matches=response.body.data.filter((item:unknown):item is Record<string,unknown>=>!!item && typeof item==='object' && 'permalink' in item && typeof item.permalink==='string' && threadsPostKey(item.permalink)===key);
      if (matches.length>1) return {status:'ambiguous_post'};
      if (matches[0]) {matched=matches[0]; break;}
      const paging='paging' in response.body ? response.body.paging : null;
      const cursor=paging && typeof paging==='object' && 'cursors' in paging ? paging.cursors : null;
      const next=cursor && typeof cursor==='object' && 'after' in cursor ? cursor.after : null;
      if (!response.body.data.length || typeof next!=='string' || !next || next.length>2048 || cursors.has(next)) break;
      cursors.add(next); after=next;
    }
    if (!matched || typeof matched.id!=='string' || !id.test(matched.id)) return {status:'post_not_found_in_scanned_posts'};
    const target=new URL(`https://graph.threads.net/${matched.id}`); target.searchParams.set('fields','id,permalink,text,timestamp,username,media_type');
    const read=await get(target);
    const post=read.body;
    if (read.status!==200 || !post || typeof post!=='object' || !('id' in post) || post.id!==matched.id || !('permalink' in post) || typeof post.permalink!=='string' || threadsPostKey(post.permalink)!==key || !('username' in post) || typeof post.username!=='string' || post.username.toLowerCase()!==username.toLowerCase()) return {status:'post_not_verified'};
    if (normalize('text' in post && typeof post.text==='string' ? post.text : '')!==normalize(original.body)) return {status:'content_mismatch'};
    const expectedMedia=original.media_count>1 ? 'CAROUSEL_ALBUM' : original.media_kind ?? 'TEXT_POST';
    if (!('media_type' in post) || post.media_type!==expectedMedia) return {status:'media_type_mismatch'};
    const publishedAt='timestamp' in post && typeof post.timestamp==='string' ? Date.parse(post.timestamp) : NaN;
    if (!Number.isFinite(publishedAt)) return {status:'provider_timestamp_unavailable'};
    const startedAt=new Date(original.first_started_at).getTime(), finishedAt=new Date(original.first_published_at).getTime();
    if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || startedAt>finishedAt) return {status:'recorded_timestamp_unavailable'};
    const tolerance=5*60*1000;
    if (publishedAt<startedAt-tolerance || publishedAt>finishedAt+tolerance) return {status:'publication_time_mismatch',recordedStartedAt:new Date(startedAt).toISOString(),recordedPublishedAt:new Date(finishedAt).toISOString(),threadsTimestamp:new Date(publishedAt).toISOString(),differenceSeconds:Math.round((publishedAt-finishedAt)/1000),toleranceSeconds:300};
    if (matched.id===original.reply_to_id) return {status:'already_correct',part:2};
    const oldUrl=new URL(`https://graph.threads.net/${original.reply_to_id}`); oldUrl.searchParams.set('fields','id');
    const old=await get(oldUrl);
    if (old.status>=200 && old.status<300) return {status:'recorded_target_still_readable'};
    if (![400,404].includes(old.status)) return {status:'recorded_target_check_unavailable'};
    if (!apply) return {status:'ready_to_repair',part:2};
    const permalink=new URL(post.permalink); permalink.search=''; permalink.hash='';
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const lockedPost=await client.query('SELECT id FROM content_posts WHERE id=$1 AND status=\'approved\' AND current_version=$2 AND revision=$3 FOR UPDATE',[original.post_id,original.content_version,original.revision]);
      const account=await client.query("SELECT id FROM threads_accounts WHERE id=$1 AND status='active' AND token_expires_at>now() AND token_iv=$2 FOR SHARE",[original.account_id,original.token_iv]);
      const job=await client.query(`SELECT id FROM publication_jobs WHERE id=$1 AND post_id=$2 AND account_id=$3 AND content_version=$4 AND status='needs_action'
        AND part_index=1 AND lease_token IS NULL AND reply_to_id=$5 FOR UPDATE`,[jobId,original.post_id,original.account_id,original.content_version,original.reply_to_id]);
      const root=await client.query("SELECT job_id FROM publication_parts WHERE job_id=$1 AND position=0 AND status='published' AND published_id=$2 FOR UPDATE",[jobId,original.reply_to_id]);
      const later=await client.query("SELECT job_id FROM publication_parts WHERE job_id=$1 AND position>0 AND status<>'not_published' FOR UPDATE",[jobId]);
      const approval=await client.query("SELECT id FROM content_reviews WHERE post_id=$1 AND content_version=$2 AND decision='approved' LIMIT 1",[original.post_id,original.content_version]);
      if (!lockedPost.rowCount || !account.rowCount || !job.rowCount || !root.rowCount || later.rowCount || !approval.rowCount) {await client.query('ROLLBACK'); return {status:'state_changed'};}
      await client.query('INSERT INTO publication_reference_repairs(id,job_id,position,previous_id,corrected_id,verified_permalink,source) VALUES ($1,$2,0,$3,$4,$5,\'server_cli\')',[randomUUID(),jobId,original.reply_to_id,matched.id,permalink.toString()]);
      await client.query('UPDATE publication_parts SET published_id=$2 WHERE job_id=$1 AND position=0',[jobId,matched.id]);
      await client.query('UPDATE publication_jobs SET reply_to_id=$2,container_id=NULL,updated_at=now() WHERE id=$1',[jobId,matched.id]);
      await client.query('COMMIT');
      return {status:'repaired',part:2};
    } catch {await client.query('ROLLBACK');return {status:'repair_unavailable'};}
    finally {client.release();}
  } catch {return {status:'verification_unavailable'};}
}
