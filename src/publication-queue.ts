import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

type Job = { id: string; post_id: string; content_version: number; account_id: string; requested_by: string; status: 'preparing' | 'prepared'; lease_token: string; container_id: string | null; part_index: number; reply_to_id: string | null };
export type PublicationPayload = { body: string; media_id: string | null; media_kind: 'IMAGE' | 'VIDEO' | null; threads_user_id: string; encrypted_token: Buffer; token_iv: Buffer; token_tag: Buffer };
export type PublicationFailure = {reason:'provider_rejected'|'invalid_response'|'transport'|'persistence';httpStatus?:number;metaCode?:number;metaSubcode?:number};

export class PublicationQueue {
  constructor(private readonly pool: Pool) {}
  private async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async recover(): Promise<void> {
    await this.transaction(async client => {
      const uncertain = await client.query<{ id: string }>("UPDATE publication_jobs SET status='uncertain', lease_token=NULL, lease_until=NULL, updated_at=now() WHERE status='publishing' AND lease_until <= now() RETURNING id");
      for (const row of uncertain.rows) { await client.query("UPDATE publication_parts SET status='uncertain' WHERE job_id=$1 AND status='publishing'",[row.id]); await client.query("INSERT INTO publication_attempts (id,job_id,stage,outcome) VALUES ($1,$2,'publish','uncertain')", [randomUUID(), row.id]); }
      await client.query("UPDATE publication_jobs SET status='needs_action', failure_code=COALESCE(failure_code,'deadline'), lease_token=NULL, lease_until=NULL, updated_at=now() WHERE status IN ('scheduled','preparing','prepared') AND scheduled_at + interval '1 hour' <= now() AND (lease_until IS NULL OR lease_until <= now())");
    });
  }

  async claim(): Promise<Job | null> {
    return this.transaction(async client => {
      const result = await client.query<{ id: string; status: string }>("SELECT id,status FROM publication_jobs WHERE scheduled_at <= now() AND next_attempt_at <= now() AND scheduled_at + interval '1 hour' > now() AND (status='scheduled' OR (status IN ('preparing','prepared') AND (lease_until IS NULL OR lease_until <= now()))) ORDER BY scheduled_at,id FOR UPDATE SKIP LOCKED LIMIT 1");
      const candidate = result.rows[0];
      if (!candidate) return null;
      const lease = randomUUID();
      const status = candidate.status === 'prepared' ? 'prepared' : 'preparing';
      const updated = await client.query<Job>("UPDATE publication_jobs SET status=$2,lease_token=$3,lease_until=now()+interval '2 minutes',updated_at=now() WHERE id=$1 RETURNING id,post_id,content_version,account_id,requested_by,status,lease_token,container_id,part_index,reply_to_id", [candidate.id, status, lease]);
      if (status === 'preparing') await client.query("INSERT INTO publication_attempts (id,job_id,stage,outcome) VALUES ($1,$2,'prepare','started')", [randomUUID(), candidate.id]);
      return updated.rows[0]!;
    });
  }

  async markPrepared(jobId: string, lease: string, containerId: string, waitForProcessing=false): Promise<boolean> {
    if (!/^[0-9]+$/.test(containerId)) throw new Error('ID container tidak valid.');
    return this.transaction(async client => {
      const updated = await client.query("UPDATE publication_jobs SET status='prepared',container_id=$3,next_attempt_at=CASE WHEN $4::boolean THEN now()+interval '30 seconds' ELSE next_attempt_at END,lease_token=CASE WHEN $4::boolean THEN NULL ELSE lease_token END,lease_until=CASE WHEN $4::boolean THEN NULL ELSE lease_until END,updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='preparing' AND lease_until>now() RETURNING id", [jobId, lease, containerId,waitForProcessing]);
      if (!updated.rowCount) return false;
      await client.query("INSERT INTO publication_attempts (id,job_id,stage,outcome) VALUES ($1,$2,'prepare','succeeded')", [randomUUID(), jobId]);
      return true;
    });
  }

