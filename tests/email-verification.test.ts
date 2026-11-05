import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { EmailVerification } from '../src/email-verification.js';

test('token verifikasi hanya sekali pakai, diganti dengan token baru dan disimpan sebagai hash', async () => {
  const db = new PGlite();
  await db.exec(await readFile('db/migrations/002_local_identity.sql', 'utf8'));
  await db.exec(await readFile('db/migrations/004_email_verification.sql', 'utf8'));
  const query = async (text: string, params?: unknown[]) => { const result = await db.query(text, params); return { ...result, rowCount: result.affectedRows ?? result.rows.length }; };
  const pool = { connect: async () => ({ query, release: () => {} }) } as unknown as Pool;
  const id = '11111111-1111-4111-8111-111111111111';
  await db.query("INSERT INTO local_users (id,email,password_hash,role) VALUES ($1,'test@example.test','hash','admin')", [id]);
  const service = new EmailVerification(pool);
  const old = await service.issue(id, 600);
  const token = await service.issue(id, 600);
  const saved = await db.query<{ token_hash: string }>('SELECT token_hash FROM email_verification_tokens WHERE user_id=$1', [id]);
  assert.equal(saved.rows.some(row => row.token_hash === token || row.token_hash === old), false);
  assert.equal(await service.consume(old, id), false);
  assert.equal(await service.consume('token-tidak-valid', id), false);
  assert.equal(await service.consume(token, '33333333-3333-4333-8333-333333333333'), false);
  assert.equal(await service.consume(token, id), true);
  assert.equal(await service.consume(token, id), false);
  const user = await db.query<{ email_verified_at: Date | null }>('SELECT email_verified_at FROM local_users WHERE id=$1', [id]);
  assert.ok(user.rows[0]?.email_verified_at);
  await assert.rejects(service.issue(id, 600));
  await db.close();
});

test('token kedaluwarsa atau milik akun nonaktif ditolak', async () => {
  const db = new PGlite();
  await db.exec(await readFile('db/migrations/002_local_identity.sql', 'utf8'));
  await db.exec(await readFile('db/migrations/004_email_verification.sql', 'utf8'));
  const query = async (text: string, params?: unknown[]) => { const result = await db.query(text, params); return { ...result, rowCount: result.affectedRows ?? result.rows.length }; };
  const pool = { connect: async () => ({ query, release: () => {} }) } as unknown as Pool;
  const id = '22222222-2222-4222-8222-222222222222';
  await db.query("INSERT INTO local_users (id,email,password_hash,role) VALUES ($1,'test@example.test','hash','admin')", [id]);
  const service = new EmailVerification(pool);
  const token = await service.issue(id, 600);
  await db.query("UPDATE email_verification_tokens SET expires_at=now() - interval '1 second' WHERE user_id=$1", [id]);
  assert.equal(await service.consume(token, id), false);
  const next = await service.issue(id, 600);
  await db.query('UPDATE local_users SET disabled_at=now() WHERE id=$1', [id]);
  assert.equal(await service.consume(next, id), false);
  await db.close();
});
