import pg from 'pg';
import { TokenVault } from './token-vault.js';
import { diagnoseThreadsTokens, diagnoseReplyTarget } from './threads-token-diagnostic.js';

const {DATABASE_URL,PGHOST,THREADS_APP_ID,THREADS_APP_SECRET,THREADS_TOKEN_KEY}=process.env;
if ((!DATABASE_URL && !PGHOST) || !THREADS_APP_ID || !THREADS_APP_SECRET || !THREADS_TOKEN_KEY || !/^[A-Za-z0-9_-]{43}$/.test(THREADS_TOKEN_KEY)) {
  console.error('Konfigurasi database atau Threads belum lengkap.'); process.exit(1);
}
const key=Buffer.from(THREADS_TOKEN_KEY,'base64url');
if (key.length!==32 || key.toString('base64url')!==THREADS_TOKEN_KEY) { console.error('THREADS_TOKEN_KEY tidak valid.'); process.exit(1); }
const pool=new pg.Pool(DATABASE_URL ? {connectionString:DATABASE_URL} : undefined);
try {
  const args=process.argv.slice(2);
  if (args.length && (![2,4].includes(args.length) || args[0]!=='--job' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args[1]!) || (args.length===4 && args[2]!=='--parent-url'))) { console.error('Gunakan check-threads-permissions -- --job UUID [--parent-url URL-POSTING].'); process.exitCode=1; }
  else {
    const vault=new TokenVault(key);
    const result=await diagnoseThreadsTokens(pool,vault,THREADS_APP_ID,THREADS_APP_SECRET);
    const publication=args[1] ? await diagnoseReplyTarget(pool,vault,args[1],fetch,args[3]) : undefined;
    console.log(JSON.stringify({...result,...(publication ? {publication} : {})},null,2));
    if (result.status!=='ok') process.exitCode=1;
  }
} catch { console.error('Pemeriksaan gagal. Periksa koneksi database dan konfigurasi server.'); process.exitCode=1; }
finally { await pool.end(); }
