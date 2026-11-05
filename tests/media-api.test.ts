import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { copyFile, mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PGlite } from '@electric-sql/pglite';
import session from 'express-session';
import request from 'supertest';
import sharp from 'sharp';
import type { Pool } from 'pg';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/password.js';
import { MediaStore, validateVideoProbe } from '../src/media-store.js';
import { PublicationQueue } from '../src/publication-queue.js';
import { processPublication } from '../src/publication-worker.js';
import { ThreadsPublisher } from '../src/threads-publisher.js';
import { TokenVault } from '../src/token-vault.js';

test('media privat terikat versi, disetujui dan dipublikasikan setelah siap', async () => {
  const root = await mkdtemp(join(tmpdir(), 'threads-media-test-'));
  const db = new PGlite();
  try {
    for (const name of ['001_content.sql','002_local_identity.sql','006_password_reset.sql','007_threads_accounts.sql','013_token_refresh.sql','009_publication_jobs.sql','010_publication_resolutions.sql','011_publication_diagnostics.sql','012_media.sql','014_carousel.sql','015_thread_replies.sql','016_publication_reference_repairs.sql','017_publication_failure_details.sql','018_workspace_management.sql']) await db.exec(await readFile(`db/migrations/${name}`, 'utf8'));
    const query = async (text: string, params?: unknown[]) => { const result = await db.query(text, params); return { ...result, rowCount: result.rows.length }; };
    const pool = { query, connect: async () => ({ query, release: () => {} }) } as unknown as Pool;
    const admin='11111111-1111-4111-8111-111111111111', editor='22222222-2222-4222-8222-222222222222', account='33333333-3333-4333-8333-333333333333';
    const password='password khusus pengujian', hash=await hashPassword(password), vault=new TokenVault(Buffer.alloc(32,7)), sealed=vault.seal('token-test',`${account}:123`);
    await db.query("INSERT INTO local_users(id,email,password_hash,role,email_verified_at) VALUES ($1,'admin@example.test',$3,'admin',now()),($2,'editor@example.test',$3,'editor',now())",[admin,editor,hash]);
    await db.query("INSERT INTO threads_accounts(id,threads_user_id,username,connected_by,encrypted_token,token_iv,token_tag,token_expires_at,status) VALUES ($1,'123','test',$2,$3,$4,$5,now()+interval '1 day','active')",[account,admin,sealed.ciphertext,sealed.iv,sealed.tag]);
    const origin='https://example.test', secret='k'.repeat(48), media=new MediaStore(pool,root,secret);
    const app=await createApp({ pool,store:new session.MemoryStore(),secret,origin,secure:false,trustProxy:false,publishingEnabled:true,media });
    async function login(email: string) {
      const agent=request.agent(app), initial=(await agent.get('/api/auth/csrf')).body.csrfToken;
      const response=await agent.post('/api/auth/login').set('Origin',origin).set('X-CSRF-Token',initial).send({email,password});
      assert.equal(response.status,200); return {agent,csrf:response.body.csrfToken as string};
    }
    const owner=await login('admin@example.test'), other=await login('editor@example.test');
    const png=await sharp({create:{width:24,height:24,channels:4,background:{r:100,g:20,b:10,alpha:0.5}}}).png().toBuffer();
    assert.equal((await request(app).post('/api/media').attach('file',png,{filename:'a.png',contentType:'image/png'})).status,401);
    assert.equal((await owner.agent.post('/api/media').set('Origin',origin).set('X-CSRF-Token','wrong').attach('file',png,{filename:'a.png',contentType:'image/png'})).status,403);
    assert.equal((await owner.agent.post('/api/media').set('Origin',origin).set('X-CSRF-Token',owner.csrf).attach('file',Buffer.from('not-image'),{filename:'a.png',contentType:'image/png'})).status,400);
    assert.equal((await owner.agent.post('/api/media').set('Origin',origin).set('X-CSRF-Token',owner.csrf).attach('file',Buffer.alloc(8*1024*1024+1),{filename:'oversize.png',contentType:'image/png'})).status,400);
    assert.equal((await readdir(media.staging)).length,0);
    const uploaded=await owner.agent.post('/api/media').set('Origin',origin).set('X-CSRF-Token',owner.csrf).attach('file',png,{filename:'a.png',contentType:'image/png'});
    assert.equal(uploaded.status,201); const id=uploaded.body.media.id as string;
    assert.equal(uploaded.body.media.kind,'IMAGE');
    assert.equal((await other.agent.get(`/api/media/${id}/content`)).status,404);
    assert.equal((await request(app).get(`/api/media/${id}/content`)).status,401);
    const preview=await owner.agent.get(`/api/media/${id}/content`);
    assert.equal(preview.status,200); assert.match(preview.headers['content-type'],/^image\/jpeg/);
    assert.equal((await sharp(preview.body as Buffer).metadata()).format,'jpeg');
    assert.equal((await other.agent.post('/api/posts').set('Origin',origin).set('X-CSRF-Token',other.csrf).send({body:'coba',mediaId:id})).status,400);
    const created=await owner.agent.post('/api/posts').set('Origin',origin).set('X-CSRF-Token',owner.csrf).send({body:'',mediaId:id,destinationAccountId:account});
    assert.equal(created.status,201); const post=created.body.post.id as string;
    assert.equal((await other.agent.get(`/api/media/${id}/content`)).status,200);
    assert.equal((await owner.agent.delete(`/api/media/${id}`).set('Origin',origin).set('X-CSRF-Token',owner.csrf)).status,409);
    const act=(name:string,revision:number) => owner.agent.post(`/api/posts/${post}/${name}`).set('Origin',origin).set('X-CSRF-Token',owner.csrf).send({revision});
    assert.equal((await act('submit',1)).status,200); assert.equal((await act('approve',2)).status,200);
    const edited=await owner.agent.put(`/api/posts/${post}`).set('Origin',origin).set('X-CSRF-Token',owner.csrf).send({body:'Pengganti',mediaId:null,revision:3});
    assert.equal(edited.status,200); assert.equal(edited.body.post.status,'draft');
    const reattached=await owner.agent.put(`/api/posts/${post}`).set('Origin',origin).set('X-CSRF-Token',owner.csrf).send({body:'',mediaId:id,revision:4});
    assert.equal(reattached.status,200); assert.equal((await act('submit',5)).status,200); assert.equal((await act('approve',6)).status,200);
    const now=await owner.agent.post(`/api/posts/${post}/publish-now`).set('Origin',origin).set('X-CSRF-Token',owner.csrf).send({revision:7,timeZone:'UTC'});
    assert.equal(now.status,201,JSON.stringify(now.body)); const job=now.body.job.id as string;
    assert.equal((await request(app).get(new URL(media.downloadUrl(origin,job,id)).pathname)).status,404);
    let createCount=0,statusCount=0,publishCount=0, signedPath='';
    const publisher=new ThreadsPublisher((async (input: string | URL | Request) => {
      const url=new URL(String(input));
      if (url.pathname==='/me/threads') {
        createCount++; assert.equal(url.searchParams.get('media_type'),'IMAGE');
        assert.equal(url.searchParams.has('text'),false);
        const mediaUrl=new URL(url.searchParams.get('image_url')!); assert.equal(mediaUrl.origin,origin); signedPath=mediaUrl.pathname;
        const read=await request(app).get(signedPath); assert.equal(read.status,200); assert.match(read.headers['content-type'],/^image\/jpeg/);
        const range=await request(app).get(signedPath).set('Range','bytes=0-31'); assert.equal(range.status,206);
        return new Response('{"id":"12345"}',{status:200});
      }
      if (url.pathname==='/12345') { statusCount++; return new Response(JSON.stringify({status:statusCount===1?'IN_PROGRESS':'FINISHED'}),{status:200}); }
      if (url.pathname==='/me/threads_publish') { publishCount++; return new Response('{"id":"67890"}',{status:200}); }
      throw new Error('Unexpected endpoint');
    }) as typeof fetch);
    const queue=new PublicationQueue(pool);
    assert.equal(await processPublication(queue,vault,publisher,{store:media,origin}),true);
    assert.equal((await db.query<{status:string}>('SELECT status FROM publication_jobs WHERE id=$1',[job])).rows[0]?.status,'prepared');
    assert.equal(publishCount,0); assert.equal(await queue.claim(),null);
    await db.query('UPDATE publication_jobs SET next_attempt_at=now() WHERE id=$1',[job]);
    assert.equal(await processPublication(queue,vault,publisher,{store:media,origin}),true);
    assert.equal(createCount,1); assert.equal(statusCount,2); assert.equal(publishCount,1);
    assert.equal((await db.query<{status:string}>('SELECT status FROM publication_jobs WHERE id=$1',[job])).rows[0]?.status,'published');
    assert.equal((await request(app).get(signedPath.slice(0,-1)+(signedPath.endsWith('A')?'B':'A'))).status,404);
    const expired=String(Math.floor(Date.now()/1000)-1), signature=createHmac('sha256',secret).update(`threads-media-v1:${job}:${id}:${expired}`).digest('base64url');
    assert.equal((await request(app).get(`/media-fetch/${job}/${id}/${expired}/${signature}`)).status,404);
    const second=await owner.agent.post('/api/posts').set('Origin',origin).set('X-CSRF-Token',owner.csrf).send({body:'',mediaId:id,destinationAccountId:account});
    const post2=second.body.post.id as string;
    for (const [name,revision] of [['submit',1],['approve',2]] as const) assert.equal((await owner.agent.post(`/api/posts/${post2}/${name}`).set('Origin',origin).set('X-CSRF-Token',owner.csrf).send({revision})).status,200);
    const queued=await owner.agent.post(`/api/posts/${post2}/publish-now`).set('Origin',origin).set('X-CSRF-Token',owner.csrf).send({revision:3,timeZone:'UTC'});
    assert.equal(queued.status,201);
    let secondCalls=0;
    const alreadyPublished=new ThreadsPublisher((async () => { secondCalls++; return new Response(secondCalls===1?'{"id":"12346"}':'{"status":"PUBLISHED"}',{status:200}); }) as typeof fetch);
    assert.equal(await processPublication(queue,vault,alreadyPublished,{store:media,origin}),true);
    assert.equal(secondCalls,2);
    assert.equal((await db.query<{status:string}>('SELECT status FROM publication_jobs WHERE id=$1',[queued.body.job.id])).rows[0]?.status,'uncertain');
    assert.equal(await queue.claim(),null);
    assert.equal((await owner.agent.post(`/api/posts/${post2}/publish-now`).set('Origin',origin).set('X-CSRF-Token',owner.csrf).send({revision:3,timeZone:'UTC'})).status,409);
    const third=await owner.agent.post('/api/posts').set('Origin',origin).set('X-CSRF-Token',owner.csrf).send({body:'',mediaId:id,destinationAccountId:account});
    const post3=third.body.post.id as string;
    for (const [name,revision] of [['submit',1],['approve',2]] as const) assert.equal((await owner.agent.post(`/api/posts/${post3}/${name}`).set('Origin',origin).set('X-CSRF-Token',owner.csrf).send({revision})).status,200);
    const uncertainJob=await owner.agent.post(`/api/posts/${post3}/publish-now`).set('Origin',origin).set('X-CSRF-Token',owner.csrf).send({revision:3,timeZone:'UTC'});
    assert.equal(uncertainJob.status,201);
    let uncertainCalls=0;
    const uncertainPublisher=new ThreadsPublisher((async () => {
      uncertainCalls++;
      if (uncertainCalls===1) return new Response('{"id":"12348"}',{status:200});
      if (uncertainCalls===2) return new Response('{"status":"FINISHED"}',{status:200});
      throw new Error('simulated timeout');
    }) as typeof fetch);
    assert.equal(await processPublication(queue,vault,uncertainPublisher,{store:media,origin}),true);
    assert.equal((await db.query<{status:string}>('SELECT status FROM publication_jobs WHERE id=$1',[uncertainJob.body.job.id])).rows[0]?.status,'uncertain');
    assert.equal(await processPublication(queue,vault,uncertainPublisher,{store:media,origin}),false);
    assert.equal(uncertainCalls,3);
    const fourth=await owner.agent.post('/api/posts').set('Origin',origin).set('X-CSRF-Token',owner.csrf).send({body:'',mediaId:id,destinationAccountId:account});
    const post4=fourth.body.post.id as string;
    for (const [name,revision] of [['submit',1],['approve',2]] as const) assert.equal((await owner.agent.post(`/api/posts/${post4}/${name}`).set('Origin',origin).set('X-CSRF-Token',owner.csrf).send({revision})).status,200);
    const backoffJob=await owner.agent.post(`/api/posts/${post4}/publish-now`).set('Origin',origin).set('X-CSRF-Token',owner.csrf).send({revision:3,timeZone:'UTC'});
    assert.equal(backoffJob.status,201);
    let statusChecks=0, createdContainers=0, publishAttempts=0;
    const transientPublisher=new ThreadsPublisher((async (input: string | URL | Request) => {
      const path=new URL(String(input)).pathname;
      if (path==='/me/threads') { createdContainers++; return new Response('{"id":"12349"}',{status:200}); }
      if (path==='/12349') { statusChecks++; return statusChecks<=2 ? new Response('',{status:503}) : new Response('{"status":"FINISHED"}',{status:200}); }
      publishAttempts++; return new Response('{"id":"67892"}',{status:200});
    }) as typeof fetch);
    for (const delay of [30,60]) {
      assert.equal(await processPublication(queue,vault,transientPublisher,{store:media,origin}),true);
      const state=(await db.query<{ status:string; delay:number }>("SELECT status,extract(epoch from (next_attempt_at-updated_at))::int AS delay FROM publication_jobs WHERE id=$1",[backoffJob.body.job.id])).rows[0];
      assert.equal(state?.status,'prepared'); assert.equal(state?.delay,delay); assert.equal(publishAttempts,0);
      await db.query('UPDATE publication_jobs SET next_attempt_at=now() WHERE id=$1',[backoffJob.body.job.id]);
    }
    assert.equal(await processPublication(queue,vault,transientPublisher,{store:media,origin}),true);
    assert.equal(createdContainers,1); assert.equal(statusChecks,3); assert.equal(publishAttempts,1);
    const tiny=new MediaStore(pool,root,secret,1), temporary=join(root,'.staging','quota-test');
    await writeFile(temporary,png);
    await assert.rejects(tiny.upload(admin,temporary,'image/png'),/kapasitas/i);
    assert.equal((await db.query('SELECT id FROM media_assets')).rows.length,1);
    assert.equal((await readdir(root)).filter(name=>name.endsWith('.jpg')).length,1);
    if (process.env.MEDIA_TEST_VIDEO_PATH) {
      const video = await readFile(process.env.MEDIA_TEST_VIDEO_PATH);
      const uploadedVideo = await owner.agent.post('/api/media').set('Origin',origin).set('X-CSRF-Token',owner.csrf).attach('file',video,{filename:'video.mp4',contentType:'video/mp4'});
      assert.equal(uploadedVideo.status,201,JSON.stringify(uploadedVideo.body));
      const videoId=uploadedVideo.body.media.id as string;
      const newPost=await owner.agent.post('/api/posts').set('Origin',origin).set('X-CSRF-Token',owner.csrf).send({body:'Video uji',mediaId:videoId,destinationAccountId:account});
      assert.equal(newPost.status,201); const videoPost=newPost.body.post.id as string;
      for (const [name,revision] of [['submit',1],['approve',2]] as const) assert.equal((await owner.agent.post(`/api/posts/${videoPost}/${name}`).set('Origin',origin).set('X-CSRF-Token',owner.csrf).send({revision})).status,200);
      const videoJob=await owner.agent.post(`/api/posts/${videoPost}/publish-now`).set('Origin',origin).set('X-CSRF-Token',owner.csrf).send({revision:3,timeZone:'UTC'});
      assert.equal(videoJob.status,201);
      let mediaType='', rangedStatus=0, videoCalls=0;
      const videoPublisher=new ThreadsPublisher((async (input: string | URL | Request) => {
        const url=new URL(String(input)); videoCalls++;
        if (url.pathname==='/me/threads') {
          mediaType=url.searchParams.get('media_type') ?? '';
          const path=new URL(url.searchParams.get('video_url')!).pathname;
          rangedStatus=(await request(app).get(path).set('Range','bytes=0-63')).status;
          return new Response('{"id":"12347"}',{status:200});
        }
        if (url.pathname==='/12347') return new Response('{"status":"FINISHED"}',{status:200});
        return new Response('{"id":"67891"}',{status:200});
      }) as typeof fetch);
      assert.equal(await processPublication(queue,vault,videoPublisher,{store:media,origin}),true);
      assert.equal(mediaType,'VIDEO'); assert.equal(rangedStatus,206); assert.equal(videoCalls,3);
      assert.equal((await db.query<{status:string}>('SELECT status FROM publication_jobs WHERE id=$1',[videoJob.body.job.id])).rows[0]?.status,'published');
    }
  } finally {
    await db.close();
    for (const name of await readdir(join(root,'.staging')).catch(() => [])) await unlink(join(root,'.staging',name));
    await rmdir(join(root,'.staging')).catch(() => {});
    for (const name of await readdir(root)) await unlink(join(root,name));
    await rmdir(root);
  }
});

