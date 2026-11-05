import { Temporal } from '@js-temporal/polyfill';

export function resolveLocalSchedule(local: string, timeZone: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)*$/.test(timeZone) || timeZone.length > 100) throw new Error('Waktu atau zona waktu tidak valid.');
  try {
    const plain = Temporal.PlainDateTime.from(local);
    const zoned = plain.toZonedDateTime(timeZone, { disambiguation: 'reject' });
    return new Date(zoned.epochMilliseconds);
  } catch { throw new Error('Waktu tidak valid atau ambigu di zona waktu tersebut.'); }
}
