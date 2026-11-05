import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { hashPassword } from './password.js';

const digest = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');
export class PasswordReset {
  constructor(private readonly pool: Pool) {}
  private async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async issue(address: string): Promise<{ token: string; email: string } | null> {
    const email = address.trim().toLowerCase();
    if (!email || email.length > 254) return null;
    const token = randomBytes(32).toString('base64url');
    return this.transaction(async client => {
      const result = await client.query<{ id: string; disabled_at: Date | null }>('SELECT id, disabled_at FROM local_users WHERE email=$1 FOR UPDATE', [email]);
      const user = result.rows[0];
      if (!user || user.disabled_at) return null;
      await client.query('UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', [user.id]);
      await client.query("INSERT INTO password_reset_tokens (id,user_id,token_hash,expires_at) VALUES ($1,$2,$3,now()+interval '1 hour')", [randomUUID(), user.id, digest(token)]);
      return { token, email };
    });
  }
  async consume(token: string, password: string): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
    const hash = await hashPassword(password);
    return this.transaction(async client => {
      const result = await client.query<{ user_id: string }>("UPDATE password_reset_tokens SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() AND EXISTS (SELECT 1 FROM local_users WHERE id=password_reset_tokens.user_id AND disabled_at IS NULL) RETURNING user_id", [digest(token)]);
      const user = result.rows[0];
      if (!user) return false;
      const updated = await client.query('UPDATE local_users SET password_hash=$2, session_version=session_version+1 WHERE id=$1 AND disabled_at IS NULL RETURNING id', [user.user_id, hash]);
      if (updated.rowCount !== 1) throw new Error('Pemulihan tidak dapat diselesaikan.');
      await client.query('UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', [user.user_id]);
      return true;
    });
  }
}
