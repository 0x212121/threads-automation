import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import session from 'express-session';
import request from 'supertest';
import type { Pool } from 'pg';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/password.js';
import { ThreadsOAuthClient } from '../src/threads-oauth-client.js';
import { TokenVault } from '../src/token-vault.js';

test('OAuth Threads terikat pada sesi admin, sekali pakai, dan token tidak terekspos', async t => {
  const logs = t.mock.method(console, 'error', () => {});
  const db = new PGlite();
  for (const file of ['001_content.sql', '002_local_identity.sql', '006_password_reset.sql', '007_threads_accounts.sql', '008_threads_oauth_states.sql']) await db.exec(await readFile(`db/migrations/${file}`, 'utf8'));
  const query = async (sql: string, params?: unknown[]) => { const result = await db.query(sql, params); return { ...result, rowCount: result.affectedRows ?? result.rows.length }; };
  const pool = { query, connect: async () => ({ query, release: () => {} }) } as unknown as Pool;
  const password = 'kata sandi untuk pengujian', hash = await hashPassword(password);
  await db.query("INSERT INTO local_users (id,email,password_hash,role,email_verified_at) VALUES ('11111111-1111-4111-8111-111111111111','admin@example.test',$1,'admin',now()),('22222222-2222-4222-8222-222222222222','editor@example.test',$1,'editor',now())", [hash]);
  const replies: unknown[] = [{ access_token: 'short-token-test', user_id: '123456' }, { access_token: 'long-token-test', expires_in: 3600 }, { id: '123456', username: 'akun-test' }];
  let exchanges = 0;
  const fetcher = (async () => { exchanges++; const value = replies.shift(); return new Response(JSON.stringify(value), { status: value && typeof value === 'object' && 'error' in value ? 400 : 200 }); }) as typeof fetch;
  const oauth = new ThreadsOAuthClient({ appId: '1234', appSecret: 'test-only-secret', redirectUri: 'https://example.test/api/threads/oauth/callback' }, fetcher);
  const origin = 'http://localhost:3000';
  const app = await createApp({ pool, store: new session.MemoryStore(), secret: 'a'.repeat(48), origin, secure: false, trustProxy: false, threads: { client: oauth, vault: new TokenVault(Buffer.alloc(32, 7)) } });
  assert.equal((await request(app).get('/api/threads/oauth/callback').query({ code: 'secret-code-test', state: 'a'.repeat(43) })).headers.location, '/#threads=failed&reason=session');
  async function login(email: string) {
    const agent = request.agent(app), csrf = (await agent.get('/api/auth/csrf')).body.csrfToken;
    const result = await agent.post('/api/auth/login').set('Origin', origin).set('X-CSRF-Token', csrf).send({ email, password });
    assert.equal(result.status, 200); return { agent, csrf: result.body.csrfToken };
  }
  const admin = await login('admin@example.test'), otherSession = await login('admin@example.test'), editor = await login('editor@example.test');
  assert.equal((await editor.agent.post('/api/threads/oauth/start').set('Origin', origin).set('X-CSRF-Token', editor.csrf)).status, 403);
  assert.equal((await admin.agent.post('/api/threads/oauth/start').set('Origin', origin).set('X-CSRF-Token', 'salah')).status, 403);
  const started = await admin.agent.post('/api/threads/oauth/start').set('Origin', origin).set('X-CSRF-Token', admin.csrf);
  assert.equal(started.status, 200);
  const state = new URL(started.body.authorizationUrl).searchParams.get('state'); assert.ok(state);
  assert.equal((await otherSession.agent.get('/api/threads/oauth/callback').query({ state, code: 'code-test' })).headers.location, '/#threads=failed&reason=session');
  assert.equal(exchanges, 0);
  const callback = await admin.agent.get('/api/threads/oauth/callback').query({ state, code: 'code-test' });
  assert.equal(callback.status, 303); assert.equal(callback.headers.location, '/#threads=connected');
  assert.equal(callback.headers['referrer-policy'], 'no-referrer');
  assert.equal((await admin.agent.get('/api/threads/oauth/callback').query({ state, code: 'code-test' })).headers.location, '/#threads=failed&reason=session');
  assert.equal(exchanges, 3);
  const accounts = await editor.agent.get('/api/threads/accounts');
  assert.equal(accounts.body.accounts[0].username, 'akun-test');
  assert.equal(JSON.stringify(accounts.body).includes('long-token-test'), false);
  const encrypted = await db.query<{ encrypted_token: Uint8Array }>('SELECT encrypted_token FROM threads_accounts');
  assert.equal(Buffer.from(encrypted.rows[0]!.encrypted_token).includes(Buffer.from('long-token-test')), false);
  const expiring = await admin.agent.post('/api/threads/oauth/start').set('Origin', origin).set('X-CSRF-Token', admin.csrf);
  const stale = new URL(expiring.body.authorizationUrl).searchParams.get('state'); assert.ok(stale);
  await db.query("UPDATE threads_oauth_states SET expires_at=now()-interval '1 second'");
  assert.equal((await admin.agent.get('/api/threads/oauth/callback').query({ state: stale, code: 'code-test' })).headers.location, '/#threads=failed&reason=session');
  assert.equal(exchanges, 3);
  const denied = await admin.agent.post('/api/threads/oauth/start').set('Origin', origin).set('X-CSRF-Token', admin.csrf);
  const deniedState = new URL(denied.body.authorizationUrl).searchParams.get('state');
  assert.equal((await admin.agent.get('/api/threads/oauth/callback').query({ state: deniedState, error: 'access_denied' })).headers.location, '/#threads=failed&reason=denied');
  assert.equal(exchanges, 3);
  const broken = await admin.agent.post('/api/threads/oauth/start').set('Origin', origin).set('X-CSRF-Token', admin.csrf);
  const brokenState = new URL(broken.body.authorizationUrl).searchParams.get('state');
  // No more simulated token responses: malformed JSON must identify code exchange.
  assert.equal((await admin.agent.get('/api/threads/oauth/callback').query({ state: brokenState, code: 'secret-code-test' })).headers.location, '/#threads=failed&reason=code_exchange');
  for (const stage of ['code_exchange', 'long_token', 'profile']) {
    if (stage !== 'code_exchange') replies.push({ access_token: 'short-token-test', user_id: '123456' });
    if (stage === 'profile') replies.push({ access_token: 'long-token-test', expires_in: 3600 });
    replies.push({ error: { code: 190, message: 'test-only-secret long-token-test secret-code-test' } });
    const start = await admin.agent.post('/api/threads/oauth/start').set('Origin', origin).set('X-CSRF-Token', admin.csrf);
    const nextState = new URL(start.body.authorizationUrl).searchParams.get('state');
    const failed = await admin.agent.get('/api/threads/oauth/callback').query({ state: nextState, code: 'secret-code-test' });
    assert.equal(failed.headers.location, `/#threads=failed&reason=${stage}&meta_code=190`);
    assert.equal(failed.headers.location.includes('secret-code-test'), false);
  }
  assert.equal((await db.query('SELECT id FROM threads_accounts')).rows.length, 1);
  const logged = JSON.stringify(logs.mock.calls.map(call => call.arguments));
  assert.equal(logged.includes('secret-code-test'), false); assert.equal(logged.includes('long-token-test'), false); assert.equal(logged.includes('test-only-secret'), false);
  await db.close();
});
