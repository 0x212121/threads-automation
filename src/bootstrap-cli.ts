import pg from 'pg';
import { bootstrapAdmin, INITIAL_ADMIN_EMAIL } from './bootstrap-admin.js';

function readSecret(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) { reject(new Error('Perintah ini memerlukan terminal interaktif; input dari pipe tidak didukung.')); return; }
    const input = process.stdin;
    let value = '';
    process.stdout.write(prompt);
    input.setEncoding('utf8');
    input.setRawMode(true);
    input.resume();
    const finish = () => { input.off('data', onData); input.setRawMode(false); input.pause(); process.stdout.write('\n'); };
    const onData = (data: string | Buffer) => {
      for (const char of data.toString()) {
        if (char === '\u0003') { finish(); reject(new Error('Dibatalkan.')); return; }
        if (char === '\r' || char === '\n') { finish(); resolve(value); return; }
        if (char === '\u007f' || char === '\b') value = Array.from(value).slice(0, -1).join('');
        else if (char >= ' ' && char !== '\u001b') value += char;
      }
    };
    input.on('data', onData);
  });
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl && !process.env.PGHOST) throw new Error('DATABASE_URL atau PGHOST wajib diatur.');
if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Perintah ini memerlukan terminal interaktif.');
const password = await readSecret(`Kata sandi untuk ${INITIAL_ADMIN_EMAIL}: `);
const confirmation = await readSecret('Ulangi kata sandi: ');
if (password !== confirmation) throw new Error('Kata sandi tidak cocok.');
const pool = new pg.Pool(databaseUrl ? { connectionString: databaseUrl } : undefined);
try {
  await bootstrapAdmin(pool, password);
  console.log('Administrator awal dibuat. Email masih perlu diverifikasi sebelum menghubungkan Threads atau menerbitkan konten.');
} finally { await pool.end(); }
