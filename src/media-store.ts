import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmod, link, mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { Pool } from 'pg';

export class MediaError extends Error {}
export const MEDIA_UPLOAD_LIMIT = 100 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Asset = { id: string; uploaded_by: string; kind: 'IMAGE' | 'VIDEO'; byte_size: string; width: number; height: number; duration_seconds: number | null };
type VideoProbe = { streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; sample_rate?: string }[]; format?: { duration?: string; format_name?: string } };
const execute = promisify(execFile);

export function validateVideoProbe(probe: VideoProbe) {
  const video = probe.streams?.filter(stream => stream.codec_type === 'video');
  const audio = probe.streams?.filter(stream => stream.codec_type === 'audio') ?? [];
  const v = video?.[0], duration = Number(probe.format?.duration);
  const parts = (v?.avg_frame_rate ?? '').split('/').map(Number);
  const fps = parts.length === 2 ? parts[0]! / parts[1]! : NaN;
  if (!v || video?.length !== 1 || v.codec_name !== 'h264' || !v.width || !v.height || v.width > 1920 || v.height > 1920 || v.width < 16 || v.height < 16 || !Number.isFinite(duration) || duration < 3 || duration > 300 || !Number.isFinite(fps) || fps < 23 || fps > 60 || audio.length > 1 || audio.some(a => a.codec_name !== 'aac' || a.sample_rate !== '48000') || !probe.format?.format_name?.split(',').includes('mp4')) throw new MediaError('Gunakan MP4 H.264, 3–300 detik, 23–60 fps, maksimal 1920 piksel per sisi; audio opsional AAC 48 kHz.');
  return { width: v.width, height: v.height, duration };
}

