import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { hashPassword } from './password.js';

export const INITIAL_ADMIN_EMAIL = 'wijaya.indra2196@gmail.com';

// Database access is deliberately restricted to the local administrator command.
export async function bootstrapAdmin(pool: Pool, password: string): Promise<void> {
  const hash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id = randomUUID();
    await client.query("INSERT INTO local_users (id, email, password_hash, role) VALUES ($1, $2, $3, 'admin')", [id, INITIAL_ADMIN_EMAIL, hash]);
    const state = await client.query('INSERT INTO bootstrap_state (singleton, initial_admin_id) VALUES (true, $1) ON CONFLICT DO NOTHING RETURNING singleton', [id]);
    if (state.rowCount !== 1) throw new Error('Bootstrap sudah pernah dijalankan.');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
