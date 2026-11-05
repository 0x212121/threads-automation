import { Temporal } from '@js-temporal/polyfill';
import { resolveLocalSchedule } from './schedule-time.js';
import { ManagementError,validId } from './workspace-management.js';

export function postFilters(query:Record<string,unknown>):{where:string;params:unknown[];offset:number} {
  const allowed=['offset','status','accountId','dateFrom','dateTo','dateField','timeZone'];
  if (Object.keys(query).some(key=>!allowed.includes(key)) || Object.values(query).some(value=>typeof value!=='string')) throw new ManagementError('Filter tidak valid.',400);
  const offset=query.offset===undefined ? 0 : Number(query.offset);
  if (!Number.isSafeInteger(offset) || offset<0 || offset>1000000) throw new ManagementError('Offset tidak valid.',400);
  const params:unknown[]=[offset],conditions=['p.deleted_at IS NULL'];
  const add=(value:unknown)=>{params.push(value);return `$${params.length}`;};
  if (query.status && query.status!=='all') {
    if (!['draft','submitted','approved','rejected','scheduled','preparing','prepared','publishing','published','confirmed_published','uncertain','needs_action','cancelled'].includes(query.status as string)) throw new ManagementError('Status tidak valid.',400);
    const p=add(query.status);conditions.push(`(p.status=${p} OR j.status=${p})`);
  }
  if (query.accountId) {if (!validId(query.accountId)) throw new ManagementError('Akun filter tidak valid.',400);conditions.push(`v.destination_account_id=${add(query.accountId)}`);}
  if (query.dateField && !['created','scheduled'].includes(query.dateField as string)) throw new ManagementError('Jenis tanggal tidak valid.',400);
  const field=query.dateField==='scheduled' ? 'j.scheduled_at' : 'p.created_at',zone=(query.timeZone as string|undefined) ?? 'UTC';
  try {
    resolveLocalSchedule('2026-01-01T12:00',zone);
    if (query.dateFrom && query.dateTo && String(query.dateFrom)>String(query.dateTo)) throw new Error();
    for (const key of ['dateFrom','dateTo']) if (query[key]) {
      const text=query[key] as string;if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error();
      const day=Temporal.PlainDate.from(text),bound=key==='dateTo' ? day.add({days:1}) : day;
      const instant=resolveLocalSchedule(`${bound.toString()}T00:00`,zone);
      conditions.push(`${field}${key==='dateTo' ? '<' : '>='}${add(instant)}`);
    }
  } catch {throw new ManagementError('Rentang tanggal atau zona waktu tidak valid.',400);}
  return {where:conditions.join(' AND '),params,offset};
}
