import type { Pool } from 'pg';
import { TokenVault } from './token-vault.js';
import { PublicationQueue } from './publication-queue.js';
import { ContainerCreationError, ThreadsPublisher } from './threads-publisher.js';

export async function processPublication(queue: PublicationQueue, vault: TokenVault, publisher: ThreadsPublisher): Promise<boolean> {
  await queue.recover();
  const job = await queue.claim();
  if (!job) return false;
  const payload = await queue.payload(job.id, job.lease_token);
  if (!payload) { await queue.needsAction(job.id, job.lease_token); return true; }
  let token: string;
  try { token = vault.open({ ciphertext: payload.encrypted_token, iv: payload.token_iv, tag: payload.token_tag }, `${job.account_id}:${payload.threads_user_id}`); }
  catch { await queue.needsAction(job.id, job.lease_token, 'token_unreadable'); return true; }
  let container = job.container_id;
  if (job.status === 'preparing') {
    try { container = await publisher.createTextContainer(token, payload.body); }
    catch (error) { await queue.preparationFailed(job.id, job.lease_token, error instanceof ContainerCreationError && error.retryable, error instanceof ContainerCreationError ? error.reason : 'meta_rejected'); return true; }
    if (!await queue.markPrepared(job.id, job.lease_token, container)) return true;
  }
  if (!container) { await queue.needsAction(job.id, job.lease_token); return true; }
  if (!await queue.beginPublish(job.id, job.lease_token)) { await queue.needsAction(job.id, job.lease_token); return true; }
  try { await queue.markPublished(job.id, job.lease_token, await publisher.publishContainer(token, container)); }
  catch { await queue.markUncertain(job.id, job.lease_token); }
  return true;
}

export function startPublicationWorker(pool: Pool, vault: TokenVault): () => void {
  const queue = new PublicationQueue(pool), publisher = new ThreadsPublisher();
  let running = false, stopped = false;
  const run = async () => {
    if (running || stopped) return;
    running = true;
    try { await processPublication(queue, vault, publisher); }
    catch { console.error('Worker publikasi mengalami kesalahan; pekerjaan akan diperiksa kembali.'); }
    finally { running = false; }
  };
  const timer = setInterval(() => { void run(); }, 10000);
  void run();
  return () => { stopped = true; clearInterval(timer); };
}
