import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { bootstrapAdmin, INITIAL_ADMIN_EMAIL } from '../src/bootstrap-admin.js';
import { hashPassword, verifyPassword } from '../src/password.js';

test('hash kata sandi memakai salt dan tidak menerima kata sandi salah', async () => {
  const a = await hashPassword('contoh kata sandi panjang');
  const b = await hashPassword('contoh kata sandi panjang');
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('contoh kata sandi panjang', a), true);
  assert.equal(await verifyPassword('kata sandi lain', a), false);
  assert.equal(await verifyPassword('apa pun', 'hash tidak valid'), false);
  await assert.rejects(hashPassword('singkat'));
});

test('bootstrap membuat satu admin dan gagal aman saat dicoba lagi', async () => {
  const db = new PGlite();
  await db.exec(await readFile('db/migrations/002_local_identity.sql', 'utf8'));
  const client = { query: async (text: string, params?: unknown[]) => { const result = await db.query(text, params); return { ...result, rowCount: result.affectedRows ?? result.rows.length }; }, release: () => {} };
  const pool = { connect: async () => client } as unknown as Pool;
  await bootstrapAdmin(pool, 'kata sandi untuk pengujian');
  await assert.rejects(bootstrapAdmin(pool, 'kata sandi untuk pengujian'));
  const result = await db.query<{ email: string; role: string; password_hash: string; email_verified_at: string | null }>('SELECT email, role, password_hash, email_verified_at FROM local_users');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.email, INITIAL_ADMIN_EMAIL);
  assert.equal(result.rows[0]?.role, 'admin');
  assert.equal(result.rows[0]?.email_verified_at, null);
  assert.equal(await verifyPassword('kata sandi untuk pengujian', result.rows[0]!.password_hash), true);
  await db.close();
});
