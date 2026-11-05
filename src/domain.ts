export type Role = 'admin' | 'reviewer' | 'editor';
export type ContentStatus = 'draft' | 'submitted' | 'approved' | 'rejected';
export type AttemptOutcome = 'safe_to_retry' | 'published' | 'permanent_failure' | 'unknown';

export class DomainError extends Error {}

export function nextContentStatus(current: ContentStatus, action: 'submit' | 'approve' | 'reject' | 'edit', role: Role): ContentStatus {
  if (!['admin', 'reviewer', 'editor'].includes(role)) throw new DomainError('Peran tidak valid.');
  if (action === 'edit' && current !== 'submitted') return 'draft';
  if (action === 'submit' && (current === 'draft' || current === 'rejected')) return 'submitted';
  if ((action === 'approve' || action === 'reject') && current === 'submitted' && (role === 'admin' || role === 'reviewer')) {
    return action === 'approve' ? 'approved' : 'rejected';
  }
  throw new DomainError('Perubahan status atau peran tidak diizinkan.');
}

export function mayRetry(outcome: AttemptOutcome, scheduledAt: Date, now: Date): boolean {
  if (!Number.isFinite(scheduledAt.getTime()) || !Number.isFinite(now.getTime())) throw new DomainError('Waktu tidak valid.');
  return outcome === 'safe_to_retry' && now.getTime() >= scheduledAt.getTime() && now.getTime() < scheduledAt.getTime() + 60 * 60 * 1000;
}
