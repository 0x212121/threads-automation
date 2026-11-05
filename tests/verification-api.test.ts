import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import session from 'express-session';
import request from 'supertest';
import type { Pool } from 'pg';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/password.js';
import type { MailTransport } from '../src/smtp.js';

test('verifikasi dikirim ke alamat sesi dan hanya dapat dikonfirmasi akun yang sesuai', async () => {
  const db = new PGlite();
  for (const name of ['002_local_identity.sql', '004_email_verification.sql', '006_password_reset.sql']) await db.exec(await readFile(`db/migrations/${name}`, 'utf8'));
  const query = async (text: string, params?: unknown[]) => { const result = await db.query(text, params); return { ...result, rowCount: result.affectedRows ?? result.rows.length }; };
  const pool = { query, connect: async () => ({ query, release: () => {} }) } as unknown as Pool;
  const hash = await hashPassword('kata sandi untuk pengujian');
  await db.query("INSERT INTO local_users (id,email,password_hash,role) VALUES ('11111111-1111-4111-8111-111111111111','satu@example.test',$1,'admin'),('22222222-2222-4222-8222-222222222222','dua@example.test',$1,'editor')", [hash]);
  const sent: { to: string; text: string }[] = [];
  const transport: MailTransport = { sendMail: async message => { sent.push(message); return { accepted: [message.to], rejected: [] }; } };
  const origin = 'http://localhost:3000';
  const app = await createApp({ pool, store: new session.MemoryStore(), secret: 'a'.repeat(48), origin, secure: false, trustProxy: false, mail: { transport, from: 'pengirim@example.test' } });
  async function login(email: string) {
    const agent = request.agent(app);
    const csrf = (await agent.get('/api/auth/csrf')).body.csrfToken;
    const result = await agent.post('/api/auth/login').set('Origin', origin).set('X-CSRF-Token', csrf).send({ email, password: 'kata sandi untuk pengujian' });
    assert.equal(result.status, 200);
    return { agent, csrf: result.body.csrfToken };
  }
  const first = await login('satu@example.test'), second = await login('dua@example.test');
  assert.equal((await first.agent.post('/api/auth/verification/request').set('Origin', origin).set('X-CSRF-Token', first.csrf)).status, 204);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.to, 'satu@example.test');
  const token = sent[0]?.text.match(/#verify=([A-Za-z0-9_-]{43})/)?.[1];
  assert.ok(token);
  assert.equal((await second.agent.post('/api/auth/verification/confirm').set('Origin', origin).set('X-CSRF-Token', second.csrf).send({ token })).status, 400);
  assert.equal((await first.agent.post('/api/auth/verification/confirm').set('Origin', origin).set('X-CSRF-Token', 'salah').send({ token })).status, 403);
  assert.equal((await first.agent.post('/api/auth/verification/confirm').set('Origin', origin).set('X-CSRF-Token', first.csrf).send({ token })).status, 204);
  assert.equal((await first.agent.get('/api/auth/me')).body.user.emailVerified, true);
  assert.equal((await first.agent.post('/api/auth/verification/confirm').set('Origin', origin).set('X-CSRF-Token', first.csrf).send({ token })).status, 400);
  const noMailApp = await createApp({ pool, store: new session.MemoryStore(), secret: 'b'.repeat(48), origin, secure: false, trustProxy: false });
  const noMail = request.agent(noMailApp);
  const anonymousToken = (await noMail.get('/api/auth/csrf')).body.csrfToken;
  const noMailLogin = await noMail.post('/api/auth/login').set('Origin', origin).set('X-CSRF-Token', anonymousToken).send({ email: 'dua@example.test', password: 'kata sandi untuk pengujian' });
  assert.equal((await noMail.post('/api/auth/verification/request').set('Origin', origin).set('X-CSRF-Token', noMailLogin.body.csrfToken)).status, 503);
  await db.close();
});
