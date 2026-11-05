import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type EncryptedToken = { ciphertext: Buffer; iv: Buffer; tag: Buffer };

export class TokenVault {
  private readonly key: Buffer;
  constructor(key: Buffer) {
    if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Kunci enkripsi harus 32 byte.');
    this.key = Buffer.from(key);
  }
  seal(token: string, context: string): EncryptedToken {
    if (!token || !context) throw new Error('Token atau konteks tidak valid.');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return { ciphertext, iv, tag: cipher.getAuthTag() };
  }
  open(value: EncryptedToken, context: string): string {
    if (!context || value.iv.length !== 12 || value.tag.length !== 16) throw new Error('Token terenkripsi tidak valid.');
    const decipher = createDecipheriv('aes-256-gcm', this.key, value.iv);
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(value.tag);
    return Buffer.concat([decipher.update(value.ciphertext), decipher.final()]).toString('utf8');
  }
}
