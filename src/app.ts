import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import multer from 'multer';
import express, { type RequestHandler } from 'express';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { hashPassword, verifyPassword } from './password.js';
import { ContentStore, PermissionError } from './content-store.js';
import { DomainError } from './domain.js';
import { EmailVerification } from './email-verification.js';
import { sendTransactionalMail, type MailTransport } from './smtp.js';
import { Invitations, InvitationError } from './invitations.js';
import { PasswordReset } from './password-reset.js';
import { ThreadsAccounts } from './threads-accounts.js';
import { TokenVault } from './token-vault.js';
import { ThreadsOAuthClient, ThreadsOAuthError } from './threads-oauth-client.js';
import { PublicationRequests, PublicationRequestError } from './publication-requests.js';
import { verifyPublishedPart } from './verify-published-part.js';
import { MediaStore, MediaError, MEDIA_UPLOAD_LIMIT } from './media-store.js';
import { managementRoutes } from './management-routes.js';
import { postFilters } from './post-filters.js';
import { ManagementError } from './workspace-management.js';

declare module 'express-session' {
  interface SessionData { userId?: string; userVersion?: number; csrf?: string }
}
type User = { id: string; email: string; role: 'admin' | 'editor' | 'reviewer'; password_hash: string; email_verified_at: Date | null; disabled_at: Date | null; session_version: number };
type Options = { pool: Pool; store: session.Store; secret: string; origin: string; secure: boolean; trustProxy: boolean; mail?: { transport: MailTransport; from: string }; threads?: { client: ThreadsOAuthClient; vault: TokenVault }; publishingEnabled?: boolean; media?: MediaStore };
const csrfToken = () => randomBytes(32).toString('base64url');

