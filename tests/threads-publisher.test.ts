import test from 'node:test';
import assert from 'node:assert/strict';
import { ContainerCreationError, PublicationUncertainError, ThreadsPublisher } from '../src/threads-publisher.js';

test('container teks dibuat tanpa publikasi otomatis dan dipublikasikan terpisah', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify({ id: calls.length === 1 ? '123' : '456' }), { status: 200 }); }) as typeof fetch;
  const publisher = new ThreadsPublisher(fetcher);
  assert.equal(await publisher.createTextContainer('secret-test', 'Isi konten'), '123');
  assert.equal(await publisher.publishContainer('secret-test', '123'), '456');
  assert.equal(new URL(calls[0]!.url).searchParams.has('auto_publish_text'), false);
  assert.equal(new URL(calls[0]!.url).searchParams.get('text'), 'Isi konten');
  assert.equal(new URL(calls[0]!.url).searchParams.get('media_type'), 'TEXT');
  assert.equal(new URL(calls[1]!.url).searchParams.get('creation_id'), '123');
  assert.equal(calls[0]?.url.includes('secret-test'), false);
  assert.equal(calls[1]?.url.includes('secret-test'), false);
});

test('timeout atau respons gagal setelah publikasi selalu ditandai tidak pasti', async () => {
  const failed = (async () => { throw new Error('secret-test'); }) as typeof fetch;
  const publisher = new ThreadsPublisher(failed);
  await assert.rejects(publisher.createTextContainer('secret-test', 'Isi'), error => error instanceof ContainerCreationError && error.retryable && !error.message.includes('secret-test'));
  await assert.rejects(publisher.publishContainer('secret-test', '123'), error => error instanceof PublicationUncertainError && !error.message.includes('secret-test'));
  const badReply = new ThreadsPublisher((async () => new Response('{}', { status: 200 })) as typeof fetch);
  await assert.rejects(badReply.publishContainer('secret-test', '123'), PublicationUncertainError);
  const rejected = new ThreadsPublisher((async () => new Response('{}', { status: 400 })) as typeof fetch);
  await assert.rejects(rejected.createTextContainer('secret-test', 'Isi'), error => error instanceof ContainerCreationError && !error.retryable);
  const forbidden = new ThreadsPublisher((async () => new Response('{"error":{"message":"secret-test"}}', { status: 403 })) as typeof fetch);
  await assert.rejects(forbidden.createTextContainer('secret-test', 'Isi'), error => error instanceof ContainerCreationError && error.reason === 'meta_auth' && !error.message.includes('secret-test'));
});

test('media dikirim dengan URL HTTPS sesuai tipe dan status diperiksa sebelum publikasi', async () => {
  const urls: URL[] = [];
  const fetcher = (async (url: string | URL | Request) => {
    urls.push(new URL(String(url)));
    return new Response(urls.length === 3 ? '{"status":"FINISHED"}' : '{"id":"123"}', { status: 200 });
  }) as typeof fetch;
  const publisher = new ThreadsPublisher(fetcher);
  const source = 'https://example.test/media-fetch/temporary-signature';
  await publisher.createMediaContainer('token-test','caption','IMAGE',source);
  await publisher.createMediaContainer('token-test','','VIDEO',source);
  assert.equal(urls[0]?.searchParams.get('image_url'),source);
  assert.equal(urls[0]?.searchParams.get('text'),'caption');
  assert.equal(urls[1]?.searchParams.get('video_url'),source);
  assert.equal(urls[1]?.searchParams.has('text'),false);
  assert.equal(await publisher.containerStatus('token-test','123'),'FINISHED');
  assert.equal(urls[2]?.searchParams.get('fields'),'status');
  await assert.rejects(publisher.createMediaContainer('token-test','','IMAGE','http://example.test/file'));
});