  async payload(jobId: string, lease: string): Promise<PublicationPayload | null> {
    const result = await this.pool.query<PublicationPayload>("SELECT CASE WHEN j.part_index=0 THEN v.body ELSE r.body END AS body,CASE WHEN j.part_index=0 THEN v.media_id ELSE NULL END AS media_id,CASE WHEN j.part_index=0 THEN m.kind ELSE NULL END AS media_kind,a.threads_user_id,a.encrypted_token,a.token_iv,a.token_tag FROM publication_jobs j JOIN content_posts p ON p.id=j.post_id JOIN content_versions v ON v.post_id=p.id AND v.version=p.current_version LEFT JOIN content_version_replies r ON r.post_id=v.post_id AND r.version=v.version AND r.position=j.part_index LEFT JOIN media_assets m ON m.id=v.media_id JOIN threads_accounts a ON a.id=v.destination_account_id JOIN local_users u ON u.id=j.requested_by WHERE j.id=$1 AND j.lease_token=$2 AND j.lease_until>now() AND j.status IN ('preparing','prepared') AND (j.part_index=0 OR (r.body IS NOT NULL AND j.reply_to_id IS NOT NULL)) AND p.status='approved' AND p.current_version=j.content_version AND v.destination_account_id=j.account_id AND a.status='active' AND a.token_expires_at>now() AND u.disabled_at IS NULL AND u.email_verified_at IS NOT NULL AND (p.created_by=u.id OR u.role IN ('admin','reviewer')) AND EXISTS (SELECT 1 FROM content_reviews r WHERE r.post_id=p.id AND r.content_version=p.current_version AND r.decision='approved')", [jobId, lease]);
    return result.rows[0] ?? null;
  }

  async media(jobId: string, lease: string): Promise<{media_id:string; kind:'IMAGE'|'VIDEO'; position:number; container_id:string|null}[]> {
    const result = await this.pool.query<{media_id:string; kind:'IMAGE'|'VIDEO'; position:number; container_id:string|null}>("SELECT cm.media_id,m.kind,cm.position,i.container_id FROM publication_jobs j JOIN content_version_media cm ON cm.post_id=j.post_id AND cm.version=j.content_version JOIN media_assets m ON m.id=cm.media_id LEFT JOIN publication_carousel_items i ON i.job_id=j.id AND i.position=cm.position AND i.media_id=cm.media_id WHERE j.id=$1 AND j.lease_token=$2 AND j.lease_until>now() AND j.part_index=0 AND j.status IN ('preparing','prepared') ORDER BY cm.position",[jobId,lease]);
    return result.rows;
  }
  async saveCarouselItem(jobId: string, lease: string, position: number, mediaId: string, container: string): Promise<boolean> {
    const result = await this.pool.query("INSERT INTO publication_carousel_items(job_id,position,media_id,container_id) SELECT j.id,$3,$4,$5 FROM publication_jobs j JOIN content_version_media cm ON cm.post_id=j.post_id AND cm.version=j.content_version AND cm.position=$3 AND cm.media_id=$4 WHERE j.id=$1 AND j.lease_token=$2 AND j.lease_until>now() AND j.status='preparing' ON CONFLICT (job_id,position) DO NOTHING RETURNING job_id",[jobId,lease,position,mediaId,container]);
    return !!result.rowCount;
  }
  async deferPreparing(jobId:string, lease:string): Promise<void> {
    await this.pool.query("UPDATE publication_jobs SET next_attempt_at=now()+interval '60 seconds',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='preparing' AND lease_until>now()",[jobId,lease]);
  }

  async preparationFailed(jobId: string, lease: string, retryable: boolean, reason: 'meta_auth' | 'meta_rejected' | 'meta_unavailable'): Promise<void> {
    await this.transaction(async client => {
      const attempts = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM publication_attempts WHERE job_id=$1 AND stage='prepare' AND outcome='started'", [jobId]);
      const delay = Math.min(300, 30 * 2 ** Math.min(Math.max((attempts.rows[0]?.count ?? 1) - 1, 0), 4));
      const updated = await client.query("UPDATE publication_jobs SET status=CASE WHEN $3::boolean AND scheduled_at+interval '1 hour'>now()+$4*interval '1 second' THEN 'scheduled' ELSE 'needs_action' END,failure_code=$5,next_attempt_at=now()+$4*interval '1 second',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='preparing' AND lease_until>now() RETURNING id", [jobId, lease, retryable, delay, reason]);
      if (updated.rowCount) await client.query("INSERT INTO publication_attempts (id,job_id,stage,outcome) VALUES ($1,$2,'prepare','safe_failure')", [randomUUID(), jobId]);
    });
  }
  async needsAction(jobId: string, lease: string, reason: 'preconditions' | 'token_unreadable' | 'meta_rejected' | 'meta_auth' | 'meta_unavailable' = 'preconditions'): Promise<void> {
    await this.pool.query("UPDATE publication_jobs SET status='needs_action',failure_code=$3,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND status IN ('preparing','prepared') AND lease_until>now()", [jobId, lease, reason]);
  }
  async deferPrepared(jobId: string, lease: string, failed = false): Promise<void> {
    await this.pool.query("UPDATE publication_jobs SET next_attempt_at=now()+(CASE WHEN $3::boolean THEN LEAST(300,30*POWER(2,LEAST(status_check_failures,4))) ELSE 60 END)*interval '1 second',status_check_failures=CASE WHEN $3::boolean THEN status_check_failures+1 ELSE 0 END,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='prepared' AND lease_until>now()",[jobId,lease,failed]);
  }
  async preparedUncertain(jobId: string, lease: string) {
    await this.transaction(async client => {
      const changed = await client.query("UPDATE publication_jobs SET status='uncertain',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='prepared' AND lease_until>now() RETURNING id",[jobId,lease]);
      if (changed.rowCount) await client.query("INSERT INTO publication_attempts(id,job_id,stage,outcome) VALUES ($1,$2,'publish','uncertain')",[randomUUID(),jobId]);
    });
  }

