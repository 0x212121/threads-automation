import test from 'node:test';
import assert from 'node:assert/strict';
import { ThreadsOAuthClient, ThreadsOAuthError } from '../src/threads-oauth-client.js';

test('OAuth menyusun izin minimum dan memeriksa identitas dari respons Meta', async () => {
  const calls: { url: string; options?: RequestInit }[] = [];
  const replies = [
    { access_token: 'short-test', user_id: '123456789' },
    { access_token: 'long-test', expires_in: 3600 },
    { id: '123456789', username: 'akun-test' },
  ];
  const fetcher = (async (url: string | URL | Request, options?: RequestInit) => {
    calls.push({ url: String(url), options }); return new Response(JSON.stringify(replies.shift()), { status: 200 });
  }) as typeof fetch;
  const client = new ThreadsOAuthClient({ appId: '1234', appSecret: 'secret-test', redirectUri: 'https://example.test/auth/callback' }, fetcher);
  const url = new URL(client.authorizationUrl('a'.repeat(43)));
  assert.equal(url.hostname, 'www.threads.com');
  assert.equal(url.searchParams.get('client_id'), '1234');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), 'a'.repeat(43));
  assert.equal(url.searchParams.get('scope'), 'threads_basic,threads_content_publish');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://example.test/auth/callback');
  assert.equal(url.toString().includes('secret-test'), false);
  const result = await client.exchange('code-test');
  assert.equal(result.threadsUserId, '123456789');
  assert.equal(result.token, 'long-test');
  assert.equal(calls.length, 3);
  assert.equal((calls[0]?.options?.body as URLSearchParams).get('redirect_uri'), 'https://example.test/auth/callback');
  assert.equal((calls[1]?.options?.headers as Record<string, string>).Authorization, 'Bearer short-test');
});

test('ID numerik besar dari Meta dipertahankan persis tanpa pembulatan', async () => {
  const replies = [
    '{"access_token":"short-test","user_id":17841405793187219}',
    '{"access_token":"long-test","expires_in":3600}',
    '{"id":"17841405793187219","username":"akun-test"}'
  ];
  const fetcher = (async () => new Response(replies.shift(), { status: 200 })) as typeof fetch;
  const client = new ThreadsOAuthClient({ appId: '1234', appSecret: 'secret-test', redirectUri: 'https://example.test/callback' }, fetcher);
  assert.equal((await client.exchange('code-test')).threadsUserId, '17841405793187219');
});

test('diagnosis hanya membawa tahap dan kode Meta tanpa isi respons sensitif', async () => {
  const fetcher = (async () => new Response(JSON.stringify({ error: { code: 190, message: 'secret-test short-test code-test' } }), { status: 400 })) as typeof fetch;
  const client = new ThreadsOAuthClient({ appId: '1234', appSecret: 'secret-test', redirectUri: 'https://example.test/callback' }, fetcher);
  await assert.rejects(client.exchange('code-test'), error => {
    assert.ok(error instanceof ThreadsOAuthError);
    assert.equal(error.stage, 'code_exchange'); assert.equal(error.httpStatus, 400); assert.equal(error.metaCode, 190);
    assert.equal(JSON.stringify(error).includes('secret-test'), false);
    assert.equal(error.message.includes('code-test'), false);
    return true;
  });
});

test('identitas berbeda dan kesalahan jaringan ditolak tanpa membocorkan secret', async () => {
  const replies = [{ access_token: 'short-test', user_id: '123' }, { access_token: 'long-test', expires_in: 3600 }, { id: '456', username: 'akun-test' }];
  const fetcher = (async () => new Response(JSON.stringify(replies.shift()), { status: 200 })) as typeof fetch;
  const config = { appId: '1234', appSecret: 'secret-test', redirectUri: 'https://example.test/auth/callback' };
  await assert.rejects(new ThreadsOAuthClient(config, fetcher).exchange('code-test'), /tidak cocok/);
  const failing = (async () => { throw new Error('secret-test'); }) as typeof fetch;
  await assert.rejects(new ThreadsOAuthClient(config, failing).exchange('code-test'), error => error instanceof Error && !error.message.includes('secret-test'));
  assert.throws(() => new ThreadsOAuthClient({ ...config, redirectUri: 'http://example.test/callback' }));
});
