import test from 'node:test';
import assert from 'node:assert/strict';
import { createSmtpTransport, sendTransactionalMail, type MailTransport } from '../src/smtp.js';

test('email transaksional dikirim ke satu penerima dan penolakan tidak dianggap sukses', async () => {
  const calls: unknown[] = [];
  const transport: MailTransport = { sendMail: async (message) => { calls.push(message); return { accepted: ['penerima@example.test'], rejected: [] }; } };
  await sendTransactionalMail(transport, 'pengirim@example.test', 'penerima@example.test', 'Verifikasi email', 'Buka tautan verifikasi.');
  assert.equal(calls.length, 1);
  await assert.rejects(sendTransactionalMail(transport, 'pengirim@example.test', 'penerima@example.test', 'Header\ninjeksi', 'Isi'));
  const rejected: MailTransport = { sendMail: async () => ({ accepted: [], rejected: ['penerima@example.test'] }) };
  await assert.rejects(sendTransactionalMail(rejected, 'pengirim@example.test', 'penerima@example.test', 'Subjek', 'Isi'));
});

test('konfigurasi SMTP tidak lengkap ditolak', () => {
  assert.throws(() => createSmtpTransport({ host: 'smtp.example.test', port: 587, secure: false, from: 'pengirim@example.test', username: 'pengguna' }));
  assert.throws(() => createSmtpTransport({ host: 'smtp.example.test', port: 0, secure: false, from: 'pengirim@example.test' }));
});
