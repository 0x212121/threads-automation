import type { Pool } from 'pg';
import { TokenVault } from './token-vault.js';

// A manually supplied ID must belong to this account and the approved part. Never follow provider paging URLs.
export async function verifyPublishedPart(pool: Pool, vault: TokenVault, actorId: string, postId: string, jobId: string, publishedId: string, request: typeof fetch = fetch): Promise<boolean> {
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!/^[0-9]{1,30}$/.test(publishedId) || !uuid.test(postId) || !uuid.test(jobId) || !uuid.test(actorId)) return false;
  const result = await pool.query<{account_id:string;threads_user_id:string;username:string;encrypted_token:Buffer;token_iv:Buffer;token_tag:Buffer;body:string;part_index:number;reply_to_id:string|null}>(`SELECT a.id AS account_id,a.threads_user_id,a.username,a.encrypted_token,a.token_iv,a.token_tag,j.part_index,j.reply_to_id,
    CASE WHEN j.part_index=0 THEN v.body ELSE r.body END AS body
    FROM publication_jobs j JOIN content_posts p ON p.id=j.post_id
    JOIN content_versions v ON v.post_id=j.post_id AND v.version=j.content_version
    LEFT JOIN content_version_replies r ON r.post_id=v.post_id AND r.version=v.version AND r.position=j.part_index
    JOIN threads_accounts a ON a.id=j.account_id JOIN local_users u ON u.id=$3
    WHERE j.id=$1 AND j.post_id=$2 AND j.status='uncertain' AND a.status='active' AND a.token_expires_at>now()
      AND u.disabled_at IS NULL AND (p.created_by=u.id OR u.role IN ('admin','reviewer'))`,[jobId,postId,actorId]);
  const row=result.rows[0]; if (!row || typeof row.body !== 'string') return false;
  try {
    const token=vault.open({ciphertext:row.encrypted_token,iv:row.token_iv,tag:row.token_tag},`${row.account_id}:${row.threads_user_id}`);
    const url=new URL(row.part_index===0 ? 'https://graph.threads.net/me/threads' : 'https://graph.threads.net/me/replies');
    url.searchParams.set('fields',row.part_index===0 ? 'id,text,owner' : 'id,text,username,replied_to');
    url.searchParams.set('limit','50');
    const response=await request(url.toString(),{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(10000)});
    if (!response.ok) return false;
    const data:unknown=await response.json();
    if (!data || typeof data!=='object' || !('data' in data) || !Array.isArray(data.data)) return false;
    return data.data.some((item:unknown) => {
      if (!item || typeof item!=='object' || !('id' in item) || item.id!==publishedId || ('text' in item ? item.text : '')!==row.body) return false;
      if (row.part_index===0) return 'owner' in item && !!item.owner && typeof item.owner==='object' && 'id' in item.owner && item.owner.id===row.threads_user_id;
      return 'username' in item && typeof item.username==='string' && item.username.toLowerCase()===row.username.toLowerCase() && 'replied_to' in item && !!item.replied_to && typeof item.replied_to==='object' && 'id' in item.replied_to && item.replied_to.id===row.reply_to_id;
    });
  } catch { return false; }
}