test('validasi metadata video membatasi format dan durasi', () => {
  const video={streams:[{codec_type:'video',codec_name:'h264',width:1080,height:1920,avg_frame_rate:'30/1'},{codec_type:'audio',codec_name:'aac',sample_rate:'48000'}],format:{duration:'30',format_name:'mov,mp4,m4a,3gp,3g2,mj2'}};
  assert.deepEqual(validateVideoProbe(video),{width:1080,height:1920,duration:30});
  assert.throws(() => validateVideoProbe({...video,format:{...video.format,duration:'301'}}));
  assert.throws(() => validateVideoProbe({...video,streams:[{...video.streams[0],codec_name:'vp9'}]}));
});

test('video MP4 nyata divalidasi dan disimpan jika ffprobe tersedia', { skip: !process.env.MEDIA_TEST_VIDEO_PATH }, async () => {
  const root=await mkdtemp(join(tmpdir(),'threads-video-test-')), db=new PGlite();
  try {
    for (const name of ['001_content.sql','002_local_identity.sql','007_threads_accounts.sql','013_token_refresh.sql','009_publication_jobs.sql','012_media.sql','014_carousel.sql','015_thread_replies.sql','016_publication_reference_repairs.sql','017_publication_failure_details.sql','018_workspace_management.sql']) await db.exec(await readFile(`db/migrations/${name}`,'utf8'));
    const query=async (text:string,params?:unknown[]) => { const result=await db.query(text,params); return {...result,rowCount:result.rows.length}; };
    const pool={query,connect:async()=>({query,release:()=>{}})} as unknown as Pool;
    const owner='11111111-1111-4111-8111-111111111111';
    await db.query("INSERT INTO local_users(id,email,password_hash,role) VALUES ($1,'video@example.test','hash','admin')",[owner]);
    const media=new MediaStore(pool,root,'k'.repeat(48)); await media.initialize();
    const temporary=join(media.staging,'video-test'); await copyFile(process.env.MEDIA_TEST_VIDEO_PATH!,temporary);
    const asset=await media.upload(owner,temporary,'video/mp4');
    assert.equal(asset.kind,'VIDEO'); assert.ok(asset.duration_seconds && asset.duration_seconds >= 3);
    assert.ok((await readFile(media.path(asset.id,'VIDEO'))).subarray(4,8).equals(Buffer.from('ftyp')));
    await media.removeUnattached(asset.id,owner);
    assert.equal((await db.query('SELECT id FROM media_assets')).rows.length,0);
  } finally {
    await db.close();
    for (const name of await readdir(join(root,'.staging')).catch(()=>[])) await unlink(join(root,'.staging',name));
    await rmdir(join(root,'.staging')).catch(()=>{});
    for (const name of await readdir(root)) await unlink(join(root,name));
    await rmdir(root);
  }
});
