import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { DomainError, nextContentStatus, type ContentStatus, type Role } from './domain.js';
import { recordAudit } from './audit.js';

type Actor = { id: string; role: Role };
type Post = { id: string; status: ContentStatus; current_version: number; revision: number };
type LockedPost = Post & { created_by: string; destination_account_id: string | null; media_id: string | null };
type Content = { body: string; destinationAccountId: string | null; mediaId?: string | null; mediaIds?: string[]; replies?: string[] };
type ContentEdit = { body: string; destinationAccountId?: string | null; mediaId?: string | null; mediaIds?: string[]; replies?: string[] };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class PermissionError extends Error {}

function validateActor(actor: Actor) {
  if (!uuidPattern.test(actor.id) || !['admin', 'reviewer', 'editor'].includes(actor.role)) throw new DomainError('Aktor tidak valid.');
}
function validateContent(content: ContentEdit) {
  if (typeof content.body !== 'string' || content.body.length > 5000) throw new DomainError('Isi konten tidak valid.');
  if (content.mediaId != null && !uuidPattern.test(content.mediaId)) throw new DomainError('Media tidak valid.');
  if (content.mediaIds !== undefined && (!Array.isArray(content.mediaIds) || content.mediaIds.length > 10 || content.mediaIds.some(id => typeof id !== 'string' || !uuidPattern.test(id)) || new Set(content.mediaIds).size !== content.mediaIds.length || content.mediaId !== undefined)) throw new DomainError('Daftar media tidak valid.');
  if (content.replies !== undefined && (!Array.isArray(content.replies) || content.replies.length > 9 || content.replies.some(reply => typeof reply !== 'string' || !reply.trim() || Array.from(reply).length > 500) || (content.replies.length > 0 && Array.from(content.body).length > 500))) throw new DomainError('Bagian rangkaian tidak valid atau melebihi 500 karakter.');
  if (content.destinationAccountId != null && !uuidPattern.test(content.destinationAccountId)) throw new DomainError('Akun tujuan tidak valid.');
}

// The caller must authenticate the actor and check team/account access before calling this store.
export class ContentStore {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async create(actor: Actor, content: Content): Promise<Post> {
    validateActor(actor); validateContent(content);
    return this.transaction(async client => {
      await this.checkAccount(client, content.destinationAccountId);
      const media = content.mediaIds ?? (content.mediaId ? [content.mediaId] : []);
      await this.checkMedia(client, media, actor.id, content.body);
      const id = randomUUID();
      const result = await client.query<Post>("INSERT INTO content_posts (id, created_by, status, current_version) VALUES ($1, $2, 'draft', 1) RETURNING id, status, current_version, revision", [id, actor.id]);
      await client.query('INSERT INTO content_versions (post_id, version, body, destination_account_id, created_by, media_id) VALUES ($1, 1, $2, $3, $4, $5)', [id, content.body.trim(), content.destinationAccountId, actor.id, media[0] ?? null]);
      await this.saveMedia(client,id,1,media);
      await this.saveReplies(client,id,1,content.replies ?? []);
      await recordAudit(client,actor.id,'post.created','post',id,{version:1});
      return result.rows[0]!;
    });
  }

  async duplicate(actor: Actor, sourceId: string, expectedRevision: number): Promise<Post> {
    validateActor(actor);
    return this.transaction(async client => {
      const source = await this.lockPost(client, sourceId, expectedRevision);
      const id=randomUUID();
      const result=await client.query<Post>("INSERT INTO content_posts (id,created_by,status,current_version) VALUES ($1,$2,'draft',1) RETURNING id,status,current_version,revision",[id,actor.id]);
      await client.query("INSERT INTO content_versions(post_id,version,body,destination_account_id,created_by,media_id) SELECT $1,1,v.body,CASE WHEN a.status='active' AND a.token_expires_at>now() THEN v.destination_account_id ELSE NULL END,$2,v.media_id FROM content_versions v LEFT JOIN threads_accounts a ON a.id=v.destination_account_id WHERE v.post_id=$3 AND v.version=$4",[id,actor.id,sourceId,source.current_version]);
      await client.query('INSERT INTO content_version_media(post_id,version,position,media_id) SELECT $1,1,position,media_id FROM content_version_media WHERE post_id=$2 AND version=$3',[id,sourceId,source.current_version]);
      await client.query('INSERT INTO content_version_replies(post_id,version,position,body) SELECT $1,1,position,body FROM content_version_replies WHERE post_id=$2 AND version=$3',[id,sourceId,source.current_version]);
      await recordAudit(client,actor.id,'post.duplicated','post',id,{version:1,sourcePostId:sourceId});
      return result.rows[0]!;
    });
  }

