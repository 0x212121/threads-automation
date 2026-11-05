import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import pg from 'pg';

// Local development only: the database socket is unauthenticated and loopback-only.
const port = Number(process.env.LOCAL_PORT ?? 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('LOCAL_PORT harus 1024-65535.');
const dataRoot = resolve(process.env.LOCAL_DATA_DIR ?? '.local-data');
await mkdir(dataRoot, { recursive: true });
const dataDirectory = resolve(dataRoot, 'postgres');
const db = await PGlite.create(dataDirectory);
const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: 1 });
let child;
let stopping = false;
async function cleanup() {
  if (stopping) return;
  stopping = true;
  if (child && child.exitCode === null) child.kill();
  await socket.stop();
  await db.close();
}
async function execute(script, env) {
  return new Promise((resolvePromise, reject) => {
    child = spawn(process.execPath, [script], { stdio: 'inherit', env });
    child.once('error', reject);
    child.once('exit', (code, signal) => { child = undefined; if (code === 0) resolvePromise(); else reject(new Error(`Proses berhenti (${signal ?? code}).`)); });
  });
}
try {
  await socket.start();
  const pgPort = socket.getServerConn().split(':').at(-1);
  const env = { ...process.env, NODE_ENV: 'development', PGHOST: '127.0.0.1', PGPORT: pgPort, PGUSER: 'postgres', PGDATABASE: 'postgres', PGSSLMODE: 'disable', LOCAL_PGLITE: '1', PORT: String(port), APP_ORIGIN: `http://127.0.0.1:${port}`, SESSION_SECRET: randomBytes(48).toString('base64url') };
  delete env.DATABASE_URL;
  delete env.PGPASSWORD;
  delete env.TRUST_PROXY;
  if (env.THREADS_APP_ID || env.THREADS_APP_SECRET || env.THREADS_TOKEN_KEY) console.log('OAuth Threads dinonaktifkan pada mode HTTP lokal; gunakan deployment HTTPS untuk menghubungkan akun.');
  delete env.THREADS_APP_ID;
  delete env.THREADS_APP_SECRET;
  delete env.THREADS_TOKEN_KEY;
  env.PUBLISH_WORKER_ENABLED = 'false';
  env.MEDIA_DIR = resolve(dataRoot, 'media');
  await execute('dist/migrate.js', env);
  const client = new pg.Client({ host: '127.0.0.1', port: Number(pgPort), user: 'postgres', database: 'postgres' });
  await client.connect();
  const state = await client.query('SELECT initial_admin_id FROM bootstrap_state LIMIT 1');
  await client.end();
  if (state.rowCount === 0) {
    console.log('Penyiapan awal: buat kata sandi administrator di terminal ini.');
    await execute('dist/bootstrap-cli.js', env);
  }
  console.log(`Aplikasi pengembangan lokal: http://127.0.0.1:${port}`);
  console.log(`Data lokal disimpan di ${dataDirectory}. Mode ini hanya untuk pengembangan pada komputer ini.`);
  await execute('dist/server.js', env);
} catch (error) {
  if (!stopping) { console.error(error instanceof Error ? error.message : 'Gagal menjalankan aplikasi lokal.'); process.exitCode = 1; }
} finally { await cleanup(); }
