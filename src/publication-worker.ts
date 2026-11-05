import type { Pool } from 'pg';
import { TokenVault } from './token-vault.js';
import { PublicationQueue } from './publication-queue.js';
import { ContainerCreationError, ThreadsPublisher } from './threads-publisher.js';
import { MediaStore } from './media-store.js';

export async function processPublication(queue: PublicationQueue, vault: TokenVault, publisher: ThreadsPublisher, media?: { store: MediaStore; origin: string }): Promise<boolean> {
  await queue.recover();
  const job = await queue.claim();
  if (!job) return false;
  const payload = await queue.payload(job.id, job.lease_token);
  if (!payload) { await queue.needsAction(job.id, job.lease_token); return true; }
  let token: string;
  try { token = vault.open({ ciphertext: payload.encrypted_token, iv: payload.token_iv, tag: payload.token_tag }, `${job.account_id}:${payload.threads_user_id}`); }
  catch { await queue.needsAction(job.id, job.lease_token, 'token_unreadable'); return true; }
  let container = job.container_id;
  const assets = await queue.media(job.id,job.lease_token);
  if (job.status === 'preparing') {
    if (payload.media_id && (!media || !payload.media_kind)) { await queue.needsAction(job.id,job.lease_token); return true; }
    try {
      if (assets.length > 1 && media) {
        const children: string[] = [];
        for (const asset of assets) {
          if (asset.kind !== 'IMAGE') { await queue.needsAction(job.id,job.lease_token); return true; }
          let child = asset.container_id;
          if (!child) {
            child = await publisher.createCarouselItem(token,media.store.downloadUrl(media.origin,job.id,asset.media_id));
            if (!await queue.saveCarouselItem(job.id,job.lease_token,asset.position,asset.media_id,child)) return true;
          }
          const status = await publisher.containerStatus(token,child);
          if (status === 'IN_PROGRESS') { await queue.deferPreparing(job.id,job.lease_token); return true; }
          if (status !== 'FINISHED') { await queue.needsAction(job.id,job.lease_token,'meta_rejected'); return true; }
          children.push(child);
        }
        container = await publisher.createCarouselContainer(token,payload.body,children);
      } else container = payload.media_id && payload.media_kind && media ? await publisher.createMediaContainer(token,payload.body,payload.media_kind,media.store.downloadUrl(media.origin,job.id,payload.media_id)) : await publisher.createTextContainer(token, payload.body, job.reply_to_id);
    }
    catch (error) { await queue.preparationFailed(job.id, job.lease_token, error instanceof ContainerCreationError && error.retryable, error instanceof ContainerCreationError ? error.reason : 'meta_rejected'); return true; }
    if (!await queue.markPrepared(job.id, job.lease_token, container)) return true;
  }
  if (!container) { await queue.needsAction(job.id, job.lease_token); return true; }
  if (payload.media_id) {
    try {
      const status = await publisher.containerStatus(token,container);
      if (status === 'IN_PROGRESS') { await queue.deferPrepared(job.id,job.lease_token); return true; }
      if (status === 'PUBLISHED') { await queue.preparedUncertain(job.id,job.lease_token); return true; }
      if (status !== 'FINISHED') { await queue.needsAction(job.id,job.lease_token,'meta_rejected'); return true; }
    } catch (error) {
      if (error instanceof ContainerCreationError && !error.retryable) await queue.needsAction(job.id,job.lease_token,error.reason);
      else await queue.deferPrepared(job.id,job.lease_token,true);
      return true;
    }
  }
  if (!await queue.beginPublish(job.id, job.lease_token)) { await queue.needsAction(job.id, job.lease_token); return true; }
  try { await queue.markPublished(job.id, job.lease_token, await publisher.publishContainer(token, container)); }
  catch { await queue.markUncertain(job.id, job.lease_token); }
  return true;
}

export function startPublicationWorker(pool: Pool, vault: TokenVault, media?: { store: MediaStore; origin: string }): () => void {
  const queue = new PublicationQueue(pool), publisher = new ThreadsPublisher();
  let running = false, stopped = false;
  const run = async () => {
    if (running || stopped) return;
    running = true;
    try { await processPublication(queue, vault, publisher, media); }
    catch { console.error('Worker publikasi mengalami kesalahan; pekerjaan akan diperiksa kembali.'); }
    finally { running = false; }
  };
  const timer = setInterval(() => { void run(); }, 10000);
  void run();
  return () => { stopped = true; clearInterval(timer); };
}
