import pg from 'pg';
import { TokenVault } from './token-vault.js';
import { repairFirstReplyTarget } from './threads-reference-repair.js';

const args=process.argv.slice(2);
if (![4,5].includes(args.length) || args[0]!=='--job' || args[2]!=='--parent-url' || (args.length===5 && args[4]!=='--apply')) {
  console.error('Gunakan repair-threads-parent -- --job UUID --parent-url URL-POSTING [--apply]. Tanpa --apply hanya memeriksa.'); process.exit(1);
}
const {DATABASE_URL,PGHOST,THREADS_TOKEN_KEY}=process.env;
if ((!DATABASE_URL && !PGHOST) || !THREADS_TOKEN_KEY || !/^[A-Za-z0-9_-]{43}$/.test(THREADS_TOKEN_KEY)) {console.error('Konfigurasi database atau kunci token belum lengkap.');process.exit(1);}
const key=Buffer.from(THREADS_TOKEN_KEY,'base64url');
if (key.length!==32 || key.toString('base64url')!==THREADS_TOKEN_KEY) {console.error('Kunci token tidak valid.');process.exit(1);}
const pool=new pg.Pool(DATABASE_URL ? {connectionString:DATABASE_URL} : undefined);
try {
  const result=await repairFirstReplyTarget(pool,new TokenVault(key),args[1]!,args[3]!,args[4]==='--apply');
  console.log(JSON.stringify(result,null,2));
  if (!['repaired','already_correct','ready_to_repair'].includes(result.status)) process.exitCode=2;
} catch {console.error('Pemulihan tidak dapat diselesaikan. Periksa konfigurasi dan migrasi database.');process.exitCode=1;}
finally {await pool.end();}
