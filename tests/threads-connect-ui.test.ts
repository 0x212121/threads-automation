import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check()) { if (Date.now() > deadline) throw new Error('Status koneksi tidak diperbarui.'); await new Promise(resolve => setTimeout(resolve, 10)); }
}

for (const scenario of ['ready', 'unverified', 'missing-config', 'server-error', 'verified-elsewhere', 'missing-client-id', 'callback-failure'] as const) {
  test(`klik koneksi Threads: ${scenario}`, async () => {
    const [html, script] = await Promise.all([readFile('public/index.html', 'utf8'), readFile('public/app.js', 'utf8')]);
    const dom = new JSDOM(html, { url: scenario === 'callback-failure' ? 'https://example.test/#threads=failed&reason=long_token&meta_code=100&meta_subcode=10&meta_reason=tester_or_review' : 'https://example.test', runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
    try {
      let clicks = false;
      const calls: string[] = [];
      const target = new URL('https://www.threads.com/oauth/authorize');
      target.search = new URLSearchParams({ client_id: '123', state: 'a'.repeat(43), response_type: 'code', redirect_uri: 'https://example.test/api/threads/oauth/callback', scope: 'threads_basic,threads_content_publish,threads_manage_replies,threads_read_replies' }).toString();
      if (scenario === 'missing-client-id') target.searchParams.delete('client_id');
      const authorizationUrl = target.toString();
      dom.window.fetch = (async (path: string, init?: RequestInit) => {
        calls.push(path);
        let value: unknown = {}, status = 200;
        if (path === '/api/auth/csrf') value = { csrfToken: 'csrf-test' };
        else if (path === '/api/auth/me') value = { user: { id: 'admin', role: 'admin', email: 'admin@example.test', emailVerified: scenario !== 'unverified' && (scenario !== 'verified-elsewhere' || clicks) } };
        else if (path === '/api/team/settings') value = {timeZone:'Asia/Makassar',revision:1};
        else if (path === '/api/threads/config') value = { configured: scenario !== 'missing-config', publishingEnabled: false };
        else if (path === '/api/threads/accounts') value = { accounts: [] };
        else if (path.startsWith('/api/posts')) value = { posts: [], nextOffset: null };
        else if (path === '/api/threads/oauth/start') {
          assert.equal(init?.method, 'POST');
          assert.equal((init?.headers as Record<string, string>)['X-CSRF-Token'], 'csrf-test');
          value = scenario === 'server-error' ? { error: 'Koneksi sedang tidak tersedia.' } : { authorizationUrl };
          status = scenario === 'server-error' ? 503 : 200;
        } else throw new Error('Endpoint tidak diharapkan.');
        return new Response(JSON.stringify(value), { status });
      }) as typeof fetch;
      dom.window.eval(script);
      const get = (selector: string) => dom.window.document.querySelector(selector) as HTMLElement;
      await waitFor(() => !get('#workspace').hidden && get('#loading').hidden);
      if (scenario === 'callback-failure') {
        assert.match(get('#threads-connect-error').textContent ?? '', /Token jangka panjang/);
        assert.match(get('#threads-connect-error').textContent ?? '', /Kode Meta: 100/);
        assert.match(get('#threads-connect-error').textContent ?? '', /Subkode Meta: 10/);
        assert.match(get('#threads-connect-error').textContent ?? '', /Threads Tester/);
        assert.equal(dom.window.location.hash, '');
      }
      const button = get('#connect-threads') as HTMLButtonElement;
      assert.equal(button.disabled, false);
      clicks = true; button.click();
      await waitFor(() => !button.disabled);
      if (scenario === 'ready' || scenario === 'verified-elsewhere' || scenario === 'callback-failure') {
        assert.equal((get('#continue-threads') as HTMLAnchorElement).href, authorizationUrl);
        assert.equal(get('#continue-threads').hidden, false);
        assert.equal(calls.filter(path => path === '/api/threads/oauth/start').length, 1);
      } else {
        assert.equal(get('#threads-connect-error').hidden, false);
        assert.equal(get('#continue-threads').hidden, true);
        assert.match(get('#threads-connect-error').textContent ?? '', scenario === 'unverified' ? /Verifikasi email/ : scenario === 'missing-config' ? /THREADS_APP_ID/ : scenario === 'missing-client-id' ? /Parameter otorisasi/ : /tidak tersedia/);
        assert.equal(calls.filter(path => path === '/api/threads/oauth/start').length, scenario === 'server-error' || scenario === 'missing-client-id' ? 1 : 0);
      }
    } finally { dom.window.close(); }
  });
}