export class MediaStore {
  readonly root: string;
  readonly staging: string;
  constructor(private readonly pool: Pool, root: string, private readonly secret: string, private readonly quota = 20_000_000_000) {
    this.root = resolve(root); this.staging = join(this.root, '.staging');
  }
  async initialize() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700);
    await mkdir(this.staging, { recursive: true, mode: 0o700 });
    await chmod(this.staging, 0o700);
  }
  path(id: string, kind: 'IMAGE' | 'VIDEO') { if (!uuid.test(id) || !['IMAGE','VIDEO'].includes(kind)) throw new MediaError('Media tidak valid.'); return join(this.root, `${id}.${kind === 'IMAGE' ? 'jpg' : 'mp4'}`); }
  async upload(userId: string, temporary: string, declaredType: string): Promise<Asset> {
    const id = randomUUID();
    let destination: string | undefined, moved = false;
    try {
      const size = (await stat(temporary)).size;
      if (!size || size > MEDIA_UPLOAD_LIMIT) throw new MediaError('Ukuran media maksimal 100 MiB.');
      let kind: 'IMAGE' | 'VIDEO', width: number, height: number, duration: number | null = null, finalSize: number;
      if (['image/jpeg','image/png'].includes(declaredType)) {
        if (size > 8 * 1024 ** 2) throw new MediaError('Ukuran gambar maksimal 8 MiB.');
        const input = await readFile(temporary);
        const metadata = await sharp(input, { limitInputPixels: 40_000_000, failOn: 'warning' }).metadata();
        if (!['jpeg','png'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) throw new MediaError('Gunakan gambar JPEG atau PNG statis yang valid.');
        kind = 'IMAGE'; destination = this.path(id, kind);
        const output = await sharp(input, { limitInputPixels: 40_000_000, failOn: 'warning' }).rotate().resize({ width: 1440, height: 1440, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
        width = output.info.width; height = output.info.height; finalSize = output.data.length;
        const outputFile = await open(destination, 'wx', 0o600); moved = true;
        try { await outputFile.writeFile(output.data); } finally { await outputFile.close(); }
      } else if (declaredType === 'video/mp4') {
        const handle = await open(temporary, 'r');
        const header = Buffer.alloc(12);
        try { await handle.read(header, 0, 12, 0); } finally { await handle.close(); }
        if (header.toString('ascii', 4, 8) !== 'ftyp' || header.toString('ascii', 8, 12).startsWith('qt')) throw new MediaError('Berkas harus berupa MP4 yang valid.');
        let info: VideoProbe;
        try {
          const result = await execute('ffprobe', ['-v','error','-protocol_whitelist','file,pipe','-enable_drefs','0','-use_absolute_path','0','-show_streams','-show_format','-of','json',temporary], { timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true });
          info = JSON.parse(result.stdout) as VideoProbe;
        } catch { throw new MediaError('Video tidak dapat divalidasi. Pastikan FFmpeg/ffprobe tersedia di server dan berkas MP4 valid.'); }
        const video = validateVideoProbe(info); width = video.width; height = video.height; duration = video.duration;
        kind = 'VIDEO'; destination = this.path(id, kind); finalSize = size;
        await chmod(temporary,0o600); await link(temporary, destination); moved = true; await unlink(temporary);
      } else throw new MediaError('Format yang didukung: JPEG, PNG, atau MP4.');
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT id FROM media_storage_lock WHERE id=1 FOR UPDATE');
        const usage = await client.query<{ used: string }>('SELECT COALESCE(SUM(byte_size),0)::text AS used FROM media_assets');
        if (Number(usage.rows[0]?.used ?? 0) + finalSize > this.quota) throw new MediaError('Kapasitas penyimpanan media telah mencapai batas.');
        const result = await client.query<Asset>('INSERT INTO media_assets(id,uploaded_by,kind,byte_size,width,height,duration_seconds) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [id,userId,kind,finalSize,width,height,duration]);
        await client.query('COMMIT'); return result.rows[0]!;
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    } catch (error) {
      if (moved && destination) await unlink(destination).catch(() => {});
      if (error instanceof MediaError) throw error;
      throw new MediaError('Media tidak dapat disimpan atau berkas tidak valid.');
    } finally { await unlink(temporary).catch(() => {}); }
  }
  async preview(id: string, userId: string) {
    if (!uuid.test(id)) return null;
    const result = await this.pool.query<Asset>('SELECT m.* FROM media_assets m WHERE m.id=$1 AND (m.uploaded_by=$2 OR EXISTS (SELECT 1 FROM content_version_media v WHERE v.media_id=m.id))', [id,userId]);
    return result.rows[0] ?? null;
  }
  async removeUnattached(id: string, userId: string) {
    if (!uuid.test(id)) throw new MediaError('Media tidak valid.');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const asset = (await client.query<Asset>('SELECT * FROM media_assets WHERE id=$1 AND uploaded_by=$2 FOR UPDATE', [id,userId])).rows[0];
      if (!asset) throw new MediaError('Media tidak ditemukan.');
      const used = await client.query('SELECT post_id FROM content_version_media WHERE media_id=$1 LIMIT 1', [id]);
      if (used.rows[0]) throw new MediaError('Media tersimpan pada riwayat konten dan tidak dapat dihapus langsung.');
      try { await unlink(this.path(id,asset.kind)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new MediaError('Berkas media belum dapat dihapus dari penyimpanan.'); }
      await client.query('DELETE FROM media_assets WHERE id=$1', [id]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  private sign(job: string, media: string, expires: string) { return createHmac('sha256', this.secret).update(`threads-media-v1:${job}:${media}:${expires}`).digest('base64url'); }
  downloadUrl(origin: string, job: string, media: string) {
    if (!uuid.test(job) || !uuid.test(media) || new URL(origin).protocol !== 'https:') throw new MediaError('Media memerlukan URL aplikasi HTTPS.');
    const expires = String(Math.floor(Date.now()/1000) + 7200);
    return `${origin}/media-fetch/${job}/${media}/${expires}/${this.sign(job,media,expires)}`;
  }
  async publicDownload(job: string, media: string, expires: string, signature: string) {
    if (!uuid.test(job) || !uuid.test(media) || !/^[0-9]{10,12}$/.test(expires) || Number(expires) < Date.now()/1000 || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return null;
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(this.sign(job,media,expires)))) return null;
    const result = await this.pool.query<Asset>("SELECT m.* FROM media_assets m JOIN content_version_media v ON v.media_id=m.id JOIN publication_jobs j ON j.post_id=v.post_id AND j.content_version=v.version WHERE m.id=$1 AND j.id=$2 AND j.status IN ('preparing','prepared','publishing','published','uncertain','confirmed_published')", [media,job]);
    return result.rows[0] ?? null;
  }
}
