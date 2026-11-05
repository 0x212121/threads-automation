type Fetcher = typeof fetch;
export class ThreadsOAuthError extends Error {}
export type ThreadsOAuthConfig = { appId: string; appSecret: string; redirectUri: string };

// External responses are untrusted; errors deliberately avoid returning request URLs or secrets.
export class ThreadsOAuthClient {
  constructor(private readonly config: ThreadsOAuthConfig, private readonly request: Fetcher = fetch) {
    if (!/^[0-9]+$/.test(config.appId) || !config.appSecret) throw new ThreadsOAuthError('Konfigurasi Meta tidak valid.');
    const callback = new URL(config.redirectUri);
    if (callback.protocol !== 'https:' || callback.username || callback.password || callback.hash || callback.search) throw new ThreadsOAuthError('Redirect URI harus HTTPS tanpa kredensial, query, atau fragment.');
  }
  authorizationUrl(state: string): string {
    if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new ThreadsOAuthError('State OAuth tidak valid.');
    const url = new URL('https://threads.net/oauth/authorize');
    url.search = new URLSearchParams({ client_id: this.config.appId, redirect_uri: this.config.redirectUri, scope: 'threads_basic,threads_content_publish', response_type: 'code', state }).toString();
    return url.toString();
  }
  async exchange(code: string): Promise<{ threadsUserId: string; username: string; token: string; expiresAt: Date }> {
    if (!code || code.length > 4096) throw new ThreadsOAuthError('Kode otorisasi tidak valid.');
    const form = new URLSearchParams({ client_id: this.config.appId, client_secret: this.config.appSecret, grant_type: 'authorization_code', redirect_uri: this.config.redirectUri, code });
    const short = await this.json('https://graph.threads.net/oauth/access_token', { method: 'POST', body: form });
    const shortToken = this.stringField(short, 'access_token');
    const idValue = short.user_id;
    const id = typeof idValue === 'string' ? idValue : typeof idValue === 'number' && Number.isSafeInteger(idValue) ? String(idValue) : '';
    if (!/^[0-9]+$/.test(id)) throw new ThreadsOAuthError('Identitas Meta tidak valid.');
    const longUrl = new URL('https://graph.threads.net/access_token');
    longUrl.search = new URLSearchParams({ grant_type: 'th_exchange_token', client_secret: this.config.appSecret }).toString();
    const long = await this.json(longUrl.toString(), { headers: { Authorization: `Bearer ${shortToken}` } });
    const token = this.stringField(long, 'access_token');
    if (typeof long.expires_in !== 'number' || !Number.isSafeInteger(long.expires_in) || long.expires_in <= 0 || long.expires_in > 10 * 365 * 24 * 60 * 60) throw new ThreadsOAuthError('Masa berlaku token Meta tidak valid.');
    const me = await this.json('https://graph.threads.net/me?fields=id%2Cusername', { headers: { Authorization: `Bearer ${token}` } });
    const profileId = this.stringField(me, 'id');
    const username = this.stringField(me, 'username');
    if (profileId !== id || username.length > 255) throw new ThreadsOAuthError('Identitas profil tidak cocok.');
    return { threadsUserId: id, username, token, expiresAt: new Date(Date.now() + long.expires_in * 1000) };
  }
  private stringField(object: Record<string, unknown>, key: string): string {
    const value = object[key];
    if (typeof value !== 'string' || !value.trim()) throw new ThreadsOAuthError('Respons Meta tidak lengkap.');
    return value;
  }
  private async json(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    try {
      const response = await this.request(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new ThreadsOAuthError('Permintaan ke Meta gagal.');
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ThreadsOAuthError('Respons Meta tidak valid.');
      return data as Record<string, unknown>;
    } catch { throw new ThreadsOAuthError('Otorisasi Meta tidak dapat diselesaikan.'); }
  }
}
