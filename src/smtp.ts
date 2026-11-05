import nodemailer from 'nodemailer';

export type SmtpConfig = {
  host: string; port: number; secure: boolean; from: string;
  username?: string; password?: string;
};
export type MailTransport = { sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<{ accepted: unknown[]; rejected: unknown[] }> };

const emailPattern = /^[^\s@<>\r\n,;]+@[^\s@<>\r\n,;]+\.[^\s@<>\r\n,;]+$/;
export function createSmtpTransport(config: SmtpConfig): MailTransport {
  if (!config.host || /[\s\r\n]/.test(config.host) || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535 || !emailPattern.test(config.from) || (!!config.username !== !!config.password)) throw new Error('Konfigurasi SMTP tidak valid.');
  return nodemailer.createTransport({
    host: config.host, port: config.port, secure: config.secure,
    requireTLS: !config.secure, tls: { rejectUnauthorized: true },
    auth: config.username && config.password ? { user: config.username, pass: config.password } : undefined,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    disableFileAccess: true, disableUrlAccess: true,
  });
}

export async function sendTransactionalMail(transport: MailTransport, from: string, to: string, subject: string, text: string): Promise<void> {
  if (!emailPattern.test(from) || !emailPattern.test(to) || !subject.trim() || /[\r\n]/.test(subject) || !text.trim()) throw new Error('Isi email tidak valid.');
  const result = await transport.sendMail({ from, to, subject, text });
  if (result.accepted.length !== 1 || result.rejected.length !== 0) throw new Error('Server SMTP tidak menerima penerima.');
}