  async edit(actor: Actor, id: string, expectedRevision: number, content: ContentEdit): Promise<Post> {
    validateActor(actor); validateContent(content);
    return this.transaction(async client => {
      const post = await this.lockPost(client, id, expectedRevision);
      if (post.created_by !== actor.id) throw new PermissionError('Tidak memiliki akses untuk mengubah konten ini.');
      await this.ensureNoPublication(client, id);
      const destination = content.destinationAccountId === undefined ? post.destination_account_id : content.destinationAccountId;
      const existing = await client.query<{media_id: string}>('SELECT media_id FROM content_version_media WHERE post_id=$1 AND version=$2 ORDER BY position',[id,post.current_version]);
      const existingReplies = await client.query<{body: string}>('SELECT body FROM content_version_replies WHERE post_id=$1 AND version=$2 ORDER BY position',[id,post.current_version]);
      const replies = content.replies ?? existingReplies.rows.map(row => row.body);
      validateContent({ ...content, replies });
      const media = content.mediaIds ?? (content.mediaId === undefined ? existing.rows.map(row => row.media_id) : content.mediaId ? [content.mediaId] : []);
      await this.checkMedia(client, media, actor.id, content.body);
      await this.checkAccount(client, destination);
      const status = nextContentStatus(post.status, 'edit', actor.role);
      const version = post.current_version + 1;
      await client.query('INSERT INTO content_versions (post_id, version, body, destination_account_id, created_by, media_id) VALUES ($1, $2, $3, $4, $5, $6)', [id, version, content.body.trim(), destination, actor.id, media[0] ?? null]);
      await this.saveMedia(client,id,version,media);
      await this.saveReplies(client,id,version,replies);
      const result = await client.query<Post>('UPDATE content_posts SET current_version=$2, status=$3, revision=revision+1, updated_at=now() WHERE id=$1 RETURNING id, status, current_version, revision', [id, version, status]);
      await recordAudit(client,actor.id,'post.edited','post',id,{version});
      return result.rows[0]!;
    });
  }

