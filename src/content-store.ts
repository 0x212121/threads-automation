import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { DomainError, nextContentStatus, type ContentStatus, type Role } from './domain.js';

type Actor = { id: string; role: Role };
type Post = { id: string; status: ContentStatus; current_version: number; revision: number };
type LockedPost = Post & { created_by: string; destination_account_id: string | null; media_id: string | null };
type Content = { body: string; destinationAccountId: string | null; mediaId?: string | null };
type ContentEdit = { body: string; destinationAccountId?: string | null; mediaId?: string | null };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class PermissionError extends Error {}

function validateActor(actor: Actor) {
  if (!uuidPattern.test(actor.id) || !['admin', 'reviewer', 'editor'].includes(actor.role)) throw new DomainError('Aktor tidak valid.');
}
function validateContent(content: ContentEdit) {
  if (typeof content.body !== 'string' || content.body.length > 5000) throw new DomainError('Isi konten tidak valid.');
  if (content.mediaId != null && !uuidPattern.test(content.mediaId)) throw new DomainError('Media tidak valid.');
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
      await this.checkMedia(client, content.mediaId ?? null, actor.id, content.body);
      const id = randomUUID();
      const result = await client.query<Post>("INSERT INTO content_posts (id, created_by, status, current_version) VALUES ($1, $2, 'draft', 1) RETURNING id, status, current_version, revision", [id, actor.id]);
      await client.query('INSERT INTO content_versions (post_id, version, body, destination_account_id, created_by, media_id) VALUES ($1, 1, $2, $3, $4, $5)', [id, content.body.trim(), content.destinationAccountId, actor.id, content.mediaId ?? null]);
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
      const media = content.mediaId === undefined ? post.media_id : content.mediaId;
      await this.checkMedia(client, media, actor.id, content.body);
      await this.checkAccount(client, destination);
      const status = nextContentStatus(post.status, 'edit', actor.role);
      const version = post.current_version + 1;
      await client.query('INSERT INTO content_versions (post_id, version, body, destination_account_id, created_by, media_id) VALUES ($1, $2, $3, $4, $5, $6)', [id, version, content.body.trim(), destination, actor.id, media]);
      const result = await client.query<Post>('UPDATE content_posts SET current_version=$2, status=$3, revision=revision+1, updated_at=now() WHERE id=$1 RETURNING id, status, current_version, revision', [id, version, status]);
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
      return result.rows[0]!;
    });
  }

  private async lockPost(client: PoolClient, id: string, expectedRevision: number): Promise<LockedPost> {
    if (!uuidPattern.test(id) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new DomainError('Identitas atau revisi tidak valid.');
    const result = await client.query<LockedPost>('SELECT p.id, p.status, p.current_version, p.revision, p.created_by, v.destination_account_id, v.media_id FROM content_posts p JOIN content_versions v ON v.post_id=p.id AND v.version=p.current_version WHERE p.id=$1 FOR UPDATE OF p', [id]);
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
  private async checkMedia(client: PoolClient, id: string | null, userId: string, body: string) {
    if (!body.trim() && !id) throw new DomainError('Isi teks atau lampirkan media.');
    if (!id) return;
    const result = await client.query('SELECT id FROM media_assets WHERE id=$1 AND uploaded_by=$2 FOR SHARE', [id,userId]);
    if (!result.rows[0]) throw new DomainError('Media tidak ditemukan atau bukan milik pembuat draft.');
  }
  private async ensureNoPublication(client: PoolClient, id: string): Promise<void> {
    const result = await client.query("SELECT id FROM publication_jobs WHERE post_id=$1 AND status IN ('scheduled','preparing','prepared','publishing','published','confirmed_published','uncertain') LIMIT 1", [id]);
    if (result.rows[0]) throw new DomainError('Konten memiliki publikasi aktif atau hasil yang belum pasti.');
  }
}
