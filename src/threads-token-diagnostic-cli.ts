import pg from 'pg';
import { TokenVault } from './token-vault.js';
import { diagnoseThreadsTokens } from './threads-token-diagnostic.js';

const {DATABASE_URL,PGHOST,THREADS_APP_ID,THREADS_APP_SECRET,THREADS_TOKEN_KEY}=process.env;
if ((!DATABASE_URL && !PGHOST) || !THREADS_APP_ID || !THREADS_APP_SECRET || !THREADS_TOKEN_KEY || !/^[A-Za-z0-9_-]{43}$/.test(THREADS_TOKEN_KEY)) {
  console.error('Konfigurasi database atau Threads belum lengkap.'); process.exit(1);
}
const key=Buffer.from(THREADS_TOKEN_KEY,'base64url');
if (key.length!==32 || key.toString('base64url')!==THREADS_TOKEN_KEY) { console.error('THREADS_TOKEN_KEY tidak valid.'); process.exit(1); }
const pool=new pg.Pool(DATABASE_URL ? {connectionString:DATABASE_URL} : undefined);
try {
  const result=await diagnoseThreadsTokens(pool,new TokenVault(key),THREADS_APP_ID,THREADS_APP_SECRET);
  console.log(JSON.stringify(result,null,2));
  if (result.status!=='ok') process.exitCode=1;
} catch { console.error('Pemeriksaan gagal. Periksa koneksi database dan konfigurasi server.'); process.exitCode=1; }
finally { await pool.end(); }
