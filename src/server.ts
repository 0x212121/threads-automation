import pg from 'pg';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { createApp } from './app.js';
import { createSmtpTransport } from './smtp.js';
import { ThreadsOAuthClient } from './threads-oauth-client.js';
import { TokenVault } from './token-vault.js';
import { startPublicationWorker } from './publication-worker.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl && !process.env.PGHOST) throw new Error('DATABASE_URL atau PGHOST wajib diatur.');
const pool = new pg.Pool({ ...(databaseUrl ? { connectionString: databaseUrl } : {}), ...(process.env.LOCAL_PGLITE === '1' ? { max: 1 } : {}) });
const secret = process.env.SESSION_SECRET;
const origin = process.env.APP_ORIGIN;
if (!secret || !origin) throw new Error('SESSION_SECRET dan APP_ORIGIN wajib diatur.');
const production = process.env.NODE_ENV === 'production';
const PgStore = connectPgSimple(session);
const store = new PgStore({ pool, tableName: 'app_sessions', createTableIfMissing: false });
let mail: Parameters<typeof createApp>[0]['mail'];
if (process.env.SMTP_HOST) {
  const secure = process.env.SMTP_SECURE === 'true';
  if (process.env.SMTP_SECURE && !['true', 'false'].includes(process.env.SMTP_SECURE)) throw new Error('SMTP_SECURE harus true atau false.');
  const config = { host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? (secure ? 465 : 587)), secure, from: process.env.SMTP_FROM ?? '', username: process.env.SMTP_USER, password: process.env.SMTP_PASSWORD };
  mail = { transport: createSmtpTransport(config), from: config.from };
}
let threads: Parameters<typeof createApp>[0]['threads'];
const { THREADS_APP_ID: threadsId, THREADS_APP_SECRET: threadsSecret, THREADS_TOKEN_KEY: tokenKey } = process.env;
if (threadsId || threadsSecret || tokenKey) {
  if (!threadsId || !threadsSecret || !tokenKey || !/^[A-Za-z0-9_-]{43}$/.test(tokenKey)) throw new Error('THREADS_APP_ID, THREADS_APP_SECRET, dan THREADS_TOKEN_KEY 32 byte dalam base64url wajib diatur bersama.');
  const key = Buffer.from(tokenKey, 'base64url');
  if (key.length !== 32 || key.toString('base64url') !== tokenKey) throw new Error('THREADS_TOKEN_KEY tidak valid.');
  threads = { client: new ThreadsOAuthClient({ appId: threadsId, appSecret: threadsSecret, redirectUri: `${origin}/api/threads/oauth/callback` }), vault: new TokenVault(key) };
}
const publishingEnabled = process.env.PUBLISH_WORKER_ENABLED === 'true';
if (process.env.PUBLISH_WORKER_ENABLED && !['true', 'false'].includes(process.env.PUBLISH_WORKER_ENABLED)) throw new Error('PUBLISH_WORKER_ENABLED harus true atau false.');
if (publishingEnabled && !threads) throw new Error('Worker publikasi memerlukan konfigurasi Threads.');
const app = await createApp({ pool, store, secret, origin, secure: production, trustProxy: process.env.TRUST_PROXY === '1', mail, threads, publishingEnabled });

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT tidak valid.');
const server = app.listen(port, process.env.LOCAL_PGLITE === '1' ? '127.0.0.1' : '0.0.0.0', () => console.log(`Service listening on ${port}`));
const stopWorker = publishingEnabled && threads ? startPublicationWorker(pool, threads.vault) : () => {};
async function stop() {
  stopWorker(); server.close(async () => { await pool.end(); process.exit(0); });
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