export async function createApp(options: Options) {
  if (Buffer.byteLength(options.secret, 'utf8') < 32) throw new Error('SESSION_SECRET harus minimal 32 byte.');
  const parsedOrigin = new URL(options.origin);
  if (parsedOrigin.origin !== options.origin || !['http:', 'https:'].includes(parsedOrigin.protocol)) throw new Error('APP_ORIGIN harus berupa origin HTTP(S), tanpa path atau garis miring akhir.');
  if (options.secure && parsedOrigin.protocol !== 'https:') throw new Error('HTTPS wajib untuk konfigurasi produksi.');
  const dummyHash = await hashPassword(randomBytes(32).toString('base64url'));
  const app = express();
  app.disable('x-powered-by');
  if (options.trustProxy) app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: { imgSrc: ["'self'", 'data:', 'blob:'], mediaSrc: ["'self'", 'blob:'] } } }));
  app.use(express.json({ limit: '8kb' }));
  app.use(session({
    name: 'threads.sid', secret: options.secret, store: options.store,
    resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, secure: options.secure, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 },
  }));

  app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.get('/health/ready', async (_req, res) => {
    try { await options.pool.query('SELECT 1'); res.json({ status: 'ok' }); }
    catch { res.status(503).json({ status: 'unavailable' }); }
  });
  app.get('/openapi.json', (_req, res) => res.sendFile(resolve('openapi.json')));
  app.get('/', (_req, res) => res.sendFile(resolve('public/index.html')));
  app.use('/assets', express.static(resolve('public'), { index: false, fallthrough: false, dotfiles: 'deny', maxAge: 0 }));

  const checkCsrf: RequestHandler = (req, res, next) => {
    const provided = req.get('x-csrf-token');
    const expected = req.session.csrf;
    if (req.get('origin') !== options.origin || !provided || !expected || Buffer.byteLength(provided) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
      res.status(403).json({ error: 'Permintaan tidak valid.' }); return;
    }
    next();
  };
  const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Terlalu banyak percobaan. Coba lagi nanti.' } });
  const csrfLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Terlalu banyak permintaan. Coba lagi nanti.' } });
  app.get('/api/auth/csrf', csrfLimit, (req, res) => {
    req.session.csrf ??= csrfToken();
    res.set('Cache-Control', 'no-store').json({ csrfToken: req.session.csrf });
  });
  app.post('/api/auth/login', loginLimit, checkCsrf, async (req, res, next) => {
    try {
      const { email, password } = req.body ?? {};
      if (typeof email !== 'string' || typeof password !== 'string' || email.length > 254 || Buffer.byteLength(password, 'utf8') > 1024) {
        res.status(400).json({ error: 'Masukan tidak valid.' }); return;
      }
      const result = await options.pool.query<User>('SELECT id, email, role, password_hash, email_verified_at, disabled_at, session_version FROM local_users WHERE email=$1', [email.trim().toLowerCase()]);
      const user = result.rows[0];
      const valid = await verifyPassword(password, user?.password_hash ?? dummyHash);
      if (!valid || !user || user.disabled_at) { res.status(401).json({ error: 'Email atau kata sandi tidak valid.' }); return; }
      req.session.regenerate(err => {
        if (err) { next(err); return; }
        req.session.userId = user.id;
        req.session.userVersion = user.session_version;
        req.session.csrf = csrfToken();
        req.session.save(saveErr => {
          if (saveErr) { next(saveErr); return; }
          res.set('Cache-Control', 'no-store').json({ user: { id: user.id, email: user.email, role: user.role, emailVerified: !!user.email_verified_at }, csrfToken: req.session.csrf });
        });
      });
    } catch (error) { next(error); }
  });
  app.get('/api/auth/me', async (req, res, next) => {
    try {
      if (!req.session.userId) { res.status(401).json({ error: 'Harus masuk.' }); return; }
      const result = await options.pool.query<User>('SELECT id, email, role, password_hash, email_verified_at, disabled_at, session_version FROM local_users WHERE id=$1', [req.session.userId]);
      const user = result.rows[0];
      if (!user || user.disabled_at || req.session.userVersion !== user.session_version) { req.session.destroy(() => {}); res.status(401).json({ error: 'Harus masuk.' }); return; }
      res.set('Cache-Control', 'no-store').json({ user: { id: user.id, email: user.email, role: user.role, emailVerified: !!user.email_verified_at } });
    } catch (error) { next(error); }
  });
  app.post('/api/auth/logout', checkCsrf, (req, res, next) => {
    req.session.destroy(error => {
      if (error) { next(error); return; }
      res.clearCookie('threads.sid', { httpOnly: true, secure: options.secure, sameSite: 'lax' });
      res.status(204).end();
    });
  });
  const requireUser: RequestHandler = async (req, res, next) => {
    try {
      if (!req.session.userId) { res.status(401).json({ error: 'Harus masuk.' }); return; }
      const result = await options.pool.query<User>('SELECT id, email, role, password_hash, email_verified_at, disabled_at, session_version FROM local_users WHERE id=$1', [req.session.userId]);
      const user = result.rows[0];
      if (!user || user.disabled_at || req.session.userVersion !== user.session_version) { req.session.destroy(() => {}); res.status(401).json({ error: 'Harus masuk.' }); return; }
      res.locals.user = user;
      next();
    } catch (error) { next(error); }
  };
  const content = new ContentStore(options.pool);
  if (options.media) {
    const media = options.media;
    await media.initialize();
    const upload = multer({ storage: multer.diskStorage({ destination: media.staging, filename: (_req, _file, cb) => cb(null,randomUUID()) }), limits: { fileSize: MEDIA_UPLOAD_LIMIT, files: 1, fields: 0, parts: 1 } }).single('file');
    const mediaLimit = rateLimit({ windowMs: 15*60*1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Terlalu banyak unggahan. Coba lagi nanti.' } });
    let uploads = 0;
    app.post('/api/media', requireUser, checkCsrf, mediaLimit, (req, res, next) => {
      if (uploads >= 2) { res.status(429).json({ error: 'Server sedang memproses unggahan lain. Coba lagi nanti.' }); return; }
      uploads++;
      upload(req,res,async error => {
        try {
          if (error) { res.status(error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'Unggah satu berkas JPEG/PNG atau MP4, maksimal 100 MiB.' }); return; }
          if (!req.file) { res.status(400).json({ error: 'Pilih berkas media.' }); return; }
          const asset = await media.upload((res.locals.user as User).id,req.file.path,req.file.mimetype);
          res.set('Cache-Control','no-store').status(201).json({ media: { id: asset.id, kind: asset.kind, byteSize: Number(asset.byte_size), width: asset.width, height: asset.height, previewUrl: `/api/media/${asset.id}/content` } });
        } catch (failure) { if (failure instanceof MediaError) res.status(400).json({ error: failure.message }); else next(failure); }
        finally { uploads--; }
      });
    });
    app.get('/api/media/:id/content',requireUser,async (req,res,next) => {
      try {
        const asset = await media.preview(req.params.id as string,(res.locals.user as User).id);
        if (!asset) { res.status(404).end(); return; }
        res.set('Cache-Control','no-store').type(asset.kind === 'IMAGE' ? 'image/jpeg' : 'video/mp4').sendFile(media.path(asset.id,asset.kind));
      } catch (error) { next(error); }
    });
    app.delete('/api/media/:id',requireUser,checkCsrf,async (req,res,next) => {
      try { await media.removeUnattached(req.params.id as string,(res.locals.user as User).id); res.status(204).end(); }
      catch (error) { if (error instanceof MediaError) res.status(409).json({ error: error.message }); else next(error); }
    });
    app.get('/media-fetch/:job/:id/:expires/:signature',async (req,res,next) => {
      try {
        const asset = await media.publicDownload(req.params.job as string,req.params.id as string,req.params.expires as string,req.params.signature as string);
        if (!asset) { res.status(404).end(); return; }
        res.set('Cache-Control','no-store').set('Referrer-Policy','no-referrer').type(asset.kind === 'IMAGE' ? 'image/jpeg' : 'video/mp4').sendFile(media.path(asset.id,asset.kind));
      } catch (error) { next(error); }
    });
  }
  const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
  app.get('/api/threads/config', requireUser, (_req, res) => res.set('Cache-Control', 'no-store').json({ configured: !!options.threads, publishingEnabled: !!options.publishingEnabled }));
  app.post('/api/threads/oauth/start', requireUser, checkCsrf, async (req, res, next) => {
    const user = res.locals.user as User;
    if (user.role !== 'admin' || !user.email_verified_at) { res.status(403).json({ error: 'Hanya admin dengan email terverifikasi dapat menghubungkan Threads.' }); return; }
    if (!options.threads) { res.status(503).json({ error: 'Koneksi Threads belum dikonfigurasi.' }); return; }
    try {
      const state = csrfToken();
      await options.pool.query("DELETE FROM threads_oauth_states WHERE expires_at <= now() OR (user_id=$1 AND session_hash=$2)", [user.id, sha256(req.sessionID)]);
      await options.pool.query("INSERT INTO threads_oauth_states (state_hash,user_id,session_hash,expires_at) VALUES ($1,$2,$3,now()+interval '10 minutes')", [sha256(state), user.id, sha256(req.sessionID)]);
      res.set('Cache-Control', 'no-store').json({ authorizationUrl: options.threads.client.authorizationUrl(state) });
    } catch (error) { next(error); }
  });
  app.get('/api/threads/oauth/callback', (req, res, next) => {
    if (!req.session.userId) { res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer').redirect(303, '/#threads=failed&reason=session'); return; }
    next();
  }, requireUser, async (req, res) => {
    res.set('Cache-Control', 'no-store'); res.set('Referrer-Policy', 'no-referrer');
    const fail = (reason: string, error?: unknown) => {
      const details = error instanceof ThreadsOAuthError ? { httpStatus: error.httpStatus, metaCode: error.metaCode, metaSubcode: error.metaSubcode, metaReason: error.metaReason } : {};
      console.error(JSON.stringify({ event: 'threads_oauth_failed', stage: reason, ...details }));
      const params = new URLSearchParams({ threads: 'failed', reason });
      if (details.metaCode !== undefined) params.set('meta_code', String(details.metaCode));
      if (details.metaSubcode !== undefined) params.set('meta_subcode', String(details.metaSubcode));
      if (details.metaReason && details.metaReason !== 'other') params.set('meta_reason', details.metaReason);
      res.redirect(303, `/#${params}`);
    };
    const user = res.locals.user as User;
    const state = req.query.state, code = req.query.code;
    if (!options.threads) { fail('configuration'); return; }
    if (user.role !== 'admin' || !user.email_verified_at) { fail('access'); return; }
    if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state)) { fail('session'); return; }
    let stage = 'storage';
    try {
      const consumed = await options.pool.query('DELETE FROM threads_oauth_states WHERE state_hash=$1 AND user_id=$2 AND session_hash=$3 AND expires_at>now() RETURNING state_hash', [sha256(state), user.id, sha256(req.sessionID)]);
      if (consumed.rowCount !== 1) { fail('session'); return; }
      if (req.query.error !== undefined) { fail('denied'); return; }
      if (typeof code !== 'string' || !code) { fail('callback'); return; }
      stage = 'code_exchange';
      const account = await options.threads.client.exchange(code);
      stage = 'storage';
      await new ThreadsAccounts(options.pool, options.threads.vault).register(user.id, account);
      res.redirect(303, '/#threads=connected');
    } catch (error) { fail(error instanceof ThreadsOAuthError ? error.stage : stage, error); }
  });
  app.get('/api/threads/accounts', requireUser, async (_req, res, next) => {
    try {
      const result = await options.pool.query("SELECT id, username, status FROM threads_accounts WHERE status='active' AND token_expires_at > now() ORDER BY username, id");
      const attention = await options.pool.query("SELECT username, CASE WHEN token_expires_at<=now() THEN 'expired' ELSE refresh_status END AS reason FROM threads_accounts WHERE status='active' AND (token_expires_at<=now() OR refresh_status IN ('retry','reconnect')) ORDER BY username,id");
      const filterAccounts=await options.pool.query('SELECT id,username FROM threads_accounts ORDER BY username,id');
      res.set('Cache-Control', 'no-store').json({ accounts: result.rows, attention: attention.rows,filterAccounts:filterAccounts.rows });
    } catch (error) { next(error); }
  });
  const verification = new EmailVerification(options.pool);
  const invitations = new Invitations(options.pool);
  const passwordReset = new PasswordReset(options.pool);
  const mailLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 3, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Terlalu banyak permintaan. Coba lagi nanti.' } });
  const resetRequestLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 3, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Terlalu banyak permintaan. Coba lagi nanti.' } });
  const resetConfirmLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Terlalu banyak percobaan. Coba lagi nanti.' } });
  app.post('/api/auth/password-reset/request', checkCsrf, resetRequestLimit, async (req, res) => {
    if (!req.body || typeof req.body.email !== 'string' || req.body.email.length > 254 || Object.keys(req.body).some(key => key !== 'email')) { res.status(400).json({ error: 'Masukan tidak valid.' }); return; }
    if (!options.mail) { res.status(503).json({ error: 'Email belum dikonfigurasi oleh administrator.' }); return; }
    try {
      const reset = await passwordReset.issue(req.body.email);
      if (reset) {
        const link = `${options.origin}/#reset=${reset.token}`;
        await sendTransactionalMail(options.mail.transport, options.mail.from, reset.email, 'Atur ulang kata sandi Threads Automation', `Buka tautan ini untuk mengatur kata sandi baru. Tautan berlaku satu jam dan hanya dapat dipakai sekali.\n\n${link}\n\nJika kamu tidak meminta perubahan, abaikan pesan ini.`);
      }
    } catch { /* The response must not reveal whether the account exists. */ }
    res.status(204).end();
  });
  app.post('/api/auth/password-reset/confirm', checkCsrf, resetConfirmLimit, async (req, res, next) => {
    if (!req.body || typeof req.body.token !== 'string' || typeof req.body.password !== 'string' || req.body.password.length < 12 || Buffer.byteLength(req.body.password, 'utf8') > 1024 || Object.keys(req.body).some(key => !['token', 'password'].includes(key))) { res.status(400).json({ error: 'Tautan atau kata sandi tidak valid.' }); return; }
    try {
      if (!await passwordReset.consume(req.body.token, req.body.password)) { res.status(400).json({ error: 'Tautan tidak valid, kedaluwarsa, atau sudah digunakan.' }); return; }
      req.session.destroy(() => {
        res.clearCookie('threads.sid', { httpOnly: true, secure: options.secure, sameSite: 'lax' }); res.status(204).end();
      });
    } catch (error) { next(error); }
  });
  const requireVerifiedAdmin: RequestHandler = (_req, res, next) => {
    const actor = res.locals.user as User;
    if (actor.role !== 'admin' || !actor.email_verified_at) { res.status(403).json({ error: 'Hanya administrator dengan email terverifikasi dapat mengelola tim dan akun.' }); return; }
    next();
  };
  managementRoutes(app,{pool:options.pool,permissionCheck:options.threads ? id=>options.threads!.client.checkPermissions(options.pool,options.threads!.vault,id) : undefined},requireUser,checkCsrf,requireVerifiedAdmin);
  app.post('/api/invitations', requireUser, checkCsrf, requireVerifiedAdmin, mailLimit, async (req, res) => {
    const actor = res.locals.user as User;
    if (!options.mail) { res.status(503).json({ error: 'Email belum dikonfigurasi oleh administrator.' }); return; }
    if (!req.body || typeof req.body.email !== 'string' || !['admin', 'editor', 'reviewer'].includes(req.body.role) || Object.keys(req.body).some(key => !['email', 'role'].includes(key))) { res.status(400).json({ error: 'Email atau peran tidak valid.' }); return; }
    try {
      const invitation = await invitations.issue(actor.id, req.body.email, req.body.role);
      const link = `${options.origin}/#invite=${invitation.token}`;
      await sendTransactionalMail(options.mail.transport, options.mail.from, invitation.email, 'Undangan Threads Automation', `Kamu diundang ke Threads Automation. Buka tautan ini untuk membuat kata sandi. Tautan berlaku 7 hari dan hanya dapat digunakan sekali.\n\n${link}\n\nJika undangan ini tidak diharapkan, abaikan pesan ini.`);
      res.status(204).end();
    } catch (error) {
      if (error instanceof InvitationError) { res.status(400).json({ error: error.message }); return; }
      res.status(503).json({ error: 'Undangan tidak dapat dikirim. Coba lagi nanti.' });
    }
  });
  const inviteAcceptLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Terlalu banyak percobaan. Coba lagi nanti.' } });
  app.post('/api/invitations/accept', checkCsrf, inviteAcceptLimit, async (req, res, next) => {
    if (req.session.userId) { res.status(409).json({ error: 'Keluar dari akun saat ini sebelum menerima undangan.' }); return; }
    if (!req.body || typeof req.body.token !== 'string' || typeof req.body.password !== 'string' || req.body.password.length < 12 || Buffer.byteLength(req.body.password, 'utf8') > 1024 || Object.keys(req.body).some(key => !['token', 'password'].includes(key))) { res.status(400).json({ error: 'Undangan atau kata sandi tidak valid.' }); return; }
    try {
      if (!await invitations.accept(req.body.token, req.body.password)) { res.status(400).json({ error: 'Undangan tidak valid, kedaluwarsa, atau sudah digunakan.' }); return; }
      res.status(204).end();
    } catch (error) { next(error); }
  });
  app.post('/api/auth/verification/request', requireUser, checkCsrf, mailLimit, async (_req, res) => {
    const actor = res.locals.user as User;
    if (actor.email_verified_at) { res.status(204).end(); return; }
    if (!options.mail) { res.status(503).json({ error: 'Email belum dikonfigurasi oleh administrator.' }); return; }
    try {
      const token = await verification.issue(actor.id, 24 * 60 * 60);
      const link = `${options.origin}/#verify=${token}`;
      await sendTransactionalMail(options.mail.transport, options.mail.from, actor.email, 'Verifikasi email Threads Automation', `Buka tautan ini, masuk dengan akun yang sama, lalu konfirmasi email. Tautan berlaku 24 jam.\n\n${link}\n\nJika kamu tidak meminta verifikasi, abaikan pesan ini.`);
      res.status(204).end();
    } catch { res.status(503).json({ error: 'Email verifikasi tidak dapat dikirim. Coba lagi nanti.' }); }
  });
  app.post('/api/auth/verification/confirm', requireUser, checkCsrf, async (req, res, next) => {
    try {
      if (!req.body || typeof req.body.token !== 'string' || Object.keys(req.body).some(key => key !== 'token')) { res.status(400).json({ error: 'Tautan verifikasi tidak valid.' }); return; }
      const actor = res.locals.user as User;
      if (!await verification.consume(req.body.token, actor.id)) { res.status(400).json({ error: 'Tautan tidak valid, kedaluwarsa, atau bukan untuk akun ini.' }); return; }
      res.status(204).end();
    } catch (error) { next(error); }
  });
  app.get('/api/posts', requireUser, async (req, res, next) => {
    try {
      const {offset,where,params}=postFilters(req.query);
      const result = await options.pool.query("SELECT p.id, p.created_by, p.status, p.current_version, p.revision, p.created_at, p.updated_at, v.body, v.media_id, m.kind AS media_kind, COALESCE((SELECT json_agg(json_build_object('id',cm.media_id,'kind',ma.kind) ORDER BY cm.position) FROM content_version_media cm JOIN media_assets ma ON ma.id=cm.media_id WHERE cm.post_id=p.id AND cm.version=p.current_version),'[]'::json) AS media, COALESCE((SELECT json_agg(r.body ORDER BY r.position) FROM content_version_replies r WHERE r.post_id=p.id AND r.version=p.current_version),'[]'::json) AS replies, v.destination_account_id, a.username AS destination_username, j.id AS job_id, j.status AS job_status, j.part_index, j.scheduled_at, j.time_zone, j.published_id, j.failure_code FROM content_posts p JOIN content_versions v ON v.post_id=p.id AND v.version=p.current_version LEFT JOIN media_assets m ON m.id=v.media_id LEFT JOIN threads_accounts a ON a.id=v.destination_account_id LEFT JOIN LATERAL (SELECT id,status,part_index,scheduled_at,time_zone,published_id,failure_code FROM publication_jobs WHERE post_id=p.id ORDER BY created_at DESC,id DESC LIMIT 1) j ON true WHERE "+where+" ORDER BY p.created_at DESC, p.id DESC LIMIT 51 OFFSET $1", params);
      const hasMore = result.rows.length > 50;
      res.set('Cache-Control', 'no-store').json({ posts: result.rows.slice(0, 50), nextOffset: hasMore && offset <= Number.MAX_SAFE_INTEGER - 100 ? offset + 50 : null });
    } catch (error) { if (error instanceof ManagementError) {res.status(error.status).json({error:error.message});return;} next(error); }
  });
  app.post('/api/posts', requireUser, checkCsrf, async (req, res, next) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['body', 'destinationAccountId','mediaId','mediaIds','replies'].includes(key)) || typeof body.body !== 'string' || (body.mediaId != null && typeof body.mediaId !== 'string') || (body.mediaIds !== undefined && !Array.isArray(body.mediaIds)) || (body.replies !== undefined && !Array.isArray(body.replies)) || (body.destinationAccountId != null && typeof body.destinationAccountId !== 'string')) { res.status(400).json({ error: 'Masukan tidak valid.' }); return; }
      const actor = res.locals.user as User;
      const post = await content.create({ id: actor.id, role: actor.role }, { body: body.body, destinationAccountId: body.destinationAccountId ?? null, mediaId: body.mediaId, mediaIds: body.mediaIds, replies: body.replies });
      res.set('Cache-Control', 'no-store').status(201).json({ post });
    } catch (error) { if (error instanceof DomainError) { res.status(400).json({ error: error.message }); return; } next(error); }
  });
  app.put('/api/posts/:id', requireUser, checkCsrf, async (req, res, next) => {
    try {
      const data = req.body;
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['body', 'revision', 'destinationAccountId','mediaId','mediaIds','replies'].includes(key)) || typeof data.body !== 'string' || !Number.isSafeInteger(data.revision) || (data.mediaId != null && typeof data.mediaId !== 'string') || (data.mediaIds !== undefined && !Array.isArray(data.mediaIds)) || (data.replies !== undefined && !Array.isArray(data.replies)) || (data.destinationAccountId != null && typeof data.destinationAccountId !== 'string')) { res.status(400).json({ error: 'Masukan tidak valid.' }); return; }
      const actor = res.locals.user as User;
      const post = await content.edit({ id: actor.id, role: actor.role }, req.params.id as string, data.revision, { body: data.body, destinationAccountId: data.destinationAccountId, mediaId: data.mediaId, mediaIds: data.mediaIds, replies: data.replies });
      res.set('Cache-Control', 'no-store').json({ post });
    } catch (error) {
      if (error instanceof PermissionError) { res.status(403).json({ error: error.message }); return; }
      if (error instanceof DomainError) { res.status(409).json({ error: error.message }); return; }
      next(error);
    }
  });
  const publicationRequests = new PublicationRequests(options.pool);
  app.post('/api/posts/:id/schedule', requireUser, checkCsrf, async (req, res, next) => {
    if (!options.publishingEnabled) { res.status(503).json({ error: 'Worker publikasi belum diaktifkan.' }); return; }
    try {
      const data = req.body;
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['revision','localTime','timeZone'].includes(key)) || !Number.isSafeInteger(data.revision) || typeof data.localTime !== 'string' || typeof data.timeZone !== 'string') { res.status(400).json({ error: 'Masukan tidak valid.' }); return; }
      const job = await publicationRequests.schedule((res.locals.user as User).id, req.params.id as string, data.revision, data.localTime, data.timeZone);
      res.set('Cache-Control', 'no-store').status(201).json({ job });
    } catch (error) { if (error instanceof PublicationRequestError) { res.status(409).json({ error: error.message }); return; } next(error); }
  });
  app.post('/api/posts/:id/publish-now', requireUser, checkCsrf, async (req, res, next) => {
    if (!options.publishingEnabled) { res.status(503).json({ error: 'Worker publikasi belum diaktifkan.' }); return; }
    try {
      const data = req.body;
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['revision','timeZone'].includes(key)) || !Number.isSafeInteger(data.revision) || typeof data.timeZone !== 'string') { res.status(400).json({ error: 'Masukan tidak valid.' }); return; }
      const job = await publicationRequests.publishNow((res.locals.user as User).id, req.params.id as string, data.revision, data.timeZone);
      res.set('Cache-Control', 'no-store').status(201).json({ job });
    } catch (error) { if (error instanceof PublicationRequestError) { res.status(409).json({ error: error.message }); return; } next(error); }
  });
  app.post('/api/posts/:id/schedules/:jobId/resolve', requireUser, checkCsrf, async (req, res, next) => {
    try {
      const data = req.body;
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['revision','decision','acknowledged','publishedId'].includes(key)) || !Number.isSafeInteger(data.revision) || !['published','not_published'].includes(data.decision) || data.acknowledged !== true || (data.publishedId !== undefined && typeof data.publishedId !== 'string')) { res.status(400).json({ error: 'Konfirmasi pemeriksaan Threads diperlukan.' }); return; }
      if (data.publishedId !== undefined && (data.decision !== 'published' || !options.threads || !await verifyPublishedPart(options.pool,options.threads.vault,(res.locals.user as User).id,req.params.id as string,req.params.jobId as string,data.publishedId))) { res.status(409).json({error:'ID posting belum dapat diverifikasi pada akun dan isi yang disetujui. Periksa ID dan akses Meta, lalu coba lagi.'}); return; }
      const job = await publicationRequests.resolveUncertain((res.locals.user as User).id, req.params.id as string, data.revision, req.params.jobId as string, data.decision, data.publishedId);
      res.set('Cache-Control', 'no-store').json({ job });
    } catch (error) { if (error instanceof PublicationRequestError) { res.status(409).json({ error: error.message }); return; } next(error); }
  });
  app.post('/api/posts/:id/schedules/:jobId/resume', requireUser, checkCsrf, async (req, res, next) => {
    if (!options.publishingEnabled) { res.status(503).json({ error: 'Worker publikasi belum diaktifkan.' }); return; }
    try {
      const data=req.body;
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => key !== 'revision') || !Number.isSafeInteger(data.revision)) { res.status(400).json({error:'Masukan tidak valid.'}); return; }
      const job=await publicationRequests.resume((res.locals.user as User).id,req.params.id as string,data.revision,req.params.jobId as string);
      res.set('Cache-Control','no-store').json({job});
    } catch (error) { if (error instanceof PublicationRequestError) { res.status(409).json({error:error.message}); return; } next(error); }
  });
  app.post('/api/posts/:id/schedules/:jobId/:action', requireUser, checkCsrf, async (req, res, next) => {
    try {
      const action = req.params.action, data = req.body;
      if ((action !== 'cancel' && action !== 'reschedule') || !data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['revision','localTime','timeZone'].includes(key)) || !Number.isSafeInteger(data.revision) || (action === 'reschedule' && (typeof data.localTime !== 'string' || typeof data.timeZone !== 'string'))) { res.status(400).json({ error: 'Masukan tidak valid.' }); return; }
      if (action === 'reschedule' && !options.publishingEnabled) { res.status(503).json({ error: 'Worker publikasi belum diaktifkan.' }); return; }
      const job = await publicationRequests.change((res.locals.user as User).id, req.params.id as string, data.revision, req.params.jobId as string, action, data.localTime, data.timeZone);
      res.set('Cache-Control', 'no-store').json({ job });
    } catch (error) { if (error instanceof PublicationRequestError) { res.status(409).json({ error: error.message }); return; } next(error); }
  });
  app.post('/api/posts/:id/:action', requireUser, checkCsrf, async (req, res, next) => {
    try {
      const action = req.params.action;
      const data = req.body;
      if ((action !== 'submit' && action !== 'approve' && action !== 'reject') || !data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => key !== 'revision') || !Number.isSafeInteger(data.revision)) { res.status(400).json({ error: 'Masukan tidak valid.' }); return; }
      const actor = res.locals.user as User;
      const post = await content.transition({ id: actor.id, role: actor.role }, req.params.id as string, data.revision, action);
      res.set('Cache-Control', 'no-store').json({ post });
    } catch (error) {
      if (error instanceof PermissionError) { res.status(403).json({ error: error.message }); return; }
      if (error instanceof DomainError) { res.status(409).json({ error: error.message }); return; }
      next(error);
    }
  });
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  });
  return app;
}
