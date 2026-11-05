import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

const digest = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class EmailVerification {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async issue(userId: string, ttlSeconds: number): Promise<string> {
    if (!uuidPattern.test(userId) || !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 30 * 24 * 60 * 60) throw new Error('Parameter verifikasi tidak valid.');
    const token = randomBytes(32).toString('base64url');
    await this.transaction(async client => {
      const result = await client.query<{ disabled_at: Date | null; email_verified_at: Date | null }>('SELECT disabled_at, email_verified_at FROM local_users WHERE id=$1 FOR UPDATE', [userId]);
      const user = result.rows[0];
      if (!user || user.disabled_at || user.email_verified_at) throw new Error('Verifikasi tidak dapat dibuat.');
      await client.query('UPDATE email_verification_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', [userId]);
      await client.query("INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + ($4 * interval '1 second'))", [randomUUID(), userId, digest(token), ttlSeconds]);
    });
    return token;
  }

  async consume(token: string, userId: string): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !uuidPattern.test(userId)) return false;
    return this.transaction(async client => {
      const result = await client.query<{ user_id: string }>("UPDATE email_verification_tokens SET used_at=now() WHERE token_hash=$1 AND user_id=$2 AND used_at IS NULL AND expires_at>now() AND EXISTS (SELECT 1 FROM local_users WHERE id=email_verification_tokens.user_id AND disabled_at IS NULL AND email_verified_at IS NULL) RETURNING user_id", [digest(token), userId]);
      if (!result.rows[0]) return false;
      const updated = await client.query('UPDATE local_users SET email_verified_at=now() WHERE id=$1 AND disabled_at IS NULL AND email_verified_at IS NULL RETURNING id', [result.rows[0].user_id]);
      if (updated.rowCount !== 1) throw new Error('Verifikasi tidak dapat diselesaikan.');
      return true;
    });
  }
}
