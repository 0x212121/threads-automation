import type { Pool, PoolClient } from 'pg';
import { recordAudit } from './audit.js';

export class ManagementError extends Error {
  constructor(message:string,readonly status=409) {super(message);}
}
export const validId=(id:unknown):id is string=>typeof id==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export class WorkspaceManagement {
  constructor(private readonly pool:Pool) {}
  private async transaction<T>(fn:(client:PoolClient)=>Promise<T>):Promise<T> {
    const client=await this.pool.connect();
    try {await client.query('BEGIN');const value=await fn(client);await client.query('COMMIT');return value;}
    catch(error) {await client.query('ROLLBACK');throw error;}
    finally {client.release();}
  }
  private async admin(client:PoolClient,actor:string) {
    // Deterministic row locks serialize concurrent demotions/disabling of the last administrators.
    const users=await client.query<{id:string;role:string;disabled_at:Date|null;email_verified_at:Date|null}>('SELECT id,role,disabled_at,email_verified_at FROM local_users ORDER BY id FOR UPDATE');
    const user=users.rows.find(row=>row.id===actor);
    if (!user || user.role!=='admin' || user.disabled_at || !user.email_verified_at) throw new ManagementError('Hanya admin terverifikasi dapat mengelola tim dan akun.',403);
    return users.rows;
  }
  async changeMember(actor:string,id:string,data:{role?:string;disabled?:boolean;expectedRole:string;expectedDisabled:boolean}) {
    if (!validId(id) || !['admin','reviewer','editor'].includes(data.expectedRole) || typeof data.expectedDisabled!=='boolean' || (data.role!==undefined && !['admin','reviewer','editor'].includes(data.role)) || (data.disabled!==undefined && typeof data.disabled!=='boolean') || (data.role===undefined && data.disabled===undefined)) throw new ManagementError('Perubahan anggota tidak valid.',400);
    return this.transaction(async client=>{
      const users=await this.admin(client,actor),member=users.find(row=>row.id===id);
      if (!member) throw new ManagementError('Anggota tidak ditemukan.',404);
      if (member.role!==data.expectedRole || !!member.disabled_at!==data.expectedDisabled) throw new ManagementError('Data anggota berubah. Muat ulang sebelum melanjutkan.');
      const role=data.role ?? member.role,disabled=data.disabled ?? !!member.disabled_at;
      if (id===actor && disabled) throw new ManagementError('Kamu tidak dapat menonaktifkan akun yang sedang digunakan.');
      if (member.role==='admin' && !member.disabled_at && member.email_verified_at && (role!=='admin' || disabled) && !users.some(row=>row.id!==id && row.role==='admin' && !row.disabled_at && row.email_verified_at)) throw new ManagementError('Sisakan setidaknya satu admin aktif dengan email terverifikasi.');
      if (role===member.role && disabled===!!member.disabled_at) return;
      await client.query('UPDATE local_users SET role=$2,disabled_at=CASE WHEN $3::boolean THEN COALESCE(disabled_at,now()) ELSE NULL END,session_version=session_version+1 WHERE id=$1',[id,role,disabled]);
      if (disabled) await client.query("UPDATE publication_jobs SET status='needs_action',failure_code='preconditions',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE requested_by=$1 AND status IN ('scheduled','preparing','prepared') AND (lease_until IS NULL OR lease_until<=now())",[id]);
      await recordAudit(client,actor,'member.updated','member',id,{previousRole:member.role,role,disabled});
    });
  }
  async revokeInvitation(actor:string,id:string) {
    if (!validId(id)) throw new ManagementError('Undangan tidak valid.',400);
    return this.transaction(async client=>{
      await this.admin(client,actor);
      const result=await client.query("UPDATE team_invitations SET revoked_at=now() WHERE id=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() RETURNING id",[id]);
      if (!result.rows.length) throw new ManagementError('Undangan sudah digunakan, kedaluwarsa, atau dicabut.');
      await recordAudit(client,actor,'invitation.revoked','invitation',id);
    });
  }
  async disconnect(actor:string,id:string) {
    if (!validId(id)) throw new ManagementError('Akun tidak valid.',400);
    return this.transaction(async client=>{
      await this.admin(client,actor);
      const result=await client.query("UPDATE threads_accounts SET status='disconnected',encrypted_token=NULL,token_iv=NULL,token_tag=NULL,token_expires_at=NULL,refresh_lease=NULL,refresh_lease_until=NULL,updated_at=now() WHERE id=$1 AND status='active' RETURNING id",[id]);
      if (!result.rows.length) throw new ManagementError('Akun tidak ditemukan atau sudah diputus.');
      const pending=await client.query("UPDATE publication_jobs SET status='needs_action',failure_code='preconditions',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE account_id=$1 AND status IN ('scheduled','preparing','prepared') AND (lease_until IS NULL OR lease_until<=now()) RETURNING id",[id]);
      await recordAudit(client,actor,'threads.disconnected','threads_account',id,{pausedJobs:pending.rows.length});
      return {pausedJobs:pending.rows.length};
    });
  }
  async history(id:string,offset:number) {
    if (!validId(id)) throw new ManagementError('Konten tidak valid.',400);
    if (!(await this.pool.query('SELECT id FROM content_posts WHERE id=$1 AND deleted_at IS NULL',[id])).rows.length) throw new ManagementError('Konten tidak ditemukan.',404);
    const page=async(sql:string)=>{
      const result=await this.pool.query(sql,[id,offset]);return {items:result.rows.slice(0,50),nextOffset:result.rows.length>50 ? offset+50 : null};
    };
    // Each independently paginated section preserves old attempts and versions, even for long-lived posts.
    const versions=await page(`SELECT v.version,v.body,v.created_at,v.created_by,a.username AS destination_username,
      COALESCE((SELECT json_agg(r.body ORDER BY r.position) FROM content_version_replies r WHERE r.post_id=v.post_id AND r.version=v.version),'[]'::json) AS replies,
      COALESCE((SELECT json_agg(json_build_object('id',m.media_id,'kind',ma.kind) ORDER BY m.position) FROM content_version_media m JOIN media_assets ma ON ma.id=m.media_id WHERE m.post_id=v.post_id AND m.version=v.version),'[]'::json) AS media
      FROM content_versions v LEFT JOIN threads_accounts a ON a.id=v.destination_account_id WHERE v.post_id=$1 ORDER BY v.version DESC LIMIT 51 OFFSET $2`);
    const reviews=await page('SELECT content_version,reviewer_id,decision,created_at FROM content_reviews WHERE post_id=$1 ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET $2');
    const jobs=await page(`SELECT j.id,j.content_version,j.status,j.scheduled_at,j.time_zone,j.part_index,j.failure_code,j.created_at,j.updated_at,
      COALESCE((SELECT json_agg(json_build_object('position',p.position,'status',p.status,'publishedId',p.published_id) ORDER BY p.position) FROM publication_parts p WHERE p.job_id=j.id),'[]'::json) AS parts
      FROM publication_jobs j WHERE j.post_id=$1 ORDER BY j.created_at DESC,j.id DESC LIMIT 51 OFFSET $2`);
    const attempts=await page(`SELECT pa.id,pa.job_id,pa.stage,pa.outcome,pa.created_at,pa.failure_reason,pa.failure_http_status,pa.failure_meta_code,pa.failure_meta_subcode FROM publication_attempts pa JOIN publication_jobs j ON j.id=pa.job_id WHERE j.post_id=$1 ORDER BY pa.created_at DESC,pa.id DESC LIMIT 51 OFFSET $2`);
    const events=await page("SELECT id,actor_id,action,details,created_at FROM audit_events WHERE subject_type='post' AND subject_id=$1 ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET $2");
    const resolutions=await page('SELECT r.job_id,r.resolved_by,r.decision,r.created_at FROM publication_resolutions r JOIN publication_jobs j ON j.id=r.job_id WHERE j.post_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 51 OFFSET $2');
    const resumptions=await page('SELECT r.job_id,r.resumed_by,r.position,r.created_at FROM publication_resumptions r JOIN publication_jobs j ON j.id=r.job_id WHERE j.post_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 51 OFFSET $2');
    const repairs=await page('SELECT r.job_id,r.previous_id,r.corrected_id,r.created_at FROM publication_reference_repairs r JOIN publication_jobs j ON j.id=r.job_id WHERE j.post_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 51 OFFSET $2');
    return {versions,reviews,jobs,attempts,events,resolutions,resumptions,repairs};
  }
}
