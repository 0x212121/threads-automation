import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import pg from 'pg';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import request from 'supertest';
import { bootstrapAdmin, INITIAL_ADMIN_EMAIL } from '../src/bootstrap-admin.js';
import { createApp } from '../src/app.js';

test('wire PostgreSQL lokal menyimpan sesi dan draft dengan store PostgreSQL', async () => {
  const db = new PGlite();
  const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: 1 });
  await socket.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: Number(socket.getServerConn().split(':').at(-1)), user: 'postgres', database: 'postgres', max: 1 });
  const PgStore = connectPgSimple(session);
  const store = new PgStore({ pool, tableName: 'app_sessions', createTableIfMissing: false, pruneSessionInterval: false });
  try {
    for (const name of ['001_content.sql', '002_local_identity.sql', '003_sessions.sql', '006_password_reset.sql', '007_threads_accounts.sql', '009_publication_jobs.sql','011_publication_diagnostics.sql','012_media.sql']) await pool.query(await readFile(`db/migrations/${name}`, 'utf8'));
    await bootstrapAdmin(pool, 'kata sandi untuk pengujian');
    const origin = 'http://127.0.0.1:3000';
    const app = await createApp({ pool, store, origin, secret: 'x'.repeat(48), secure: false, trustProxy: false });
    const agent = request.agent(app);
    const token = (await agent.get('/api/auth/csrf')).body.csrfToken;
    const login = await agent.post('/api/auth/login').set('Origin', origin).set('X-CSRF-Token', token).send({ email: INITIAL_ADMIN_EMAIL, password: 'kata sandi untuk pengujian' });
    assert.equal(login.status, 200);
    const created = await agent.post('/api/posts').set('Origin', origin).set('X-CSRF-Token', login.body.csrfToken).send({ body: 'Draft pada database lokal' });
    assert.equal(created.status, 201);
    assert.equal((await agent.get('/api/posts')).body.posts[0].body, 'Draft pada database lokal');
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM app_sessions')).rows[0].count, 1);
  } finally {
    store.close(); await pool.end(); await socket.stop(); await db.close();
  }
});
