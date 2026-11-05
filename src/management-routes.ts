import type { Express,RequestHandler } from 'express';
import type { Pool } from 'pg';
import { WorkspaceManagement,ManagementError,validId } from './workspace-management.js';
import { ContentStore,PermissionError } from './content-store.js';
import { DomainError } from './domain.js';
import { recordAudit } from './audit.js';
import rateLimit from 'express-rate-limit';

type Options={pool:Pool;permissionCheck?:(id:string)=>Promise<unknown>};
export function managementRoutes(app:Express,options:Options,requireUser:RequestHandler,checkCsrf:RequestHandler,requireAdmin:RequestHandler) {
  const management=new WorkspaceManagement(options.pool),content=new ContentStore(options.pool);
  const permissionLimit=rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Terlalu banyak pemeriksaan izin. Coba lagi nanti.'}});
  const offsetOf=(value:unknown)=>{const n=value===undefined ? 0 : typeof value==='string' ? Number(value) : NaN;if (!Number.isSafeInteger(n) || n<0 || n>1000000) throw new ManagementError('Offset tidak valid.',400);return n;};
  const safe=(fn:RequestHandler):RequestHandler=>async(req,res,next)=>{
    try {await fn(req,res,next);} catch(error) {
      if (error instanceof ManagementError) {res.status(error.status).json({error:error.message});return;}
      if (error instanceof PermissionError) {res.status(403).json({error:error.message});return;}
      if (error instanceof DomainError) {res.status(409).json({error:error.message});return;}
      next(error);
    }
  };
  app.get('/api/team/members',requireUser,requireAdmin,safe(async(req,res)=>{
    const offset=offsetOf(req.query.offset),result=await options.pool.query('SELECT id,email,role,email_verified_at,disabled_at,created_at FROM local_users ORDER BY created_at,id LIMIT 51 OFFSET $1',[offset]);
    res.set('Cache-Control','no-store').json({members:result.rows.slice(0,50),nextOffset:result.rows.length>50 ? offset+50 : null});
  }));
  app.patch('/api/team/members/:id',requireUser,checkCsrf,requireAdmin,safe(async(req,res)=>{
    const data=req.body;
    if (!data || Array.isArray(data) || Object.keys(data).some(key=>!['role','disabled','expectedRole','expectedDisabled'].includes(key))) throw new ManagementError('Perubahan tidak valid.',400);
    await management.changeMember(res.locals.user.id,req.params.id as string,data);res.status(204).end();
  }));
  app.get('/api/invitations',requireUser,requireAdmin,safe(async(req,res)=>{
    const offset=offsetOf(req.query.offset),result=await options.pool.query('SELECT id,email,role,invited_by,expires_at,accepted_at,revoked_at,created_at FROM team_invitations ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET $1',[offset]);
    res.set('Cache-Control','no-store').json({invitations:result.rows.slice(0,50),nextOffset:result.rows.length>50 ? offset+50 : null});
  }));
  app.delete('/api/invitations/:id',requireUser,checkCsrf,requireAdmin,safe(async(req,res)=>{await management.revokeInvitation(res.locals.user.id,req.params.id as string);res.status(204).end();}));
  app.get('/api/threads/accounts/manage',requireUser,requireAdmin,safe(async(_req,res)=>{
    const result=await options.pool.query('SELECT id,username,status,token_expires_at,refresh_status,updated_at FROM threads_accounts ORDER BY username,id');
    res.set('Cache-Control','no-store').json({accounts:result.rows});
  }));
  app.delete('/api/threads/accounts/:id',requireUser,checkCsrf,requireAdmin,safe(async(req,res)=>{
    const result=await management.disconnect(res.locals.user.id,req.params.id as string);res.set('Cache-Control','no-store').json({...result,scope:'local'});
  }));
  app.post('/api/threads/accounts/:id/permissions',requireUser,checkCsrf,requireAdmin,permissionLimit,safe(async(req,res)=>{
    const id=req.params.id as string;if (!validId(id)) throw new ManagementError('Akun tidak valid.',400);
    if (!(await options.pool.query("SELECT id FROM threads_accounts WHERE id=$1 AND status='active'",[id])).rows.length) throw new ManagementError('Akun tidak aktif atau tidak ditemukan.',404);
    if (!options.permissionCheck) throw new ManagementError('Pemeriksaan izin belum dikonfigurasi.',503);
    const result=await options.permissionCheck(id);
    await recordAudit(options.pool,res.locals.user.id,'threads.permissions_checked','threads_account',id);
    res.set('Cache-Control','no-store').json(result);
  }));
  app.delete('/api/posts/:id',requireUser,checkCsrf,safe(async(req,res)=>{
    const data=req.body;if (!data || Array.isArray(data) || Object.keys(data).some(key=>key!=='revision') || !Number.isSafeInteger(data.revision)) throw new ManagementError('Revisi tidak valid.',400);
    await content.remove(res.locals.user,req.params.id as string,data.revision);res.status(204).end();
  }));
  app.get('/api/posts/:id/history',requireUser,safe(async(req,res)=>{res.set('Cache-Control','no-store').json(await management.history(req.params.id as string,offsetOf(req.query.offset)));}));
  app.get('/api/audit',requireUser,requireAdmin,safe(async(req,res)=>{
    const offset=offsetOf(req.query.offset),result=await options.pool.query(`SELECT e.id,e.actor_id,u.email AS actor_email,e.action,e.subject_type,e.subject_id,e.details,e.created_at,
      CASE e.subject_type WHEN 'member' THEN (SELECT email FROM local_users WHERE id=e.subject_id)
        WHEN 'invitation' THEN (SELECT email FROM team_invitations WHERE id=e.subject_id)
        WHEN 'threads_account' THEN (SELECT username FROM threads_accounts WHERE id=e.subject_id) ELSE NULL END AS subject_label
      FROM audit_events e LEFT JOIN local_users u ON u.id=e.actor_id ORDER BY e.created_at DESC,e.id DESC LIMIT 51 OFFSET $1`,[offset]);
    res.set('Cache-Control','no-store').json({events:result.rows.slice(0,50),nextOffset:result.rows.length>50 ? offset+50 : null});
  }));
}
