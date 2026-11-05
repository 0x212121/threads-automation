import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

// Callers pass only explicit, non-sensitive fields; never provider responses or request bodies.
export async function recordAudit(client: Pool | PoolClient, actorId:string, action:string, subjectType:'post'|'member'|'invitation'|'threads_account', subjectId:string, details:Record<string,string|number|boolean|null>={}) {
  await client.query('INSERT INTO audit_events(id,actor_id,action,subject_type,subject_id,details) VALUES ($1,$2,$3,$4,$5,$6::jsonb)',[randomUUID(),actorId,action,subjectType,subjectId,JSON.stringify(details)]);
}
