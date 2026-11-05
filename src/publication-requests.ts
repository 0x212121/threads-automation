import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { resolveLocalSchedule } from './schedule-time.js';

export class PublicationRequestError extends Error {}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PublicationRequests {
  constructor(private readonly pool: Pool) {}
  private async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  private async authorize(client: PoolClient, userId: string, postId: string, revision: number, requireReady = true) {
    if (!uuid.test(userId) || !uuid.test(postId) || !Number.isSafeInteger(revision) || revision < 1) throw new PublicationRequestError('Permintaan tidak valid.');
    const userResult = await client.query<{ role: string; email_verified_at: Date | null; disabled_at: Date | null }>('SELECT role,email_verified_at,disabled_at FROM local_users WHERE id=$1 FOR SHARE', [userId]);
    const user = userResult.rows[0];
    const result = await client.query<{ id: string; created_by: string; status: string; current_version: number; revision: number; destination_account_id: string | null }>('SELECT p.id,p.created_by,p.status,p.current_version,p.revision,v.destination_account_id FROM content_posts p JOIN content_versions v ON v.post_id=p.id AND v.version=p.current_version WHERE p.id=$1 FOR UPDATE OF p', [postId]);
    const post = result.rows[0];
    if (!user || user.disabled_at || (requireReady && !user.email_verified_at) || !post || (post.created_by !== userId && !['admin','reviewer'].includes(user.role))) throw new PublicationRequestError('Tidak memiliki akses untuk menjadwalkan konten ini.');
    if (post.revision !== revision) throw new PublicationRequestError('Konten telah berubah; muat ulang sebelum melanjutkan.');
    if (!requireReady) return post;
    if (post.status !== 'approved' || !post.destination_account_id) throw new PublicationRequestError('Konten harus disetujui, memiliki akun tujuan, dan memakai revisi terbaru.');
    const account = await client.query("SELECT id FROM threads_accounts WHERE id=$1 AND status='active' AND token_expires_at>now() FOR SHARE", [post.destination_account_id]);
    const approval = await client.query("SELECT id FROM content_reviews WHERE post_id=$1 AND content_version=$2 AND decision='approved' LIMIT 1", [postId, post.current_version]);
    if (!account.rowCount || !approval.rowCount) throw new PublicationRequestError('Akun atau persetujuan tidak tersedia.');
    return post;
  }
  async schedule(userId: string, postId: string, revision: number, local: string, timeZone: string) {
    let instant: Date;
    try { instant = resolveLocalSchedule(local, timeZone); } catch (error) { throw new PublicationRequestError(error instanceof Error ? error.message : 'Waktu tidak valid.'); }
    try {
      return await this.transaction(async client => {
        const post = await this.authorize(client, userId, postId, revision);
        const result = await client.query<{ id: string; status: string; scheduled_at: Date }>("INSERT INTO publication_jobs (id,post_id,content_version,account_id,requested_by,scheduled_at,time_zone,next_attempt_at,status) SELECT $1,$2,$3,$4,$5,$6,$7,$6,'scheduled' WHERE $6::timestamptz>now() AND EXISTS (SELECT 1 FROM threads_accounts WHERE id=$4 AND token_expires_at>$6::timestamptz) RETURNING id,status,scheduled_at", [randomUUID(), postId, post.current_version, post.destination_account_id, userId, instant, timeZone]);
        if (!result.rows[0]) throw new PublicationRequestError('Waktu harus di masa depan dan sebelum token akun kedaluwarsa.');
        return result.rows[0];
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') throw new PublicationRequestError('Konten sudah memiliki publikasi aktif atau hasil yang belum pasti.');
      throw error;
    }
  }
  async publishNow(userId: string, postId: string, revision: number, timeZone: string) {
    try { resolveLocalSchedule('2000-01-15T12:00', timeZone); } catch { throw new PublicationRequestError('Zona waktu tidak valid.'); }
    try {
      return await this.transaction(async client => {
        const post = await this.authorize(client, userId, postId, revision);
        const result = await client.query<{ id: string; status: string; scheduled_at: Date }>("INSERT INTO publication_jobs (id,post_id,content_version,account_id,requested_by,scheduled_at,time_zone,next_attempt_at,status) VALUES ($1,$2,$3,$4,$5,now(),$6,now(),'scheduled') RETURNING id,status,scheduled_at", [randomUUID(), postId, post.current_version, post.destination_account_id, userId, timeZone]);
        return result.rows[0]!;
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') throw new PublicationRequestError('Konten sudah memiliki publikasi aktif atau hasil yang belum pasti.');
      throw error;
    }
  }
  async change(userId: string, postId: string, revision: number, jobId: string, action: 'cancel' | 'reschedule', local?: string, timeZone?: string) {
    if (!uuid.test(jobId)) throw new PublicationRequestError('Identitas jadwal tidak valid.');
    let instant: Date | undefined;
    if (action === 'reschedule') {
      try { instant = resolveLocalSchedule(local ?? '', timeZone ?? ''); } catch (error) { throw new PublicationRequestError(error instanceof Error ? error.message : 'Waktu tidak valid.'); }
    }
    return this.transaction(async client => {
      await this.authorize(client, userId, postId, revision, action !== 'cancel');
      const result = action === 'cancel'
        ? await client.query("UPDATE publication_jobs SET status='cancelled',updated_at=now() WHERE id=$1 AND post_id=$2 AND status='scheduled' AND lease_token IS NULL RETURNING id,status,scheduled_at", [jobId, postId])
        : await client.query("UPDATE publication_jobs SET scheduled_at=$3,time_zone=$4,next_attempt_at=$3,updated_at=now() WHERE id=$1 AND post_id=$2 AND status='scheduled' AND lease_token IS NULL AND $3::timestamptz>now() AND EXISTS (SELECT 1 FROM threads_accounts WHERE id=publication_jobs.account_id AND token_expires_at>$3::timestamptz) RETURNING id,status,scheduled_at", [jobId, postId, instant, timeZone]);
      if (!result.rows[0]) throw new PublicationRequestError('Jadwal sudah diproses, tidak ditemukan, atau waktunya tidak valid.');
      return result.rows[0];
    });
  }
  async resolveUncertain(userId: string, postId: string, revision: number, jobId: string, decision: 'published' | 'not_published') {
    if (!uuid.test(jobId) || !['published','not_published'].includes(decision)) throw new PublicationRequestError('Keputusan tidak valid.');
    return this.transaction(async client => {
      await this.authorize(client, userId, postId, revision, false);
      const status = decision === 'published' ? 'confirmed_published' : 'needs_action';
      const updated = await client.query('UPDATE publication_jobs SET status=$3,updated_at=now() WHERE id=$1 AND post_id=$2 AND status=\'uncertain\' RETURNING id,status,scheduled_at', [jobId, postId, status]);
      if (!updated.rows[0]) throw new PublicationRequestError('Hasil tidak pasti tidak ditemukan atau sudah ditangani.');
      await client.query('INSERT INTO publication_resolutions(id,job_id,resolved_by,decision) VALUES ($1,$2,$3,$4)', [randomUUID(),jobId,userId,decision]);
      return updated.rows[0];
    });
  }
}
