import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const argon2Async = promisify(argon2);

// Parâmetros argon2id (recomendação OWASP: m=19 MiB, t=2, p=1).
const MEMORY_KIB = 19_456;
const PASSES = 2;
const PARALLELISM = 1;
const TAG_LENGTH = 32;
const SALT_LENGTH = 16;

const PHC_PATTERN =
  /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

const toBase64 = (buffer: Buffer) => buffer.toString('base64').replace(/=+$/, '');

function derive(
  password: string,
  salt: Buffer,
  memory: number,
  passes: number,
  parallelism: number,
  tagLength: number,
): Promise<Buffer> {
  return argon2Async('argon2id', {
    message: password,
    nonce: salt,
    parallelism,
    tagLength,
    memory,
    passes,
  });
}

export function checkPasswordPolicy(password: string): string | null {
  if (password.length < 12) return 'A palavra-passe deve ter pelo menos 12 caracteres.';
  if (password.length > 128) return 'A palavra-passe não pode ter mais de 128 caracteres.';
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await derive(password, salt, MEMORY_KIB, PASSES, PARALLELISM, TAG_LENGTH);
  return `$argon2id$v=19$m=${MEMORY_KIB},t=${PASSES},p=${PARALLELISM}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = PHC_PATTERN.exec(stored);
  if (!match) return false;
  const [, memory, passes, parallelism, saltB64, hashB64] = match;
  if (!memory || !passes || !parallelism || !saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await derive(
    password,
    salt,
    Number(memory),
    Number(passes),
    Number(parallelism),
    expected.length,
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

let dummyHash: Promise<string> | undefined;

/** Gasta o mesmo tempo de uma verificação real (evita revelar se o utilizador existe). */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword('palavra-passe-falsa-para-igualar-tempos');
  await verifyPassword(password, await dummyHash);
}
