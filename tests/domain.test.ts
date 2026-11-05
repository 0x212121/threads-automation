import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainError, mayRetry, nextContentStatus } from '../src/domain.js';

test('admin dan reviewer dapat menyetujui konten yang diajukan', () => {
  assert.equal(nextContentStatus('submitted', 'approve', 'admin'), 'approved');
  assert.equal(nextContentStatus('submitted', 'approve', 'reviewer'), 'approved');
  assert.throws(() => nextContentStatus('submitted', 'approve', 'editor'), DomainError);
  assert.throws(() => nextContentStatus('submitted', 'approve', 'invalid' as never), DomainError);
});
test('edit konten yang sudah disetujui membatalkan persetujuan', () => {
  assert.equal(nextContentStatus('approved', 'edit', 'editor'), 'draft');
  assert.throws(() => nextContentStatus('submitted', 'edit', 'editor'), DomainError);
});
test('retry hanya untuk kegagalan aman dan sebelum batas satu jam', () => {
  const scheduled = new Date('2026-11-04T10:00:00Z');
  assert.equal(mayRetry('safe_to_retry', scheduled, new Date('2026-11-04T10:59:59Z')), true);
  assert.equal(mayRetry('safe_to_retry', scheduled, new Date('2026-11-04T11:00:00Z')), false);
  assert.equal(mayRetry('unknown', scheduled, new Date('2026-11-04T10:05:00Z')), false);
  assert.equal(mayRetry('published', scheduled, new Date('2026-11-04T10:05:00Z')), false);
});
