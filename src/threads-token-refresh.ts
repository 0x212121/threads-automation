import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { TokenVault } from './token-vault.js';

type Account = { id: string; threads_user_id: string; encrypted_token: Buffer; token_iv: Buffer; token_tag: Buffer; refresh_failures: number };

// Refresh only unexpired long-lived tokens. Never persist provider messages or token URLs.
export async function refreshOneToken(pool: Pool, vault: TokenVault, request: typeof fetch = fetch): Promise<boolean> {
  const lease = randomUUID();
  const claimed = await pool.query<Account>(`UPDATE threads_accounts SET refresh_lease=$1, refresh_lease_until=now()+interval '2 minutes'
    WHERE id=(SELECT id FROM threads_accounts WHERE status='active' AND token_expires_at>now()
      AND token_expires_at<=now()+interval '14 days' AND refresh_status<>'reconnect'
      AND (token_issued_at IS NULL OR token_issued_at<=now()-interval '24 hours')
      AND (refresh_next_attempt_at IS NULL OR refresh_next_attempt_at<=now())
      AND (refresh_lease_until IS NULL OR refresh_lease_until<=now())
      ORDER BY token_expires_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id,threads_user_id,encrypted_token,token_iv,token_tag,refresh_failures`, [lease]);
  const account = claimed.rows[0];
  if (!account) return false;
  let token: string;
  try { token = vault.open({ ciphertext: account.encrypted_token, iv: account.token_iv, tag: account.token_tag }, `${account.id}:${account.threads_user_id}`); }
  catch { await failed('reconnect'); return true; }
  try {
    const url = new URL('https://graph.threads.net/refresh_access_token');
    url.searchParams.set('grant_type', 'th_refresh_token');
    const response = await request(url.toString(), { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) { await failed(response.status === 429 || response.status >= 500 ? 'retry' : 'reconnect'); return true; }
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !('access_token' in data) || typeof data.access_token !== 'string' || !data.access_token || !('expires_in' in data) || typeof data.expires_in !== 'number' || !Number.isSafeInteger(data.expires_in) || data.expires_in <= 0 || data.expires_in > 10 * 365 * 24 * 60 * 60) { await failed('retry'); return true; }
    const sealed = vault.seal(data.access_token, `${account.id}:${account.threads_user_id}`);
    const updated = await pool.query(`UPDATE threads_accounts SET encrypted_token=$4,token_iv=$5,token_tag=$6,token_expires_at=now()+$7*interval '1 second',token_issued_at=now(),
      refresh_lease=NULL,refresh_lease_until=NULL,refresh_next_attempt_at=NULL,refresh_failures=0,refresh_status='ok',updated_at=now()
      WHERE id=$1 AND refresh_lease=$2 AND status='active' AND token_iv=$3 AND now()+$7*interval '1 second'>token_expires_at`, [account.id,lease,account.token_iv,sealed.ciphertext,sealed.iv,sealed.tag,data.expires_in]);
    if (!updated.rowCount) await failed('retry');
  } catch { await failed('retry'); }
  return true;

  async function failed(status: 'retry' | 'reconnect') {
    const delay = Math.min(86400, 900 * 2 ** Math.min(account!.refresh_failures, 7));
    await pool.query(`UPDATE threads_accounts SET refresh_lease=NULL,refresh_lease_until=NULL,refresh_status=$4,
      refresh_failures=refresh_failures+1,refresh_next_attempt_at=now()+$5*interval '1 second'
      WHERE id=$1 AND refresh_lease=$2 AND status='active' AND token_iv=$3`, [account!.id,lease,account!.token_iv,status,delay]);
  }
}

export function startTokenRefreshWorker(pool: Pool, vault: TokenVault): () => void {
  let running = false, stopped = false;
  const run = async () => {
    if (running || stopped) return;
    running = true;
    try { for (let count = 0; count < 50 && !stopped && await refreshOneToken(pool,vault); count++) {} }
    catch { console.error('Pembaruan token Threads gagal; akan dicoba kembali.'); }
    finally { running = false; }
  };
  const timer = setInterval(() => { void run(); }, 15 * 60 * 1000);
  void run();
  return () => { stopped = true; clearInterval(timer); };
}
