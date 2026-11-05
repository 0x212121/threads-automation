import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
const parameters = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const derive = (password: string, salt: Buffer): Promise<Buffer> => new Promise((resolve, reject) => {
  scryptCallback(password, salt, 64, parameters, (error, key) => error ? reject(error) : resolve(key));
});

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 1024) throw new Error('Kata sandi harus minimal 12 karakter dan maksimal 1024 byte.');
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `scrypt$32768$8$3$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt' || parts[1] !== '32768' || parts[2] !== '8' || parts[3] !== '3' || !parts[4] || !parts[5] || Buffer.byteLength(password, 'utf8') > 1024) return false;
  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  if (salt.length !== 16 || expected.length !== 64) return false;
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected);
}