  async transition(actor: Actor, id: string, expectedRevision: number, action: 'submit' | 'approve' | 'reject'): Promise<Post> {
    validateActor(actor);
    return this.transaction(async client => {
      const post = await this.lockPost(client, id, expectedRevision);
      if ((action === 'submit' && post.created_by !== actor.id) || (action !== 'submit' && actor.role === 'editor')) throw new PermissionError('Tidak memiliki akses untuk melakukan tindakan ini.');
      await this.ensureNoPublication(client, id);
      if (action !== 'reject') await this.checkAccount(client, post.destination_account_id);
      const status = nextContentStatus(post.status, action, actor.role);
      if (action === 'approve' || action === 'reject') {
        await client.query('INSERT INTO content_reviews (id, post_id, content_version, reviewer_id, decision) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), id, post.current_version, actor.id, status]);
      }
      const result = await client.query<Post>('UPDATE content_posts SET status=$2, revision=revision+1, updated_at=now() WHERE id=$1 RETURNING id, status, current_version, revision', [id, status]);
      await recordAudit(client,actor.id,`post.${action}`,'post',id,{version:post.current_version});
      return result.rows[0]!;
    });
  }

  async remove(actor:Actor,id:string,expectedRevision:number):Promise<void> {
    validateActor(actor);
    await this.transaction(async client=>{
      const post=await this.lockPost(client,id,expectedRevision);
      if (post.created_by!==actor.id) throw new PermissionError('Hanya pembuat yang dapat menghapus draft.');
      if (post.status!=='draft' && post.status!=='rejected') throw new DomainError('Hanya draft atau konten ditolak yang dapat dihapus.');
      await this.ensureNoPublication(client,id);
      await client.query('UPDATE content_posts SET deleted_at=now(),deleted_by=$2,revision=revision+1,updated_at=now() WHERE id=$1',[id,actor.id]);
      await recordAudit(client,actor.id,'post.deleted','post',id,{version:post.current_version});
    });
  }

  private async lockPost(client: PoolClient, id: string, expectedRevision: number): Promise<LockedPost> {
    if (!uuidPattern.test(id) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new DomainError('Identitas atau revisi tidak valid.');
    const result = await client.query<LockedPost>('SELECT p.id, p.status, p.current_version, p.revision, p.created_by, v.destination_account_id, v.media_id FROM content_posts p JOIN content_versions v ON v.post_id=p.id AND v.version=p.current_version WHERE p.id=$1 AND p.deleted_at IS NULL FOR UPDATE OF p', [id]);
    const post = result.rows[0];
    if (!post) throw new DomainError('Konten tidak ditemukan.');
    if (post.revision !== expectedRevision) throw new DomainError('Konten telah berubah; muat ulang sebelum melanjutkan.');
    return post;
  }
  private async checkAccount(client: PoolClient, id: string | null): Promise<void> {
    if (id === null) return;
    const result = await client.query("SELECT id FROM threads_accounts WHERE id=$1 AND status='active' AND token_expires_at > now() FOR SHARE", [id]);
    if (!result.rows[0]) throw new DomainError('Akun Threads tidak tersedia atau perlu otorisasi ulang.');
  }
  private async checkMedia(client: PoolClient, ids: string[], userId: string, body: string) {
    if (!body.trim() && !ids.length) throw new DomainError('Isi teks atau lampirkan media.');
    for (const id of [...ids].sort()) {
      const result = await client.query<{kind: string}>('SELECT m.kind FROM media_assets m WHERE m.id=$1 AND (m.uploaded_by=$2 OR EXISTS (SELECT 1 FROM content_version_media cm JOIN content_posts p ON p.id=cm.post_id WHERE cm.media_id=m.id AND p.created_by=$2 AND p.deleted_at IS NULL)) FOR SHARE OF m', [id,userId]);
      if (!result.rows[0]) throw new DomainError('Media tidak ditemukan atau bukan milik pembuat draft.');
      if (ids.length > 1 && result.rows[0].kind !== 'IMAGE') throw new DomainError('Carousel hanya mendukung gambar.');
    }
  }
  private async saveMedia(client: PoolClient, postId: string, version: number, ids: string[]) {
    for (let position=0; position<ids.length; position++) await client.query('INSERT INTO content_version_media(post_id,version,position,media_id) VALUES ($1,$2,$3,$4)',[postId,version,position,ids[position]]);
  }
  private async saveReplies(client: PoolClient, postId: string, version: number, replies: string[]) {
    for (let position=0; position<replies.length; position++) await client.query('INSERT INTO content_version_replies(post_id,version,position,body) VALUES ($1,$2,$3,$4)',[postId,version,position+1,replies[position]!.trim()]);
  }
  private async ensureNoPublication(client: PoolClient, id: string): Promise<void> {
    const result = await client.query("SELECT j.id FROM publication_jobs j WHERE j.post_id=$1 AND (j.status IN ('scheduled','preparing','prepared','publishing','published','confirmed_published','uncertain') OR EXISTS (SELECT 1 FROM publication_parts pp WHERE pp.job_id=j.id AND pp.status='published')) LIMIT 1", [id]);
    if (result.rows[0]) throw new DomainError('Konten memiliki publikasi aktif atau hasil yang belum pasti.');
  }
}
