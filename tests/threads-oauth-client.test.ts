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
  const longRequest = new URL(calls[1]!.url);
  assert.equal(longRequest.pathname, '/access_token');
  assert.equal(longRequest.searchParams.get('grant_type'), 'th_exchange_token');
  assert.equal(longRequest.searchParams.get('client_secret'), 'secret-test');
  assert.equal(longRequest.searchParams.get('access_token'), 'short-test');
  assert.equal(calls[1]?.options?.method, 'GET');
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

test('penolakan akses pengujian Meta menghasilkan kategori aman dan subkode', async () => {
  let count = 0;
  const fetcher = (async () => {
    if (++count === 1) return new Response('{"access_token":"short-test","user_id":"123"}', { status: 200 });
    return new Response(JSON.stringify({ error: { code: 100, error_subcode: 10, message: 'You must submit for app review, or your user must be in the list of Threads testers. secret-test short-test' } }), { status: 400 });
  }) as typeof fetch;
  const client = new ThreadsOAuthClient({ appId: '1234', appSecret: 'secret-test', redirectUri: 'https://example.test/callback' }, fetcher);
  await assert.rejects(client.exchange('code-test'), error => {
    assert.ok(error instanceof ThreadsOAuthError);
    assert.equal(error.stage, 'long_token'); assert.equal(error.metaCode, 100); assert.equal(error.metaSubcode, 10); assert.equal(error.metaReason, 'tester_or_review');
    const output = error.message + JSON.stringify(error);
    assert.equal(output.includes('secret-test'), false); assert.equal(output.includes('short-test'), false); assert.equal(output.includes('You must submit'), false);
    return true;
  });
});

test('kegagalan transport token jangka panjang tidak membocorkan URL berkredensial', async () => {
  let count = 0;
  let observedToken: string | null = null;
  const fetcher = (async (url: string | URL | Request) => {
    if (++count === 1) return new Response('{"access_token":"short+/test=&","user_id":"123"}', { status: 200 });
    const requestUrl = new URL(String(url));
    observedToken = requestUrl.searchParams.get('access_token');
    throw new Error(String(url));
  }) as typeof fetch;
  const client = new ThreadsOAuthClient({ appId: '1234', appSecret: 'secret-test', redirectUri: 'https://example.test/callback' }, fetcher);
  await assert.rejects(client.exchange('code-test'), error => {
    assert.ok(error instanceof ThreadsOAuthError); assert.equal(error.stage, 'long_token');
    const output = error.message + JSON.stringify(error);
    for (const secret of ['secret-test', 'short+/test=&', 'short%2B%2Ftest', 'code-test']) assert.equal(output.includes(secret), false);
    return true;
  });
  assert.equal(count, 2);
  assert.equal(observedToken, 'short+/test=&');
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
