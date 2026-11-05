import test from 'node:test';
import assert from 'node:assert/strict';
import { ContainerCreationError, PublicationUncertainError, ThreadsPublisher } from '../src/threads-publisher.js';

test('container teks dibuat tanpa publikasi otomatis dan dipublikasikan terpisah', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify({ id: calls.length === 1 ? '123' : '456' }), { status: 200 }); }) as typeof fetch;
  const publisher = new ThreadsPublisher(fetcher);
  assert.equal(await publisher.createTextContainer('secret-test', 'Isi konten'), '123');
  assert.equal(await publisher.publishContainer('secret-test', '123'), '456');
  assert.equal((calls[0]?.init?.body as URLSearchParams).has('auto_publish_text'), false);
  assert.equal((calls[1]?.init?.body as URLSearchParams).get('creation_id'), '123');
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
});
