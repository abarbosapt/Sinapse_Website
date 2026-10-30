import { existsSync } from 'node:fs';

/** Devolve o URL da base de testes, recusando qualquer outra base. */
export function getTestDatabaseUrl(): string {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) throw new Error('TEST_DATABASE_URL não está definida em backend/.env.');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('TEST_DATABASE_URL não é um URL válido.');
  }
  const isLocal = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (!isLocal || url.pathname !== '/sinapse_test') {
    throw new Error('Os testes só podem correr contra a base sinapse_test em localhost.');
  }
  return raw;
}
