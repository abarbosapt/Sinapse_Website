import { createHash, randomBytes } from 'node:crypto';

/** Token opaco para o cookie: 256 bits aleatórios. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Só o hash (SHA-256) fica na base de dados. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
