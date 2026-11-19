import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function opaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** S256 do PKCE: base64url(SHA-256(verifier)). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function matchesPkceChallenge(verifier: string, expectedChallenge: string): boolean {
  if (verifier.length === 0 || expectedChallenge.length === 0) return false;
  const actual = Buffer.from(pkceChallenge(verifier));
  const expected = Buffer.from(expectedChallenge);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const CIPHER_VERSION = 'v1';

/**
 * AES-256-GCM com prefixo de versão da chave no ciphertext (`v1.iv.tag.body`).
 * O prefixo permite rotacionar a chave sem perder credenciais já cifradas.
 */
export function encrypt(value: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [CIPHER_VERSION, iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

export function decrypt(value: string, key: Buffer): string {
  const parts = value.split('.');
  // Credenciais antigas foram gravadas sem prefixo de versão.
  const [ivText, tagText, bodyText] = parts.length === 4 && parts[0] === CIPHER_VERSION ? parts.slice(1) : parts;
  if (!ivText || !tagText || !bodyText) throw new Error('Credencial criptografada inválida');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(bodyText, 'base64url')), decipher.final()]).toString('utf8');
}
