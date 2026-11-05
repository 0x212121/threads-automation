import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { hashPassword } from './password.js';
import type { Role } from './domain.js';
import { recordAudit } from './audit.js';

const tokenHash = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');
const emailPattern = /^[^\s@<>\r\n,;]+@[^\s@<>\r\n,;]+\.[^\s@<>\r\n,;]+$/;
export class InvitationError extends Error {}

export class Invitations {
  constructor(private readonly pool: Pool) {}
  private async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const value = await fn(client); await client.query('COMMIT'); return value; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async issue(adminId: string, address: string, role: Role): Promise<{ token: string; email: string }> {
    const email = address.trim().toLowerCase();
    if (email.length > 254 || !emailPattern.test(email) || !['admin', 'reviewer', 'editor'].includes(role)) throw new InvitationError('Email atau peran tidak valid.');
    const token = randomBytes(32).toString('base64url');
    await this.transaction(async client => {
      const admin = await client.query<{ role: string; email_verified_at: Date | null; disabled_at: Date | null }>('SELECT role, email_verified_at, disabled_at FROM local_users WHERE id=$1 FOR UPDATE', [adminId]);
      if (!admin.rows[0] || admin.rows[0].role !== 'admin' || !admin.rows[0].email_verified_at || admin.rows[0].disabled_at) throw new InvitationError('Hanya administrator dengan email terverifikasi dapat mengundang.');
      const existing = await client.query('SELECT id FROM local_users WHERE email=$1', [email]);
      if (existing.rowCount) throw new InvitationError('Undangan tidak dapat dibuat.');
      await client.query('UPDATE team_invitations SET revoked_at=now() WHERE email=$1 AND accepted_at IS NULL AND revoked_at IS NULL', [email]);
      const id=randomUUID();
      await client.query("INSERT INTO team_invitations (id,email,role,token_hash,invited_by,expires_at) VALUES ($1,$2,$3,$4,$5,now()+interval '7 days')", [id, email, role, tokenHash(token), adminId]);
      await recordAudit(client,adminId,'invitation.issued','invitation',id,{role});
    });
    return { token, email };
  }
  async accept(token: string, password: string): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
    const hash = await hashPassword(password);
    return this.transaction(async client => {
      const result = await client.query<{ id: string; email: string; role: Role }>('SELECT id,email,role FROM team_invitations WHERE token_hash=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() FOR UPDATE', [tokenHash(token)]);
      const invitation = result.rows[0];
      if (!invitation) return false;
      const added = await client.query<{id:string}>("INSERT INTO local_users (id,email,password_hash,role,email_verified_at) VALUES ($1,$2,$3,$4,now()) ON CONFLICT (email) DO NOTHING RETURNING id", [randomUUID(), invitation.email, hash, invitation.role]);
      if (added.rowCount !== 1) return false;
      await client.query('UPDATE team_invitations SET accepted_at=now() WHERE id=$1', [invitation.id]);
      await recordAudit(client,added.rows[0]!.id,'invitation.accepted','invitation',invitation.id);
      return true;
    });
  }
}
