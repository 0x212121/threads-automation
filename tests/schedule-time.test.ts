import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocalSchedule } from '../src/schedule-time.js';

test('waktu lokal disimpan sebagai UTC dan waktu DST ambigu ditolak', () => {
  assert.equal(resolveLocalSchedule('2026-11-05T12:30', 'Asia/Makassar').toISOString(), '2026-11-05T04:30:00.000Z');
  assert.throws(() => resolveLocalSchedule('2026-03-08T02:30', 'America/New_York'));
  assert.throws(() => resolveLocalSchedule('2026-11-01T01:30', 'America/New_York'));
  assert.throws(() => resolveLocalSchedule('2026-11-05T12:30', 'Not/AZone'));
});