  async beginPublish(jobId: string, lease: string): Promise<boolean> {
    return this.transaction(async client => {
      const existing = await client.query("SELECT pp.status FROM publication_parts pp JOIN publication_jobs j ON j.id=pp.job_id AND j.part_index=pp.position WHERE j.id=$1 AND pp.status<>'not_published' FOR UPDATE OF pp",[jobId]);
      if (existing.rowCount) return false;
      const updated = await client.query("UPDATE publication_jobs j SET status='publishing',updated_at=now() WHERE j.id=$1 AND j.lease_token=$2 AND j.status='prepared' AND j.lease_until>now() AND j.scheduled_at + interval '1 hour'>now() AND EXISTS (SELECT 1 FROM content_posts p JOIN content_versions v ON v.post_id=p.id AND v.version=p.current_version JOIN threads_accounts a ON a.id=v.destination_account_id JOIN local_users u ON u.id=j.requested_by WHERE p.id=j.post_id AND p.status='approved' AND p.current_version=j.content_version AND v.destination_account_id=j.account_id AND a.status='active' AND a.token_expires_at>now() AND u.disabled_at IS NULL AND u.email_verified_at IS NOT NULL AND (p.created_by=u.id OR u.role IN ('admin','reviewer')) AND EXISTS (SELECT 1 FROM content_reviews r WHERE r.post_id=p.id AND r.content_version=p.current_version AND r.decision='approved')) RETURNING j.id", [jobId, lease]);
      if (!updated.rowCount) return false;
      await client.query("INSERT INTO publication_parts(job_id,position,status,container_id) SELECT id,part_index,'publishing',container_id FROM publication_jobs WHERE id=$1 ON CONFLICT (job_id,position) DO UPDATE SET status='publishing',published_id=NULL,provider_response_id=NULL,container_id=EXCLUDED.container_id WHERE publication_parts.status='not_published'",[jobId]);
      await client.query("INSERT INTO publication_attempts (id,job_id,stage,outcome) VALUES ($1,$2,'publish','started')", [randomUUID(), jobId]);
      return true;
    });
  }

  async markPublished(jobId: string, lease: string, publishedId: string): Promise<boolean> {
    if (!/^[0-9]+$/.test(publishedId)) throw new Error('ID publikasi tidak valid.');
    return this.finish(jobId, lease, 'published', publishedId);
  }
  async markUncertain(jobId: string, lease: string, failure?:PublicationFailure): Promise<boolean> { return this.finish(jobId, lease, 'uncertain', null,failure); }
  private async finish(jobId: string, lease: string, status: 'published' | 'uncertain', publishedId: string | null,failure?:PublicationFailure): Promise<boolean> {
    return this.transaction(async client => {
      const locked = await client.query<{post_id:string;content_version:number;part_index:number}>("SELECT post_id,content_version,part_index FROM publication_jobs WHERE id=$1 AND lease_token=$2 AND status='publishing' FOR UPDATE",[jobId,lease]);
      const job=locked.rows[0]; if (!job) return false;
      await client.query("UPDATE publication_parts SET status=$3,published_id=$4,provider_response_id=CASE WHEN $3='published' THEN $4 ELSE provider_response_id END WHERE job_id=$1 AND position=$2",[jobId,job.part_index,status,publishedId]);
      const next = status === 'published' ? await client.query('SELECT position FROM content_version_replies WHERE post_id=$1 AND version=$2 AND position=$3',[job.post_id,job.content_version,job.part_index+1]) : null;
      if (next?.rowCount) await client.query("UPDATE publication_jobs SET status='preparing',part_index=part_index+1,reply_to_id=$2,container_id=NULL,next_attempt_at=now()+interval '30 seconds',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",[jobId,publishedId]);
      else await client.query("UPDATE publication_jobs SET status=$2,published_id=CASE WHEN $2='published' THEN (SELECT published_id FROM publication_parts WHERE job_id=$1 AND position=0) ELSE NULL END,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",[jobId,status]);
      await client.query('INSERT INTO publication_attempts (id,job_id,stage,outcome,failure_reason,failure_http_status,failure_meta_code,failure_meta_subcode) VALUES ($1,$2,\'publish\',$3,$4,$5,$6,$7)', [randomUUID(), jobId, status === 'published' ? 'succeeded' : 'uncertain',failure?.reason ?? null,failure?.httpStatus ?? null,failure?.metaCode ?? null,failure?.metaSubcode ?? null]);
      return true;
    });
  }
}
