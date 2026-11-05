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

test('pemulihan memakai tautan satu kali dan mencabut seluruh sesi lama', async () => {
  const db = new PGlite();
  for (const name of ['002_local_identity.sql', '006_password_reset.sql']) await db.exec(await readFile(`db/migrations/${name}`, 'utf8'));
  const query = async (text: string, params?: unknown[]) => { const result = await db.query(text, params); return { ...result, rowCount: result.affectedRows ?? result.rows.length }; };
  const pool = { query, connect: async () => ({ query, release: () => {} }) } as unknown as Pool;
  const hash = await hashPassword('kata sandi awal pengujian');
  await db.query("INSERT INTO local_users (id,email,password_hash,role) VALUES ('11111111-1111-4111-8111-111111111111','satu@example.test',$1,'admin')", [hash]);
  const sent: { to: string; text: string }[] = [];
  const transport: MailTransport = { sendMail: async message => { sent.push(message); return { accepted: [message.to], rejected: [] }; } };
  const origin = 'http://localhost:3000';
  const app = await createApp({ pool, store: new session.MemoryStore(), secret: 'a'.repeat(48), origin, secure: false, trustProxy: false, mail: { transport, from: 'pengirim@example.test' } });
  async function login(password: string) {
    const agent = request.agent(app), csrf = (await agent.get('/api/auth/csrf')).body.csrfToken;
    const result = await agent.post('/api/auth/login').set('Origin', origin).set('X-CSRF-Token', csrf).send({ email: 'satu@example.test', password });
    return { agent, result };
  }
  const sessionOne = await login('kata sandi awal pengujian'), sessionTwo = await login('kata sandi awal pengujian');
  assert.equal(sessionOne.result.status, 200); assert.equal(sessionTwo.result.status, 200);
  const resetAgent = request.agent(app), csrf = (await resetAgent.get('/api/auth/csrf')).body.csrfToken;
  const missing = await resetAgent.post('/api/auth/password-reset/request').set('Origin', origin).set('X-CSRF-Token', csrf).send({ email: 'tidak-ada@example.test' });
  const existing = await resetAgent.post('/api/auth/password-reset/request').set('Origin', origin).set('X-CSRF-Token', csrf).send({ email: 'satu@example.test' });
  assert.equal(missing.status, 204); assert.equal(existing.status, 204); assert.equal(sent.length, 1);
  const token = sent[0]?.text.match(/#reset=([A-Za-z0-9_-]{43})/)?.[1]; assert.ok(token);
  const confirm = () => resetAgent.post('/api/auth/password-reset/confirm').set('Origin', origin).set('X-CSRF-Token', csrf).send({ token, password: 'kata sandi baru pengujian' });
  assert.equal((await confirm()).status, 204);
  assert.equal((await sessionOne.agent.get('/api/auth/me')).status, 401);
  assert.equal((await sessionTwo.agent.get('/api/auth/me')).status, 401);
  assert.equal((await login('kata sandi awal pengujian')).result.status, 401);
  assert.equal((await login('kata sandi baru pengujian')).result.status, 200);
  const replayCsrf = (await resetAgent.get('/api/auth/csrf')).body.csrfToken;
  assert.equal((await resetAgent.post('/api/auth/password-reset/confirm').set('Origin', origin).set('X-CSRF-Token', replayCsrf).send({ token, password: 'kata sandi baru pengujian' })).status, 400);
  await db.close();
});
