import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { TokenVault } from './token-vault.js';

export class ThreadsAccountError extends Error {}

// Registration is internal only: the caller must first validate Meta's OAuth response.
export class ThreadsAccounts {
  constructor(private readonly pool: Pool, private readonly vault: TokenVault) {}
  async register(adminId: string, account: { threadsUserId: string; username: string; token: string; expiresAt: Date }): Promise<string> {
    if (!/^[0-9]+$/.test(account.threadsUserId) || !account.username.trim() || account.username.length > 255 || !account.token || !Number.isFinite(account.expiresAt.getTime()) || account.expiresAt.getTime() <= Date.now()) throw new ThreadsAccountError('Data akun Threads tidak valid.');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const admin = await client.query<{ role: string; email_verified_at: Date | null; disabled_at: Date | null }>('SELECT role, email_verified_at, disabled_at FROM local_users WHERE id=$1 FOR UPDATE', [adminId]);
      if (!admin.rows[0] || admin.rows[0].role !== 'admin' || !admin.rows[0].email_verified_at || admin.rows[0].disabled_at) throw new ThreadsAccountError('Hanya admin terverifikasi dapat menghubungkan akun.');
      const existing = await client.query<{ id: string }>('SELECT id FROM threads_accounts WHERE threads_user_id=$1 FOR UPDATE', [account.threadsUserId]);
      const id = existing.rows[0]?.id ?? randomUUID();
      const sealed = this.vault.seal(account.token, `${id}:${account.threadsUserId}`);
      if (existing.rows[0]) {
        await client.query("UPDATE threads_accounts SET username=$2,connected_by=$3,encrypted_token=$4,token_iv=$5,token_tag=$6,token_expires_at=$7,status='active',updated_at=now() WHERE id=$1", [id, account.username.trim(), adminId, sealed.ciphertext, sealed.iv, sealed.tag, account.expiresAt]);
      } else {
        await client.query("INSERT INTO threads_accounts (id,threads_user_id,username,connected_by,encrypted_token,token_iv,token_tag,token_expires_at,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')", [id, account.threadsUserId, account.username.trim(), adminId, sealed.ciphertext, sealed.iv, sealed.tag, account.expiresAt]);
      }
      await client.query('COMMIT');
      return id;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
